# 題目特定語音辨識關鍵字 (Question-Specific STT Keywords)

**Status:** Draft
**Date:** 2026-06-04
**Author:** brainstorming session

## 1. 問題與動機

目前 OpenAI Realtime API 的 transcription prompt（`backend/app/routers/realtime.py:160-171`）使用一份**靜態通用英文術語清單**，涵蓋 connection pool / deadlock / Redis / Kafka / XSS / Docker 等所有面試常用詞。

實測發現兩個問題：

1. **題目相關術語漏列**：例如 XSS 題會出現的 `innerHTML` 不在清單裡，導致 STT 把 `innerHTML` 誤識為 `inline HTML`，AI 評分器讀到失真文本後給出「未提及 `innerHTML`」的錯誤反饋。
2. **無關術語干擾**：回答 XSS 題時，清單上的 `deadlock`、`connection pool` 等與本題無關的詞反而可能誘導 STT 在不該出現英文的地方塞英文。

**目標**：將 transcription 的英文術語提示從「全局靜態清單」改為「每題客製化清單」，由 LLM 從題目語料自動萃取，避免無關詞污染並覆蓋該題真正會用到的術語。

## 2. 非目標

- **不**改 AI 評分器邏輯。本 change 只改進 STT 階段的英文術語辨識，下游評分維持現狀。
- **不**改 `normalize_transcript` 的策略。它「禁止替換英文單字」的保守規則維持不變。
- **不**在這個 change 加 UI 顯示 `raw_transcript` 對比。屬於另一個 change 的範圍。
- **不**處理題目編輯時 keywords 重跑（MVP 階段先不做，未來再加）。

## 3. 整體架構

```
                    ┌──────────────────────────────────┐
                    │  題目匯入時                        │
                    │  (LLM extract once, store in DB)  │
                    └──────────────┬───────────────────┘
                                   │
                                   ▼
                  ┌─────────────────────────────────┐
                  │  Question.transcription_keywords │
                  │  text[]                          │
                  └────────────────┬────────────────┘
                                   │
              ┌────────────────────┴───────────────────────┐
              ▼                                            ▼
    ┌────────────────────┐                    ┌────────────────────────┐
    │ Single mode        │                    │ Mock mode              │
    │                    │                    │                        │
    │ POST client-secret │                    │ POST client-secret     │
    │ + pinned_question_ │                    │ (沒題目)               │
    │   id               │                    │  ↓ base prompt only    │
    │  ↓                 │                    │ AI 呼叫 get_next_       │
    │ 後端查題 → 注入     │                    │ question 取得題目+      │
    │ transcription      │                    │ keywords                │
    │ prompt             │                    │  ↓                     │
    │                    │                    │ 前端發 session.update  │
    │                    │                    │ 更新 STT prompt        │
    └────────────────────┘                    └────────────────────────┘
              │                                            │
              └──────────────────┬─────────────────────────┘
                                 ▼
              ┌────────────────────────────────────┐
              │  STT 看到題目特定術語清單，          │
              │  正確辨識 innerHTML 等              │
              └────────────────────────────────────┘
```

**核心原則：**
- Keywords 在 DB 一份，多處消費（`client-secret` 路由、`/questions/next` 路由）
- single mode 走「靜態注入」，最早時機就 active
- mock mode 走「動態 session.update」，題目來才更新
- **完全取代**既有通用清單（不再附加）

## 4. 資料層

### 4.1 Question Schema 變更

`backend/app/models/question.py` 新增：

```python
transcription_keywords: Mapped[list[str]] = mapped_column(
    ARRAY(Text),
    nullable=False,
    server_default=sa_text("'{}'::text[]"),
    default=list,
)
```

格式約定：
- 元素：1-3 個英文 token 的技術術語，原拼字（保留大小寫、駝峰式）
- 空 array 合法
- 上限軟限制 ~15 個（在 LLM extraction prompt 規範）

### 4.2 Migration

新檔 `backend/alembic/versions/0004_add_transcription_keywords_to_questions.py`：

