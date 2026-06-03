"""
Backfill key_points + common_mistakes for existing questions.

Reads QUESTIONS list from seed_questions.py, calls Claude Haiku for each
entry whose key_points is empty, and writes a complete new file
seed_questions.py.draft for human review via `git diff --no-index`.

Usage (run locally, not in container):
    ANTHROPIC_API_KEY=... python backend/scripts/backfill_question_rubric.py

Output:
    backend/scripts/seed_questions.py.draft

Idempotency:
    Questions whose key_points is already non-empty are kept as-is.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import anthropic  # noqa: E402

from scripts.seed_questions import QUESTIONS  # type: ignore  # noqa: E402

MODEL = "claude-haiku-4-5-20251001"

EXTRACT_TOOL = {
    "name": "submit_rubric",
    "description": "Submit structured evaluation rubric for an interview question.",
    "input_schema": {
        "type": "object",
        "properties": {
            "key_points": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "point": {"type": "string"},
                        "tier": {"type": "string", "enum": ["core", "bonus"]},
                    },
                    "required": ["point", "tier"],
                },
            },
            "common_mistakes": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["key_points", "common_mistakes"],
    },
}

EXTRACT_PROMPT = """你正在為一份面試題庫補上結構化評分要點。請從題目與參考答案中萃取：

題目：{text}
難度：{difficulty}
參考答案：
{reference_answer}

請輸出 JSON（必須使用繁體中文）：
- key_points: 4-12 項，每項 {{point: str, tier: "core" | "bonus"}}
  - core 4-8 個（缺一即明顯扣分的主幹概念）
  - bonus 2-4 個（深度、工程取捨、具體例子）
- common_mistakes: 2-5 項，描述「應試者會犯什麼錯」（非「該怎麼做」）

每項 1-2 句、具體、可作為打勾陳述。不要重複 reference_answer 整段。"""


async def extract_rubric(client: anthropic.AsyncAnthropic, question: dict) -> dict:
    message = await client.messages.create(
        model=MODEL,
        max_tokens=2048,
        tools=[EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "submit_rubric"},
        messages=[
            {
                "role": "user",
                "content": EXTRACT_PROMPT.format(
                    text=question["text"],
                    difficulty=question["difficulty"],
                    reference_answer=question["reference_answer"],
                ),
            }
        ],
    )
    for block in message.content:
        if hasattr(block, "input"):
            return dict(block.input)
    raise RuntimeError("Claude returned no tool_use block")


def format_key_points(key_points: list[dict]) -> str:
    """Render key_points as a Python literal that matches seed_questions.py style."""
    lines = ["["]
    for kp in key_points:
        point = kp["point"].replace('"', '\\"')
        tier = kp["tier"]
        lines.append(f'            {{"point": "{point}", "tier": "{tier}"}},')
    lines.append("        ]")
    return "\n".join(lines)


def format_common_mistakes(mistakes: list[str]) -> str:
    lines = ["["]
    for m in mistakes:
        text = m.replace('"', '\\"')
        lines.append(f'            "{text}",')
    lines.append("        ]")
    return "\n".join(lines)


async def main() -> None:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY 未設定", file=sys.stderr)
        sys.exit(1)

    client = anthropic.AsyncAnthropic(api_key=api_key)

    enriched: list[dict] = []
    for idx, q in enumerate(QUESTIONS, 1):
        title = q["text"][:60]
        if q.get("key_points"):
            print(f"[{idx}/{len(QUESTIONS)}] SKIP (已有 key_points): {title}")
            enriched.append(q)
            continue
        print(f"[{idx}/{len(QUESTIONS)}] 萃取中: {title}...")
        try:
            rubric = await extract_rubric(client, q)
        except Exception as exc:
            print(f"  WARN: 萃取失敗 ({exc})；保留空 rubric")
            rubric = {"key_points": [], "common_mistakes": []}
        enriched.append({**q, **rubric})
        print(f"  key_points: {len(rubric['key_points'])} 項；common_mistakes: {len(rubric['common_mistakes'])} 項")

    # 讀原檔，找到 QUESTIONS = [ ... ] 區塊，置換每筆 entry 內插入兩個新欄位。
    # 由於 entry 太複雜（含 triple-quoted strings），最安全的做法是輸出一份
    # JSON sidecar，由人工套用。但為符合「diff 友善」需求，我們直接重新
    # 渲染整份檔案結尾 QUESTIONS 區塊。
    source_path = Path(__file__).parent / "seed_questions.py"
    draft_path = Path(__file__).parent / "seed_questions.py.draft"

    src = source_path.read_text(encoding="utf-8")

    # 把 enriched rubric 寫到 sidecar JSON 給人工套用（保險）
    sidecar_path = Path(__file__).parent / "rubric_drafts.json"
    sidecar_path.write_text(
        json.dumps(
            [
                {
                    "notion_id": q["notion_id"],
                    "text_snippet": q["text"][:80],
                    "key_points": q.get("key_points", []),
                    "common_mistakes": q.get("common_mistakes", []),
                }
                for q in enriched
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # .draft：把每個 entry 在 "tags": [...] 之後插入 "key_points" + "common_mistakes"
    # 用 notion_id 精準定位每筆 entry。
    new_src = src
    for q in enriched:
        if not q.get("key_points"):
            continue
        kp_block = format_key_points(q["key_points"])
        cm_block = format_common_mistakes(q["common_mistakes"])
        marker = f'"notion_id": "{q["notion_id"]}",'
        idx = new_src.find(marker)
        if idx < 0:
            print(f"  WARN: 找不到 notion_id={q['notion_id']} 在原檔中，跳過")
            continue
        # 找到此 entry 的 "tags": [...] 行尾
        tags_idx = new_src.find('"tags":', idx)
        if tags_idx < 0:
            print(f"  WARN: 找不到 tags 欄位於 notion_id={q['notion_id']}")
            continue
        tags_end = new_src.find("],", tags_idx) + 2
        insertion = (
            f'\n        "key_points": {kp_block},'
            f'\n        "common_mistakes": {cm_block},'
        )
        # 避免重複插入：檢查後一段是否已有 key_points
        next_200 = new_src[tags_end : tags_end + 200]
        if '"key_points"' in next_200:
            continue
        new_src = new_src[:tags_end] + insertion + new_src[tags_end:]

    draft_path.write_text(new_src, encoding="utf-8")
    print(f"\nDone. 輸出：")
    print(f"  {draft_path}")
    print(f"  {sidecar_path}  (JSON sidecar，給人工套用備用)")
    print(f"\n下一步：")
    print(f"  git diff --no-index {source_path} {draft_path}")


if __name__ == "__main__":
    asyncio.run(main())
