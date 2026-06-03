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
    "reference_answer": """...""",
},
```

**Categories in use:** `algorithms`, `auth`, `backend`, `database`, `llm-engineering`, `testing`

**Difficulty guide:**
- `easy` — definitional / conceptual (BDD vs TDD, black-box vs white-box)
- `medium` — requires explanation with examples (time complexity, JWT flow)
- `hard` — design & trade-offs required (race condition strategies, distributed lock)

### 4. Write the reference answer

**Do:** Extract the key framework (tables, code snippets, decision criteria) from the article in 150–300 words.

**Do not:** Copy the article verbatim. Skip intros, outros, and references sections.

Structure that works well:
```
## 核心觀念 / Core Pattern
Brief definition (1–3 sentences)

## Method / Strategy Table
| 方法 | 優點 | 缺點 | 適用場景 |

## Code Example (if central to the topic)
```code```

## 實務要點
2–4 bullet points
```

### 5. Run seed script

```bash
docker-compose exec backend python scripts/seed_questions.py
# Expected: Done: N questions upserted
```

If containers are not running:
```bash
docker-compose up -d --build
until curl -sf http://localhost:8001/health > /dev/null; do sleep 2; done
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
