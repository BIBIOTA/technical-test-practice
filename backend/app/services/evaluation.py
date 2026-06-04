import json
import re
from abc import ABC, abstractmethod

from pydantic import BaseModel

from app.config import settings


class EvaluationResult(BaseModel):
    score: int  # 0-100
    summary: str
    missing_points: list[str]
    next_focus: list[str]
    ideal_answer: str = ""
    provider: str
    model: str


SYSTEM_PROMPT_TEMPLATE = """你是一位嚴格的資深後端工程師面試官，正在評估應試者的技術回答。請全程使用繁體中文。

題目：{question}
難度：{difficulty}

核心評分要點（缺一項即明顯扣分，core）：
{core_points_block}

加分要點（提到能往 85+ 推，bonus）：
{bonus_points_block}

常見誤區（應試者若落入應於 missing_points 指出，並作為扣分依據）：
{common_mistakes_block}

完整參考答案（產 ideal_answer 時參考，不要逐項對照評分）：
{reference_answer}

應試者回答：{transcript}

請嚴格評估並只回傳一個 JSON 物件，所有自然語言文字使用繁體中文。
JSON 必須包含：score / summary / missing_points / next_focus / ideal_answer / provider / model。

評估流程（在心中完成，不輸出）：
1. 逐項對照「核心評分要點」與「加分要點」，標記應試者是否提及（同義或合理等價表達視為提及）。
2. 已明確提及的內容不得列入 missing_points。
3. 檢查應試者是否落入「常見誤區」；若有，列入 missing_points 並具體指出誤區內容。
4. summary 必須同時反映「已答對的重點」與「真正需要補強的地方」，避免套版批評。
5. ideal_answer 提供一份比參考答案更適合學習的完整回答；不得聲稱應試者沒提到他其實已提到的內容。

評分校準（綁定 key_points 覆蓋率）：
- 90-100：涵蓋所有 core + 多數 bonus + 具體例子 / 工程取捨
- 80-89：涵蓋所有 core + 部分 bonus，或 core 全到位但深度略不足
- 70-79：缺 1 個 core，或所有 core 都提及但極度淺薄
- 60-69：缺 2+ 個 core，或落入 1 個以上常見誤區
- 60 以下：偏題 / 嚴重錯誤 / 多數 core 未提及

難度校準（覆蓋上面校準）：
- easy：core 全到位即可給 85+，不強求 bonus
- medium：core 全到位 + 至少 1 個 bonus 才給 85+
- hard：core 全到位 + 多數 bonus + 明確工程取捨 才給 85+

evidence-aligned 規則（保留）：
- 若應試者已提供兩個以上具體例子，不得泛稱缺少具體範例；只能指出哪些例子不夠精準。
- missing_points 每一點都要能從應試者回答中找到證據（未提及 / 錯誤 / 說明不足）。"""


class EvaluationProvider(ABC):
    @abstractmethod
    async def evaluate(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],
        common_mistakes: list[str],
    ) -> EvaluationResult:
        pass

    def _build_prompt(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],
        common_mistakes: list[str],
    ) -> str:
        core = [kp["point"] for kp in key_points if kp["tier"] == "core"]
        bonus = [kp["point"] for kp in key_points if kp["tier"] == "bonus"]

        def _bulleted(items: list[str], fallback: str) -> str:
            if not items:
                return f"- （{fallback}）"
            return "\n".join(f"- {item}" for item in items)

        return SYSTEM_PROMPT_TEMPLATE.format(
            question=question,
            difficulty=difficulty,
            core_points_block=_bulleted(core, "本題未提供核心要點"),
            bonus_points_block=_bulleted(bonus, "本題未提供加分要點"),
            common_mistakes_block=_bulleted(common_mistakes, "本題未提供常見誤區"),
            reference_answer=reference_answer,
            transcript=transcript,
        )

    def _parse_result(self, raw: str, provider: str, model: str) -> EvaluationResult:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        data = json.loads(raw[start:end])
        data["provider"] = provider
        data["model"] = model
        data.setdefault("ideal_answer", "")
        data["score"] = max(0, min(100, int(data["score"])))
        return EvaluationResult(**data)

    def _needs_traditional_chinese_localization(self, result: EvaluationResult) -> bool:
        return any(_looks_like_english(text) for text in _feedback_texts(result))

    def _build_localization_prompt(self, result: EvaluationResult) -> str:
        payload = result.model_dump()
        payload.pop("provider", None)
        payload.pop("model", None)
        return (
            "請將以下面試評分 JSON 的所有自然語言回饋欄位改寫為繁體中文，"
            "保留原本的技術意思、分數與 JSON schema。"
            "必須只回傳 JSON，不要加任何說明。\n\n"
            "需要繁體中文化的欄位：summary、missing_points、next_focus、ideal_answer。\n\n"
            f"{json.dumps(payload, ensure_ascii=False)}"
        )

    def _offline_result(self, provider: str, model: str, transcript: str) -> EvaluationResult:
        words = [word for word in transcript.split() if word.strip()]
        score = min(95, max(55, 45 + len(words) * 3))
        return EvaluationResult(
            score=score,
            summary="離線模式：測試評估已完成。",
            missing_points=[] if score >= 75 else ["請提供更具體的技術細節。"],
            next_focus=["使用具體範例說明，並討論技術取捨。"],
            ideal_answer="（離線模式不提供模範回答）",
            provider=provider,
            model=model,
        )


