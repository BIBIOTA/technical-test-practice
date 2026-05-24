# OpenAI Realtime 面試練習系統 — 設計文件

**日期：** 2026-05-24
**版本：** v1

---

## 1. 產品目標

建立一個本機運行的語音面試練習系統。題庫由 Claude Code 從 Notion 匯入 PostgreSQL，使用者透過 OpenAI Realtime API 進行語音面試，系統記錄 transcript 並以 OpenAI / Claude / Gemini 任一 LLM 評分，根據 SM-2 間隔複習算法優先出現較不熟悉的題目。

---

## 2. 系統邊界與決策

| 項目 | 決策 | 理由 |
|------|------|------|
| 使用者範圍 | 單人私用 | 無需完整 auth，靜態 token 即可 |
| Notion 同步 | Claude Code 手動操作 DB | 不需要 sync worker 或排程 |
| 評分時序 | 非同步 + 語音佔位 | AI 先說佔位語，背景評分，前端輪詢 |
| 熟練度算法 | 完整 SM-2 | 最科學的間隔複習調度 |
| 部署環境 | 本機 Docker Compose | 三個 container，無雲端需求 |
| Queue / Worker | 無（FastAPI BackgroundTasks） | 單人本機不需要 Celery + Redis |

---

## 3. 整體架構

```
┌─────────────────────────────────────────────────┐
│  Docker Compose (local)                         │
│                                                 │
│  ┌──────────┐    ┌──────────┐    ┌───────────┐ │
│  │ Next.js  │◄──►│ FastAPI  │◄──►│ Postgres  │ │
│  │ :3000    │    │ :8000    │    │ :5432     │ │
│  └────┬─────┘    └──────────┘    └───────────┘ │
│       │ WebRTC                                  │
└───────┼─────────────────────────────────────────┘
        ▼
   OpenAI Realtime API (外部)

Evaluation Providers (外部):
  OpenAI / Claude / Gemini
```

**移除元件（相較原始 spec）：**
- Redis — 改用 DB polling
- Celery / Dramatiq — 改用 FastAPI BackgroundTasks
- Notion sync worker — Claude Code 直接操作 DB
- Auth service — 靜態 INTERVIEW_TOKEN

---

## 4. 資料庫 Schema

### questions
| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID PK | |
| notion_id | TEXT UNIQUE NULLABLE | 防重複匯入；直接新增的題目可為 null |
| text | TEXT | 題目內容 |
| category | TEXT | e.g. system-design, backend |
| difficulty | TEXT | easy \| medium \| hard |
| reference_answer | TEXT | 供評分參考 |
| tags | TEXT[] | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### interview_sessions
| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID PK | |
| mode | TEXT | single \| mock \| weak_review |
| status | TEXT | active \| completed \| aborted |
| eval_provider | TEXT | openai \| claude \| gemini |
| started_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |

### attempts
| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID PK | |
| session_id | UUID FK | → interview_sessions |
| question_id | UUID FK | → questions |
| transcript | TEXT | 使用者語音轉文字 |
| status | TEXT | pending_evaluation \| completed \| failed |
| score | INT | 0-100 |
| evaluation | JSONB | 固定 schema（見下） |
| created_at | TIMESTAMPTZ | |

### sm2_states
| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID PK | |
| question_id | UUID UNIQUE FK | → questions |
| ease_factor | FLOAT | 初始 2.5 |
| interval_days | INT | 初始 1 |
| repetitions | INT | 連續答對次數 |
| next_review_at | TIMESTAMPTZ | 下次應複習時間 |
| last_score | INT | |
| updated_at | TIMESTAMPTZ | |

### realtime_sessions
| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID PK | |
| interview_session_id | UUID FK | → interview_sessions |
| openai_session_id | TEXT | OpenAI 回傳的 session id |
| started_at | TIMESTAMPTZ | |
| ended_at | TIMESTAMPTZ | |

