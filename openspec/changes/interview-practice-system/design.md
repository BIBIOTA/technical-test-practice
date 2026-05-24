## Context

Greenfield 本機系統，單一使用者，透過 Docker Compose 執行。題庫由 Claude Code 從 Notion 手動匯入 PostgreSQL。語音面試透過 OpenAI Realtime API + WebRTC 實作，評分層支援 OpenAI / Claude / Gemini 三個 provider。系統需根據 SM-2 間隔複習算法選題。

無既有程式碼需遷移，無雲端部署需求，無多使用者 auth 需求。

## Goals / Non-Goals

**Goals:**
- 本機 Docker Compose 一鍵啟動（postgres + backend + frontend）
- OpenAI Realtime API WebRTC 語音面試，AI 透過 tool calling 與後端互動
- 評分非同步執行，前端輪詢結果，AI 以語音佔位等待
- SM-2 算法驅動選題，新題 → 到期題 → 低分題排序
- 多 LLM 評分 provider，固定輸出 JSON schema
- 靜態 Bearer token auth（單人私用）

**Non-Goals:**
- 雲端部署 / 多環境配置
- 多使用者 / OAuth / session auth
- 自動 Notion sync（Claude Code 手動操作 DB）
- 音訊檔案存檔（不需要 object storage）
- 即時通知（不需要 WebSocket / Redis pub-sub）

## Decisions

### D1：使用 FastAPI BackgroundTasks 而非 Celery + Redis

**決定**：評分非同步執行使用 FastAPI `BackgroundTasks`，前端 2 秒 polling 輪詢結果。

**理由**：單人本機無並發壓力。BackgroundTasks 在同一 process 內執行，零額外依賴。Celery + Redis 需要額外 container 和 worker 管理，對此場景過度設計。

**替代方案考慮**：Redis pub-sub + SSE — 延遲更低但引入 Redis；asyncio.create_task — 同效果但 BackgroundTasks 整合更乾淨。

---

### D2：WebRTC ephemeral token 模式（非 server-side proxy）

**決定**：後端產生 OpenAI Realtime ephemeral client secret，前端直接以 WebRTC 連線 OpenAI Realtime API。

**理由**：標準 API key 只存後端，ephemeral token 短效（有 expires_at），符合 OpenAI 官方建議的 browser 使用模式。Server-side proxy 需後端轉發所有音訊，延遲高且複雜度倍增。

**替代方案考慮**：Server-side WebSocket proxy — 後端可完全控制 session，但延遲和複雜度不可接受。

---

### D3：Evaluation Provider 用 ABC 抽象

**決定**：實作 `EvaluationProvider` abstract base class，OpenAI / Claude / Gemini 各為獨立子類別。Provider 由 `interview_session.eval_provider` 決定，factory function 實例化。

**理由**：評分邏輯與語音邏輯解耦。新增 provider 只需新增子類別，不改動 router 或 service 主流程。固定輸出 JSON schema 由 Pydantic model 驗證，各 provider 負責將 LLM 輸出 parse 成該 schema。

---

### D4：SM-2 選題用 LEFT JOIN + ORDER BY 實作

**決定**：`GET /questions/next` 使用 LEFT JOIN sm2_states，以 `(sm2_state IS NULL, next_review_at <= NOW(), next_review_at ASC, last_score ASC)` 排序。

**理由**：單一 SQL query 處理新題和複習題的優先順序，無需 application-layer 排序邏輯。LEFT JOIN 確保無 sm2_state 的新題不被排除。

**Session 去重**：在 query 加入 `WHERE q.id NOT IN (SELECT question_id FROM attempts WHERE session_id = :session_id)` 子查詢。

---

### D5：靜態 Bearer token auth

**決定**：單一 `INTERVIEW_TOKEN` 環境變數，FastAPI dependency `verify_token` 驗證所有 endpoint。

**理由**：單人私用系統，JWT / OAuth 是過度設計。靜態 token 存 `.env`，不進 git，安全性足夠。

---

### D6：Docker Compose 三 container 架構

**決定**：`postgres`（5432）、`backend`（8000）、`frontend`（3000），無 Redis、無 worker container。

**理由**：最少移動部件，本機啟動快，debug 直觀。backend 和 frontend 共用同一 Docker network，frontend 透過 `http://backend:8000` 呼叫 API（或透過 Next.js API route proxy 避免 CORS）。

---

### D7：資料庫 migration 用 Alembic

**決定**：SQLAlchemy 2.x ORM + Alembic migration，初始 migration 建立 5 張表。

**理由**：schema 變更可追蹤，rollback 有保障。`docker-compose up` 後自動執行 `alembic upgrade head`。

## Risks / Trade-offs

**[風險] FastAPI BackgroundTasks 在 process 重啟時會遺失進行中的評分任務**
→ 緩解：評分時間短（3-10 秒），本機使用不會在評分期間重啟。attempt 狀態留在 DB，重啟後 `pending_evaluation` 的 attempt 可手動重跑。

**[風險] 前端 2 秒 polling 在 30 秒 timeout 內若評分未完成**
→ 緩解：attempt status 設為 `failed`，AI 語音告知使用者評分失敗，繼續下一題。

**[風險] OpenAI Realtime API ephemeral token 有時效限制**
→ 緩解：token 含 `expires_at`，前端應在 token 過期前完成 WebRTC 握手。單次面試 session 時間遠短於 token 有效期。

**[風險] SM-2 session 去重 subquery 在題庫極小時可能無題可出**
→ 緩解：`GET /questions/next` 返回 HTTP 404，AI 告知使用者本次 session 已問完所有題目。

**[Trade-off] DB polling 而非 SSE**
→ 每 2 秒一次 polling 對本機 DB 無壓力，但若未來需要 100ms 級即時通知，需換成 Redis pub-sub + SSE。

## Migration Plan

1. `docker-compose up --build` 啟動全部 container
2. backend container 啟動時自動執行 `alembic upgrade head` 建立 schema
3. Claude Code 從 Notion 讀取題目，INSERT 到 `questions` 表
4. 開啟 `http://localhost:3000` 開始使用

**Rollback**：本機開發環境，直接 `docker-compose down -v` 清除所有資料。

## Open Questions

- OpenAI Realtime API 的 tool calling 回傳格式是否需要特殊處理（function_call_output event）？需在實作 `realtimeClient.ts` 時確認。
- 評分 prompt 的設計（給各 LLM provider 的 system prompt）需要實際測試後調整，不在此 design 範疇。
- `mock` 模式的題目數量上限是否需要設定（例如最多 5 題）？目前設計為使用者手動結束，無硬性上限。