class OpenAIEvaluationProvider(EvaluationProvider):
    MODEL = "gpt-4o-mini"

    _RESPONSE_FORMAT: dict = {
        "type": "json_schema",
        "json_schema": {
            "name": "evaluation",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "score": {"type": "integer"},
                    "summary": {"type": "string"},
                    "missing_points": {"type": "array", "items": {"type": "string"}},
                    "next_focus": {"type": "array", "items": {"type": "string"}},
                    "ideal_answer": {"type": "string"},
                },
                "required": [
                    "score",
                    "summary",
                    "missing_points",
                    "next_focus",
                    "ideal_answer",
                ],
                "additionalProperties": False,
            },
        },
    }

    async def evaluate(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],
        common_mistakes: list[str],
    ) -> EvaluationResult:
        if settings.evaluation_offline_mode:
            return self._offline_result("openai", self.MODEL, transcript)

        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        prompt = self._build_prompt(
            question,
            reference_answer,
            transcript,
            difficulty=difficulty,
            key_points=key_points,
            common_mistakes=common_mistakes,
        )
        response = await client.chat.completions.create(
            model=self.MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format=self._RESPONSE_FORMAT,
        )
        raw = response.choices[0].message.content or "{}"
        result = self._parse_result(raw, "openai", self.MODEL)
        if not self._needs_traditional_chinese_localization(result):
            return result

        localized = await client.chat.completions.create(
            model=self.MODEL,
            messages=[{"role": "user", "content": self._build_localization_prompt(result)}],
            response_format=self._RESPONSE_FORMAT,
        )
        localized_raw = localized.choices[0].message.content or "{}"
        return self._parse_result(localized_raw, "openai", self.MODEL)


class ClaudeEvaluationProvider(EvaluationProvider):
    MODEL = "claude-haiku-4-5-20251001"

    _TOOL: dict = {
        "name": "submit_evaluation",
        "description": "Submit structured evaluation result",
        "input_schema": {
            "type": "object",
            "properties": {
                "score": {"type": "integer"},
                "summary": {"type": "string"},
                "missing_points": {"type": "array", "items": {"type": "string"}},
                "next_focus": {"type": "array", "items": {"type": "string"}},
                "ideal_answer": {"type": "string"},
            },
            "required": ["score", "summary", "missing_points", "next_focus", "ideal_answer"],
        },
    }

    async def evaluate(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],
        common_mistakes: list[str],
    ) -> EvaluationResult:
        if settings.evaluation_offline_mode:
            return self._offline_result("claude", self.MODEL, transcript)

        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        prompt = self._build_prompt(
            question,
            reference_answer,
            transcript,
            difficulty=difficulty,
            key_points=key_points,
            common_mistakes=common_mistakes,
        )
        message = await client.messages.create(
            model=self.MODEL,
            max_tokens=2048,
            tools=[self._TOOL],
            tool_choice={"type": "tool", "name": "submit_evaluation"},
            messages=[{"role": "user", "content": prompt}],
        )
        for block in message.content:
            if hasattr(block, "input"):
                data = dict(block.input)
                data["provider"] = "claude"
                data["model"] = self.MODEL
                data.setdefault("ideal_answer", "")
                data["score"] = max(0, min(100, int(data["score"])))
                return EvaluationResult(**data)
        raise ValueError("Claude returned no tool_use block")


class GeminiEvaluationProvider(EvaluationProvider):
    MODEL = "gemini-2.5-flash"

    _RESPONSE_SCHEMA: dict = {
        "type": "object",
        "properties": {
            "score": {"type": "integer"},
            "summary": {"type": "string"},
            "missing_points": {"type": "array", "items": {"type": "string"}},
            "next_focus": {"type": "array", "items": {"type": "string"}},
            "ideal_answer": {"type": "string"},
        },
        "required": [
            "score",
            "summary",
            "missing_points",
            "next_focus",
            "ideal_answer",
        ],
    }

    async def evaluate(
        self,
        question: str,
        reference_answer: str,
        transcript: str,
        *,
        difficulty: str,
        key_points: list[dict],
        common_mistakes: list[str],
    ) -> EvaluationResult:
        if settings.evaluation_offline_mode:
            return self._offline_result("gemini", self.MODEL, transcript)

        import asyncio

        import google.generativeai as genai

        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel(
            self.MODEL,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                response_schema=self._RESPONSE_SCHEMA,
            ),
        )
        prompt = self._build_prompt(
            question,
            reference_answer,
            transcript,
            difficulty=difficulty,
            key_points=key_points,
            common_mistakes=common_mistakes,
        )
        response = await asyncio.to_thread(model.generate_content, prompt)
        raw = response.text if response.text else "{}"
        return self._parse_result(raw, "gemini", self.MODEL)


def get_provider(eval_provider: str) -> EvaluationProvider:
    providers: dict[str, type[EvaluationProvider]] = {
        "openai": OpenAIEvaluationProvider,
        "claude": ClaudeEvaluationProvider,
        "gemini": GeminiEvaluationProvider,
    }
    provider_class = providers.get(eval_provider)
    if provider_class is None:
        raise ValueError(f"Unknown eval provider: {eval_provider}")
    return provider_class()


def _feedback_texts(result: EvaluationResult) -> list[str]:
    texts = [result.summary, result.ideal_answer]
    texts.extend(result.missing_points)
    texts.extend(result.next_focus)
    return [text for text in texts if text]


def _looks_like_english(text: str) -> bool:
    ascii_words = re.findall(r"[A-Za-z]{3,}", text)
    cjk_chars = re.findall(r"[\u4e00-\u9fff]", text)
    return len(ascii_words) >= 4 and len(ascii_words) > len(cjk_chars)