### Evaluation JSONB Schema
```json
{
  "score": 78,
  "summary": "回答方向正確，但缺少 retry、idempotency、DLQ",
  "missing_points": ["retry policy", "idempotency", "dead letter queue"],
  "next_focus": ["idempotency", "DLQ"],
  "provider": "claude",
  "model": "claude-sonnet-4-6"
}
```

---

## 5. API 端點

| Method | Path | 說明 |
|--------|------|------|
| POST | /sessions | 建立 interview_session |
| POST | /sessions/{id}/complete | 結束 session |
| GET | /sessions/{id}/summary | 取得本次 session 整體報告（mock 模式用） |
| POST | /realtime/client-secret | 產生 OpenAI ephemeral token |
| GET | /questions/next | SM-2 選題（供 AI tool call） |
| POST | /attempts | mark_answer_completed（供 AI tool call） |
| GET | /attempts/{id}/result | 評分輪詢 |
| GET | /attempts/{id}/summary | 取得語音回饋摘要（供 AI tool call） |

所有端點須帶 `Authorization: Bearer <INTERVIEW_TOKEN>` header。

---

## 6. Realtime 語音流程

```
Frontend          Backend           OpenAI Realtime      Eval Provider
   │                  │                    │                   │
   │─POST /sessions──►│                    │                   │
   │◄─session_id──────│                    │                   │
   │                  │                    │                   │
   │─POST /realtime/client-secret─────────►│                   │
   │◄─ephemeral_token─│                    │                   │
   │                  │                    │                   │
   │─WebRTC connect───────────────────────►│                   │
   │◄─voice: "請問第一題..."───────────────│                   │
   │                  │                    │                   │
   │ [使用者語音回答]  │                    │                   │
   │                  │                    │                   │
   │ [AI tool call: mark_answer_completed] │                   │
   │─POST /attempts──►│                    │                   │
   │◄─attempt_id──────│                    │                   │
   │                  │─BackgroundTask────────────────────────►│
   │                  │  (非同步評分)       │                   │
   │                  │                    │                   │
   │ [AI 說：「讓我整理一下你的回答...」]  │                   │
   │                  │                    │                   │
   │─GET /attempts/{id}/result (polling 每2秒)                 │
   │◄─status: completed, score: 78─────────                    │
   │                  │◄───────────────────────────────────────│
   │                  │  (寫入 DB, 更新 SM-2)                  │
   │                  │                    │                   │
   │ [AI tool call: get_evaluation_summary]│                   │
   │─GET /attempts/{id}/summary───────────►│                   │
   │◄─summary JSON────│                    │                   │
   │ [AI 語音播報回饋] │                    │                   │
```

**Polling 規則：**
- 每 2 秒一次，最多 30 秒 timeout
- `pending_evaluation` → 繼續輪詢
- `completed` → 觸發 `get_evaluation_summary` tool call
- `failed` → AI 說「評分暫時無法取得，繼續下一題」

---

## 7. Realtime Agent 行為規格

### AI 面試官人格
- 語言：繁體中文
- 角色：Senior Backend Engineer interviewer
- 語氣：自然、專業，不過度鼓勵
- 一次只問一題，不洩漏參考答案

### Session Instructions
```
你是一位 Senior Backend Engineer 面試官，正在用繁體中文對使用者進行語音面試練習。

規則：
1. 一次只問一題。
2. 不要主動提供參考答案。
3. 使用者回答時保持安靜，不要頻繁插話。
4. 使用者說「回答完畢」、「我講完了」、「下一題」時，視為本題回答結束。
5. 如果使用者沉默太久，可以問：「需要提示嗎？」
6. 如果使用者要求提示，只提供方向，不提供完整答案。
7. 每題最多追問 1 次。
8. 回饋要簡短，完整評分由後端 Evaluation Service 產生。
9. 不要自行編造不存在的題目，題目必須由後端提供。
```

### Tool Calling 規格

**get_next_question**
```json
Input:  { "session_id": "string", "category": "string|null", "difficulty": "string|null", "mode": "single|mock|weak_review" }
Output: { "question_id": "string", "question_text": "string", "category": "string", "difficulty": "easy|medium|hard" }
```

