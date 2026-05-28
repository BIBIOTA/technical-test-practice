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
參考答案：{reference_answer}
應試者回答：{transcript}

請嚴格評估並只回傳一個 JSON 物件。所有自然語言文字都必須使用繁體中文，即使應試者回答中混有英文，也不得把摘要、待改善、優勢 / 下一步或完整回答建議翻譯成英文。
JSON 必須包含以下欄位：
- score: 整數 0-100（整體品質分數）
- summary: 字串（2-3 句繁體中文，作為「AI 詳細反饋」）
- missing_points: 字串陣列（繁體中文，作為「待改善」，列出應試者未提及或說明不足的重要知識點）
- next_focus: 字串陣列（繁體中文，作為「優勢 / 下一步」，先指出回答中的具體優勢，再給下一步改進方向）
- ideal_answer: 字串（繁體中文，作為「正確完整回答建議」，根據題目與參考答案提供一份完整、可直接學習的建議回答）
- provider: 字串（你的 provider 名稱）
- model: 字串（使用的模型名稱）

評估流程（先在心中完成，不要輸出這些中間步驟）：
1. 逐項比對「參考答案」與「應試者回答」的核心知識點。
2. 先確認應試者已明確提到的內容與具體例子；已明確提到或合理等價表達的內容，不得列入 missing_points。
3. 若應試者已提供兩個以上具體例子，不得泛稱缺少具體範例；只能指出哪些例子不夠精準、缺少哪一類典型例子，或缺少工程取捨。
4. missing_points 只能列真正未提及、明顯錯誤或說明不足的重點；每一點都要能從應試者回答中找到證據。
5. summary 必須同時反映「已答對的重點」與「真正需要補強的地方」，避免套版批評。
6. ideal_answer 應提供一份比參考答案更適合學習的完整回答；可以修正參考答案不足之處，但不要聲稱應試者沒提到他其實已經提到的內容。

嚴格評分標準（請務必遵守）：
- 90-100：優秀——涵蓋所有重點且有深度、有具體範例、能說明取捨
- 80-89：良好——涵蓋主要重點且有例子，但部分定義、邊界條件或工程取捨不夠精準
- 70-79：尚可——涵蓋基礎知識，但遺漏一個以上的重要概念，或例子明顯不足
- 60-69：不足——有明顯知識缺口或概念模糊不清
- 60以下：差——有嚴重錯誤或回答極度不完整

分數校準：
- 90+：回答完整、精準、有多個正確例子，並能說明實務取捨或常見陷阱。
- 80-88：主要概念完整、例子充足，但部分表達不精準、深度不足，或工程取捨說明較薄弱。
- 70-79：能說出基礎定義或列舉部分項目，但缺少關鍵定義、典型例子，或有數個概念混淆。
- 若回答已涵蓋題目要求的大部分核心項目，不要只因為口語化或少數用詞不精準就壓到 75 分以下。
- 若回答缺乏範例、明顯偏題或遺漏多個核心概念，才應落在 75 分以下。"""


class EvaluationProvider(ABC):
    @abstractmethod
    async def evaluate(
        self, question: str, reference_answer: str, transcript: str
    ) -> EvaluationResult:
        pass

    def _build_prompt(self, question: str, reference_answer: str, transcript: str) -> str:
        return SYSTEM_PROMPT_TEMPLATE.format(
            question=question,
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

    async def evaluate(
        self, question: str, reference_answer: str, transcript: str
    ) -> EvaluationResult:
        if settings.evaluation_offline_mode:
            return self._offline_result("openai", self.MODEL, transcript)

        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        prompt = self._build_prompt(question, reference_answer, transcript)
        response = await client.chat.completions.create(
            model=self.MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        result = self._parse_result(raw, "openai", self.MODEL)
        if not self._needs_traditional_chinese_localization(result):
            return result

        localized = await client.chat.completions.create(
            model=self.MODEL,
            messages=[{"role": "user", "content": self._build_localization_prompt(result)}],
            response_format={"type": "json_object"},
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
        self, question: str, reference_answer: str, transcript: str
    ) -> EvaluationResult:
        if settings.evaluation_offline_mode:
            return self._offline_result("claude", self.MODEL, transcript)

        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        prompt = self._build_prompt(question, reference_answer, transcript)
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

    async def evaluate(
        self, question: str, reference_answer: str, transcript: str
    ) -> EvaluationResult:
        if settings.evaluation_offline_mode:
            return self._offline_result("gemini", self.MODEL, transcript)

        import asyncio

        import google.generativeai as genai

        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel(
            self.MODEL,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json"
            ),
        )
        prompt = self._build_prompt(question, reference_answer, transcript)
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
