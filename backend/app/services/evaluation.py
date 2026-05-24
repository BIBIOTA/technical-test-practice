import json
from abc import ABC, abstractmethod

from pydantic import BaseModel

from app.config import settings


class EvaluationResult(BaseModel):
    score: int  # 0-100
    summary: str
    missing_points: list[str]
    next_focus: list[str]
    provider: str
    model: str


SYSTEM_PROMPT_TEMPLATE = """You are an expert technical interviewer evaluating a candidate's answer.

Question: {question}
Reference Answer: {reference_answer}
Candidate's Answer: {transcript}

Evaluate the answer and return ONLY a JSON object with these exact fields:
- score: integer 0-100 (overall quality)
- summary: string (2-3 sentence evaluation)
- missing_points: array of strings (key points the candidate missed)
- next_focus: array of strings (specific areas to improve)
- provider: string (your provider name)
- model: string (model name used)

Be fair but rigorous. A score of 90+ means an excellent answer covering all key points."""


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
        data["score"] = max(0, min(100, int(data["score"])))
        return EvaluationResult(**data)

    def _offline_result(self, provider: str, model: str, transcript: str) -> EvaluationResult:
        words = [word for word in transcript.split() if word.strip()]
        score = min(95, max(55, 45 + len(words) * 3))
        return EvaluationResult(
            score=score,
            summary="Offline test evaluation completed with the fixed schema.",
            missing_points=[] if score >= 75 else ["Add more concrete technical detail."],
            next_focus=["Use specific examples and tradeoffs."],
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
        return self._parse_result(raw, "openai", self.MODEL)


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