**mark_answer_completed**
```json
Input:  { "session_id": "string", "question_id": "string", "final_transcript": "string" }
Output: { "attempt_id": "string", "status": "pending_evaluation" }
```

**get_evaluation_summary**
```json
Input:  { "attempt_id": "string" }
Output: { "score": 78, "summary": "string", "missing_points": ["string"], "next_focus": ["string"] }
```

---

## 8. SM-2 算法

### 分數轉 Grade
| 分數 | Grade |
|------|-------|
| 90-100 | 5 |
| 75-89 | 4 |
| 60-74 | 3 |
| 40-59 | 2 |
| 20-39 | 1 |
| 0-19 | 0 |

### 更新邏輯
```python
def update_sm2(state: SM2State, score: int) -> SM2State:
    grade = score_to_grade(score)

    if grade >= 3:  # 答對
        if state.repetitions == 0:
            interval = 1
        elif state.repetitions == 1:
            interval = 6
        else:
            interval = round(state.interval_days * state.ease_factor)
        repetitions = state.repetitions + 1
    else:           # 答錯，重置
        interval = 1
        repetitions = 0

    ease_factor = max(1.3,
        state.ease_factor + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)
    )

    return SM2State(
        ease_factor=ease_factor,
        interval_days=interval,
        repetitions=repetitions,
        next_review_at=now() + timedelta(days=interval),
        last_score=score,
    )
```

### 選題 SQL
```sql
SELECT q.* FROM questions q
LEFT JOIN sm2_states s ON s.question_id = q.id
WHERE q.category = :category      -- 可選過濾
  AND q.difficulty = :difficulty  -- 可選過濾
ORDER BY
  -- 無 sm2_state 的新題目最優先
  CASE WHEN s.id IS NULL THEN 0 ELSE 1 END,
  -- 已到複習時間的題目優先
  CASE WHEN s.next_review_at <= NOW() THEN 0 ELSE 1 END,
  s.next_review_at ASC,
  s.last_score ASC NULLS FIRST
LIMIT 1
```

新題目（無 sm2_state）自動建立初始狀態，`next_review_at = NOW()`，視為最高優先。

---

## 9. 面試模式

| 模式 | 說明 |
|------|------|
| single | 單題練習，回答後立即評分，適合學習新題 |
| mock | 多題模擬面試，依 SM-2 排序，最後產生整體報告 |
| weak_review | 弱點複習，強制只出 next_review_at 已到期且低分題 |

---

## 10. 專案結構

```
technical-test-practice/
├── docker-compose.yml
├── .env.example
│
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic/
│   │   └── versions/
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── database.py
│       ├── deps.py                # verify_token dependency
│       ├── models/
│       │   ├── question.py
│       │   ├── session.py
│       │   ├── attempt.py
│       │   ├── sm2_state.py
│       │   └── realtime_session.py
│       ├── schemas/
│       ├── routers/
│       │   ├── realtime.py
│       │   ├── sessions.py
│       │   ├── attempts.py
│       │   └── questions.py
│       └── services/
│           ├── evaluation/
│           │   ├── base.py        # EvaluationProvider ABC
│           │   ├── openai.py
│           │   ├── claude.py
│           │   └── gemini.py
│           ├── sm2.py
│           ├── question_selector.py
│           └── realtime.py
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── app/
│       │   ├── page.tsx
│       │   └── interview/
│       │       └── page.tsx
│       ├── components/
│       │   ├── InterviewRoom.tsx
│       │   ├── TranscriptPanel.tsx
│       │   └── EvalResultCard.tsx
│       └── lib/
│           ├── realtimeClient.ts
│           └── api.ts
│
└── docs/
    └── superpowers/
        └── specs/
```

---

## 11. 環境變數（.env.example）

```env
# Auth
INTERVIEW_TOKEN=change-me

# Database
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/interview_practice

# OpenAI
OPENAI_API_KEY=sk-...

# Evaluation Providers (選填，依需求填入)
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# Evaluation 預設 provider
DEFAULT_EVAL_PROVIDER=claude
```
