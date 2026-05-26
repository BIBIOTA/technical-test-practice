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

嚴格評分標準（請務必遵守）：
- 90-100：優秀——涵蓋所有重點且有深度、有具體範例、能說明取捨
- 80-89：良好——涵蓋主要重點，但缺乏深度或缺少具體範例
- 70-79：尚可——涵蓋基礎知識，但遺漏一個以上的重要概念
- 60-69：不足——有明顯知識缺口或概念模糊不清
- 60以下：差——有嚴重錯誤或回答極度不完整

重要：大多數回答應落在 65-80 分。只有在回答極為完整、深入且有具體範例時才給 90+。
若回答模糊、缺乏範例、或遺漏關鍵點，至多給 75 分。"""


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
            summary="離線測試評估已完成。",
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
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text if message.content else "{}"
        return self._parse_result(raw, "claude", self.MODEL)


class GeminiEvaluationProvider(EvaluationProvider):
    MODEL = "gemini-1.5-flash"

    async def evaluate(
        self, question: str, reference_answer: str, transcript: str
    ) -> EvaluationResult:
        if settings.evaluation_offline_mode:
            return self._offline_result("gemini", self.MODEL, transcript)

        import asyncio

        import google.generativeai as genai

        genai.configure(api_key=settings.gemini_api_key)
        model = genai.GenerativeModel(self.MODEL)
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
