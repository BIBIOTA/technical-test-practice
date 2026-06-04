import json
import logging
import re
from typing import Any

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_MAX_KEYWORDS = 15

_SYSTEM_PROMPT = """\
你的任務是從一道後端工程師中文技術面試題目的參考答案中，
找出「應試者用繁體中文回答時，會混入的英文技術術語」，
專門用來提示語音辨識（STT）正確拼寫這些術語。

規則：
1. 只列出英文 token 是「容易被中文 STT 誤判或音譯」的術語
   - 例：innerHTML 容易被聽成 "inline HTML"
   - 例：dangerouslySetInnerHTML、DOMPurify、CSRF token
2. 不要列出已經是極常見、STT 不會錯的詞（HTTP、JSON、API 這類除非該題核心）
3. 不要列出中文詞、不要翻譯
4. 每個元素 1-3 個英文 token，使用原始拼字（保留大小寫、駝峰式）
5. 上限 15 個
6. 沒有合適術語時，回傳空 array

只回傳 JSON：{"keywords": [...]}。
"""

_RESPONSE_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "transcription_keywords",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "keywords": {
                    "type": "array",
                    "maxItems": _MAX_KEYWORDS,
                    "items": {"type": "string"},
                },
            },
            "required": ["keywords"],
        },
        "strict": True,
    },
}

_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_PLAUSIBLE_KEYWORD_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+#._:/() -]*$")


async def extract_transcription_keywords(
    *,
    question_text: str,
    reference_answer: str,
    key_points: list[dict],
    common_mistakes: list[str],
) -> list[str]:
    if settings.evaluation_offline_mode:
        return []

    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": _build_user_content(
                        question_text=question_text,
                        reference_answer=reference_answer,
                        key_points=key_points,
                        common_mistakes=common_mistakes,
                    ),
                },
            ],
            temperature=0,
            max_tokens=512,
            response_format=_RESPONSE_SCHEMA,
        )
        content = response.choices[0].message.content or ""
        data = json.loads(content)
        return _sanitize(data.get("keywords", []))
    except Exception as exc:
        logger.warning("extract_transcription_keywords failed: %s", exc)
        return []


def _build_user_content(
    *,
    question_text: str,
    reference_answer: str,
    key_points: list[dict],
    common_mistakes: list[str],
) -> str:
    key_point_values = [item.get("point", "") for item in key_points if isinstance(item, dict)]
    return "\n\n".join(
        [
            f"題目：\n{question_text}",
            f"參考答案：\n{reference_answer}",
            "關鍵點：\n" + _bulleted(key_point_values),
            "常見錯誤：\n" + _bulleted(common_mistakes),
        ]
    )


def _bulleted(values: list[Any]) -> str:
    items = [str(value).strip() for value in values if str(value).strip()]
    if not items:
        return "（無）"
    return "\n".join(f"- {item}" for item in items)


def _sanitize(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []

    seen = set()
    keywords: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        keyword = value.strip()
        if keyword in seen or not _is_plausible_keyword(keyword):
            continue
        seen.add(keyword)
        keywords.append(keyword)
        if len(keywords) >= _MAX_KEYWORDS:
            break
    return keywords


def _is_plausible_keyword(value: str) -> bool:
    if not value or len(value) > 40:
        return False
    if "\n" in value or "\r" in value:
        return False
    if _CJK_RE.search(value):
        return False
    if len(value.split()) > 3:
        return False
    if not any(char.isalpha() for char in value):
        return False
    return bool(_PLAUSIBLE_KEYWORD_RE.fullmatch(value))