```python
def upgrade():
    op.add_column(
        "questions",
        sa.Column(
            "transcription_keywords",
            sa.dialects.postgresql.ARRAY(sa.Text),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )

def downgrade():
    op.drop_column("questions", "transcription_keywords")
```

### 4.3 Backfill

新建 CLI 命令（加進 `backend/app/cli.py` 或既有 admin scripts）：

```bash
python -m app.cli backfill_transcription_keywords
```

- 對 `transcription_keywords = '{}'` 的題目跑萃取並存回
- 可重複執行（idempotent）
- 失敗的題目記 log 但不中斷整批

## 5. LLM 萃取 Service

新增 `backend/app/services/transcription_keywords.py`。

### 5.1 對外介面

```python
async def extract_transcription_keywords(
    *,
    question_text: str,
    reference_answer: str,
    key_points: list[dict],
    common_mistakes: list[str],
) -> list[str]:
    ...
```

### 5.2 內部設計

- 模型：`gpt-4o-mini`（與 `normalize_transcript` 一致）
- `temperature=0`、`max_tokens=512`
- 使用 OpenAI Structured Outputs 強制 schema `{"keywords": ["str", ...]}`
- Offline 短路：`if settings.evaluation_offline_mode: return []`

### 5.3 System prompt 草稿

```
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
```

### 5.4 錯誤處理 / Filter

- LLM 呼叫失敗 → log warning + 回傳空 array
- 回傳 schema 不符 → log + 空 array
- 過濾：
  - 元素含中文字符 → 移除
  - 元素長度 > 40 字元 → 移除
  - 重複 → 去重保留首次出現順序

## 6. Single Mode 注入路徑

### 6.1 API contract 變更

`POST /realtime/client-secret` request body 擴充：

```python
class ClientSecretRequest(BaseModel):
    session_id: uuid.UUID
    pinned_question_id: uuid.UUID | None = None
```

### 6.2 後端流程

```python
async def create_client_secret(body, db, _):
    session = await _load_session(db, body.session_id)

    keywords: list[str] = []
    if body.pinned_question_id:
        question = await _load_question(db, body.pinned_question_id)
        keywords = question.transcription_keywords

    config = _build_realtime_session_config(session.mode, keywords)
    # 其餘照舊
```

### 6.3 Prompt 組裝重構

把現有 `realtime.py:160-171` 那段抽出：

```python
def _build_transcription_prompt(keywords: list[str]) -> str:
    base = (
        "這是一場後端工程師中文技術面試，應試者使用台灣繁體中文回答。"
        "請完整保留英文術語的原文拼寫，不要翻譯成中文、不要替換成其他相近詞、"
        "不要轉成拼音或假名。聽不清楚時保留原狀，不要猜測。"
    )
    if not keywords:
        return base
    terms = ", ".join(keywords)
    return f"{base} 本題可能會出現的英文術語：{terms}。"
```

**完整移除既有五行通用術語清單。**

### 6.4 前端變更

- `frontend/lib/api.ts::createClientSecret` 多接 `pinnedQuestionId?: string` 參數
- `RealtimeClient.connect()` 把已有的 `this.pinnedQuestionId` 串到 `createClientSecret` 呼叫

`pinnedQuestionId` 欄位已存在於 `RealtimeClient`（`realtimeClient.ts:51, 70`），不需重新引入。

### 6.5 Race condition

Keywords 在 client-secret 階段就注入 OpenAI session，第一個 transcription chunk 就會看到正確 prompt — 無時序問題。

## 7. Mock Mode 動態更新路徑

### 7.1 `/questions/next` response 擴充

`backend/app/routers/questions.py::get_next_question` 與 `services/sm2.py::select_next_question` 多帶 `transcription_keywords`：

```python
return {
    "question_id": ...,
    "question_text": ...,
    "category": ...,
    "difficulty": ...,
    "tags": ...,
    "transcription_keywords": question["transcription_keywords"] or [],
    "sm2": {...},
}
```

### 7.2 前端 NextQuestion 型別

`frontend/lib/api.ts`：

```typescript
export interface NextQuestion {
  // ...既有欄位
  transcription_keywords: string[];
}
```

