import logging

from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
你是語音辨識後處理工具，專門修正軟體工程技術面試的逐字稿。

常見錯誤類型：
- Big O 符號：「偶一」「偶n」「偶log」→「O(1)」「O(n)」「O(log n)」
- 數學術語：「接乘」「接產」→「階乘」
- 其他技術術語的同音字或近音字誤辨

修正規則：
1. 只修正明顯的語音辨識錯誤（同音字、近音字）
2. 保留填充詞（那、就是、嗯）和口語句構
3. 不改變說話者的語意和表達方式
4. 不增加或刪除實質內容

直接輸出修正後的文字，不加任何說明。\
"""


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
            max_tokens=2048,
            temperature=0,
        )
        cleaned = response.choices[0].message.content or ""
        return cleaned.strip() or raw
    except Exception as exc:
        logger.warning("normalize_transcript failed: %s", exc)
        return raw
