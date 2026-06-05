import logging

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
你是語音辨識後處理工具，專門修正軟體工程技術面試的繁體中文逐字稿。

允許修正的錯誤類型（僅限這幾類）：
- Big O 符號的中文近音字：「偶一」「偶n」「偶log」→「O(1)」「O(n)」「O(log n)」
- 中文技術術語的近音字：「接乘」「接產」→「階乘」
- 其他明確的「中文近音字 → 標準中文技術術語」誤辨

嚴格禁止：
1. 不得替換或猜測任何英文單字。即使拼字看起來錯誤、或像是無意義音譯，也必須**完全保留原樣**。例如輸入「Serifo abdedevansu」就照樣輸出「Serifo abdedevansu」，不可猜成「Serializable」「Service」「Serif」等任何單字。
2. 不得「填補」聽不懂的片段。若某段話無意義或不確定其意圖，保留原樣。
3. 不得刪除、重述或縮短任何內容。填充詞「那、就是、嗯」和不完整句子都要保留。
4. 不得新增說話者沒明確說出的內容，即使覺得是「合理推測」也不行。
5. 不得翻譯英文 → 中文，也不得翻譯中文 → 英文。

直接輸出修正後的文字，不加任何說明、註解或推測。\
"""

_LENGTH_DELTA_THRESHOLD = 0.3


async def normalize_transcript(raw: str) -> str:
    if not raw.strip():
        return raw
    if settings.evaluation_offline_mode:
        return raw
    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": raw},
            ],
            max_tokens=4096,
            temperature=0,
        )
        cleaned = (response.choices[0].message.content or "").strip()
        if not cleaned:
            return raw
        raw_len = len(raw)
        if raw_len > 0 and abs(len(cleaned) - raw_len) / raw_len > _LENGTH_DELTA_THRESHOLD:
            logger.warning(
                "normalize_transcript length delta exceeded %.0f%%: %d → %d chars, falling back to raw",
                _LENGTH_DELTA_THRESHOLD * 100,
                raw_len,
                len(cleaned),
            )
            return raw
        return cleaned
    except Exception as exc:
        logger.warning("normalize_transcript failed: %s", exc)
        return raw