### 7.3 動態 session.update

修改 `realtimeClient.ts::handleToolCall` 的 `get_next_question` 分支，在拿到題目後立刻發 session.update：

```typescript
if (name === "get_next_question") {
  const q = this.initialQuestion ?? (await getNextQuestion(...));
  // 既有處理 (pinned reset, currentQuestionId, buffer reset, hasSubmittedAnswer 等)
  this.updateTranscriptionKeywords(q.transcription_keywords ?? []);
  output = q;
}
```

新方法：

```typescript
private updateTranscriptionKeywords(keywords: string[]): void {
  const base = TRANSCRIPTION_BASE_PROMPT; // KEEP IN SYNC WITH backend
  const prompt = keywords.length === 0
    ? base
    : `${base} 本題可能會出現的英文術語：${keywords.join(", ")}。`;
  this.sendEvent({
    type: "session.update",
    session: {
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-transcribe",
            language: "zh",
            prompt,
          },
        },
      },
    },
  });
}
```

### 7.4 Base prompt 同步策略

前後端各自存一份 base prompt 常數：

- 後端：`backend/app/services/transcription_keywords.py` 或 `routers/realtime.py` 中的常數
- 前端：`frontend/lib/transcriptionPrompt.ts`

兩處皆加註解 `// KEEP IN SYNC WITH <other path>`。不加 lint rule 或自動測試（YAGNI）。

### 7.5 時序

`session.update` 在 AI 念題之前就送出 → 應試者開口前 prompt 已 active → 無 race。

### 7.6 Single mode 走這條嗎？

不需要。Single mode 在 client-secret 階段就注入了。Single mode 連線後已有的 `session.update`（設定 `turn_detection`，見 `realtimeClient.ts:110-119`）使用 partial merge，不會覆蓋 transcription 設定。

## 8. Edge Cases

| 情境 | 行為 |
|---|---|
| 題目沒 keywords (空 array) | Prompt 只給 base，等同 fallback |
| LLM 萃取失敗 | log warning → 存空 array |
| LLM 回傳含中文 / >40 字元的元素 | service 層 filter 掉 |
| `pinned_question_id` 指向不存在題目 | 回 404 |
| Offline mode | 萃取 service 直接回空 array |
| Mock mode 抓題 API 失敗 | 既有錯誤處理；不發 session.update |
| 既有未 backfill 題目 | server default 空 array → fallback base prompt |

## 9. Testing

### 9.1 Backend unit

- `services/transcription_keywords.py`: mock LLM client，assert prompt 內容、解析、filter、offline 短路
- `routers/realtime.py::_build_transcription_prompt`: 空 / 有 keywords 兩種 case
- `routers/realtime.py::create_client_secret`: 有 / 無 `pinned_question_id` 兩種 case（mock OpenAI client）
- `routers/questions.py::get_next_question`: response 含 `transcription_keywords`

### 9.2 Backend integration (e2e/api)

新增 `e2e/api/test_transcription_keywords.py`：
- 建含已知 keywords 的題目
- 用該題的 `pinned_question_id` 打 `/realtime/client-secret`
- intercept OpenAI 呼叫或檢查 log，確認 transcription prompt 含該題 keywords

### 9.3 Frontend (Playwright)

不新增 Playwright 測試（沒 UI 變更）。既有 single mode E2E 應持續通過。

### 9.4 手動驗收

匯入或 backfill 一道 XSS 題後：
1. 在前端 single mode 開始該題
2. 用語音念出原本失分的那段話（含 `innerHTML`、`輸出編碼` 等）
3. 對照 DB 中 attempt 的 `raw_transcript` vs `transcript`，確認 `innerHTML` 不再被誤識為 `inline HTML`
4. AI 評分反饋不再出現「未提及 innerHTML」

## 10. Open Questions

無。所有設計選擇已於 brainstorming session 拍板。

## 11. Out of Scope

- UI 顯示 `raw_transcript` 對比 → 屬於另一個 change
- 題目編輯時自動重跑 keywords → MVP 後再加
- 萃取 service 加 lint / 自動測試確保 base prompt 同步 → YAGNI
