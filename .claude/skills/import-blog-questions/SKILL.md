---
name: import-blog-questions
description: Use when new tech articles are published on bibiota-blog and you want to add the corresponding interview questions to this project's seed script.
---

# Import Blog Questions

## Overview

Reads new articles from `bibiota-blog`, identifies those not yet seeded, and adds structured interview questions to `backend/scripts/seed_questions.py`. Does **not** copy articles verbatim — extracts key points into concise reference answers.

## Source & Destination

| | Path |
|---|---|
| Blog articles | `/Users/bibiota/Documents/projects/bibiota-blog/docs/tech/posts/` |
| Seed script | `backend/scripts/seed_questions.py` → `QUESTIONS` list |
| API verification | `GET /questions` with `Authorization: Bearer <INTERVIEW_TOKEN>` |

## Process

### 1. Find new articles

```bash
ls /Users/bibiota/Documents/projects/bibiota-blog/docs/tech/posts/
```

Compare filenames with existing `notion_id` values and question texts in `seed_questions.py` to identify which articles are not yet seeded.

### 2. Read each new article

Read the full markdown content. Note the article's topic, structure, and key concepts.

### 3. Add question entry to QUESTIONS list

Append a new dict **before** the closing `]` of the `QUESTIONS` list:

```python
{
    "id": uuid.uuid4(),
    "notion_id": "<unique-uuid>",          # generate a new UUID, never reuse
    "text": "...",                          # interview question in Traditional Chinese
    "category": "<category>",
    "difficulty": "<easy|medium|hard>",
    "tags": ["tag1", "tag2"],
    "key_points": [
        {"point": "...", "tier": "core"},
        {"point": "...", "tier": "core"},
        {"point": "...", "tier": "bonus"},
    ],
    "common_mistakes": [
        "...",
        "...",
    ],
    "reference_answer": """...""",
},
```

**Categories in use:** `algorithms`, `auth`, `backend`, `database`, `llm-engineering`, `testing`

**Difficulty guide:**
- `easy` — definitional / conceptual (BDD vs TDD, black-box vs white-box)
- `medium` — requires explanation with examples (time complexity, JWT flow)
- `hard` — design & trade-offs required (race condition strategies, distributed lock)

### 4. 從文章萃取三組內容

#### 4a. key_points（核心評分要點）
從文章主要 H2/H3 段落、表格與決策準則中萃取，每項 1-2 句、可作為「評分能否打勾」的具體陳述。

- 標 `core`：缺一個就明顯扣分（題目的「主幹」概念）
- 標 `bonus`：提到能往 85+ 推（深度、工程取捨、具體例子）

數量參考：core 4-8 個、bonus 2-4 個。

#### 4b. common_mistakes（常見誤區）
從文章「注意事項 / 常見錯誤 / 反例」段落，或對照部落格上的反模式段落擷取。每項描述「應試者會犯什麼錯」而非「該怎麼做」。

數量參考：2-5 個。

#### 4c. reference_answer
仍寫成 150-300 字的 markdown，但角色改變：**不再是 LLM 評分的依據，而是產生 ideal_answer 的素材**。可比 key_points 更敘述化、有 code snippet。

注意：reference_answer 與 key_points 不要互相重複；reference 用「為什麼 / 怎麼用」敘事，key_points 用「該講什麼」清單。

Structure that works well for reference_answer:
```
## 核心觀念 / Core Pattern
Brief definition (1–3 sentences)

## Method / Strategy Table
| 方法 | 優點 | 缺點 | 適用場景 |

## Code Example (if central to the topic)
` `` `code` `` `

## 實務要點
2–4 bullet points
```

### 5. Run seed script

The backend image has no volume mount — copy the updated file into the running container first:

```bash
docker cp backend/scripts/seed_questions.py technical-test-practice-backend-1:/app/scripts/seed_questions.py
docker-compose exec backend python scripts/seed_questions.py
# Expected: Done: N questions upserted
```

If containers are not running:
```bash
docker-compose up -d --build
until curl -sf http://localhost:8001/health > /dev/null; do sleep 2; done
docker cp backend/scripts/seed_questions.py technical-test-practice-backend-1:/app/scripts/seed_questions.py
docker-compose exec backend python scripts/seed_questions.py
```

### 6. Verify via API

```bash
TOKEN=$(grep INTERVIEW_TOKEN .env | cut -d= -f2)
curl -sf -H "Authorization: Bearer $TOKEN" http://localhost:8001/questions \
  | python3 -c "import json,sys; [print(f\"[{q['category']}/{q['difficulty']}] {q['question_text']}\") for q in json.load(sys.stdin)]"
```

Confirm the new questions appear with correct category and difficulty.

### 7. Commit and push

```bash
git add backend/scripts/seed_questions.py
git commit -m "feat: add N new seed questions from bibiota-blog (<topics>)"
git push origin main
```

## Common Mistakes

| Mistake | Fix |
|---|---|
| Reusing an existing `notion_id` | Always generate a fresh UUID; the DB upserts on this field |
| Copying article verbatim | Write a synthesized reference answer (key points only) |
| Forgetting `uuid.uuid4()` for `id` | `id` must be generated at runtime, not a hardcoded UUID string |
| Wrong category string | Check existing categories in the table above before adding a new one |
| 把 reference_answer 整段抄成 key_points | key_points 是清單條目，不是段落；每條獨立可被打勾 |
| 全部 key_points 都標 core | 沒有 bonus 會讓 90+ 分無法達成；要區分「主幹」與「深度加分」 |
| common_mistakes 寫成「應該怎麼做」 | 應描述「應試者會犯什麼錯」，例如「混淆 A 與 B」「以為 X 一定比 Y 快」 |
