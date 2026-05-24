## 1. 專案初始化

- [ ] 1.1 建立 docker-compose.yml（postgres、backend、frontend 三個 service）
- [ ] 1.2 建立 .env.example（INTERVIEW_TOKEN、DATABASE_URL、OPENAI_API_KEY、ANTHROPIC_API_KEY、GEMINI_API_KEY、DEFAULT_EVAL_PROVIDER）
- [ ] 1.3 建立 backend/Dockerfile（Python 3.12、uvicorn、alembic upgrade head 啟動指令）
- [ ] 1.4 建立 frontend/Dockerfile（Node 20、next build / next start）

## 2. Backend 基礎設定

- [ ] 2.1 初始化 pyproject.toml（fastapi、uvicorn、sqlalchemy 2.x、alembic、pydantic、asyncpg、openai、anthropic、google-generativeai）
- [ ] 2.2 建立 app/config.py（Pydantic Settings 讀取 .env）
- [ ] 2.3 建立 app/database.py（async SQLAlchemy engine + session factory）
- [ ] 2.4 建立 app/deps.py（verify_token dependency、get_db dependency）
- [ ] 2.5 建立 app/main.py（FastAPI app、router 掛載、CORS 設定）

## 3. 資料庫 Schema

- [ ] 3.1 建立 SQLAlchemy model：Question（含 notion_id UNIQUE NULLABLE、tags TEXT[]）
- [ ] 3.2 建立 SQLAlchemy model：InterviewSession
- [ ] 3.3 建立 SQLAlchemy model：Attempt（含 evaluation JSONB）
- [ ] 3.4 建立 SQLAlchemy model：SM2State
- [ ] 3.5 建立 SQLAlchemy model：RealtimeSession
- [ ] 3.6 執行 alembic init 並建立初始 migration（建立 5 張表）
- [ ] 3.7 驗證 docker-compose up 後 alembic upgrade head 自動執行成功

## 4. Evaluation Service

- [ ] 4.1 定義 EvaluationProvider ABC（evaluate 抽象方法、輸出 Pydantic schema）
- [ ] 4.2 定義 EvaluationResult Pydantic schema（score、summary、missing_points、next_focus、provider、model）
- [ ] 4.3 實作 OpenAIEvaluationProvider（chat completions + structured output）
- [ ] 4.4 實作 ClaudeEvaluationProvider（Anthropic SDK + JSON output）
- [ ] 4.5 實作 GeminiEvaluationProvider（Google AI SDK + JSON output）
- [ ] 4.6 實作 provider factory function（依 eval_provider 字串回傳對應 provider）
- [ ] 4.7 設計並測試各 provider 的評分 system prompt（含 reference_answer 注入）

## 5. SM-2 Service

- [ ] 5.1 實作 score_to_grade 函數（0-100 → 0-5）
- [ ] 5.2 實作 update_sm2 函數（完整 SM-2 算法，含 ease_factor floor 1.3）
- [ ] 5.3 實作 get_or_create_sm2_state（新題自動建立初始狀態）
- [ ] 5.4 實作 select_next_question SQL query（LEFT JOIN + 四層排序 + session 去重 subquery）

## 6. API Routers

- [ ] 6.1 實作 POST /sessions（建立 InterviewSession，回傳 session_id）
- [ ] 6.2 實作 POST /sessions/{id}/complete（冪等關閉 session）
- [ ] 6.3 實作 GET /sessions/{id}/summary（mock 模式整體報告，含 average_score）
- [ ] 6.4 實作 POST /realtime/client-secret（呼叫 OpenAI Realtime API 產生 ephemeral token）
- [ ] 6.5 實作 GET /questions/next（呼叫 select_next_question，回傳題目）
- [ ] 6.6 實作 POST /attempts（建立 Attempt、觸發 BackgroundTask 評分）
- [ ] 6.7 實作 BackgroundTask 評分流程（呼叫 EvaluationProvider、寫入 DB、呼叫 update_sm2）
- [ ] 6.8 實作 GET /attempts/{id}/result（輪詢端點，回傳 status + evaluation）
- [ ] 6.9 實作 GET /attempts/{id}/summary（供 AI tool call，回傳語音回饋用摘要）

## 7. Frontend 基礎設定

- [ ] 7.1 初始化 Next.js 專案（TypeScript、App Router、Tailwind CSS）
- [ ] 7.2 建立 src/lib/api.ts（所有 backend API 呼叫函數，含 Bearer token header）
- [ ] 7.3 建立環境變數設定（NEXT_PUBLIC_API_URL、INTERVIEW_TOKEN）

## 8. Realtime Client

- [ ] 8.1 建立 src/lib/realtimeClient.ts（WebRTC 連線建立、音訊 track 設定）
- [ ] 8.2 實作 ephemeral token 取得流程（呼叫 POST /realtime/client-secret）
- [ ] 8.3 實作 tool calling 事件處理（get_next_question、mark_answer_completed、get_evaluation_summary）
- [ ] 8.4 實作 function_call_output 回傳（將 backend API 結果注入 Realtime session）
- [ ] 8.5 實作 transcript 事件接收（response.audio_transcript.delta / done）
- [ ] 8.6 實作 polling 邏輯（每 2 秒輪詢 /attempts/{id}/result，30 秒 timeout）

## 9. Frontend UI

- [ ] 9.1 建立 src/app/page.tsx（模式選擇：single / mock / weak_review，eval_provider 選擇）
- [ ] 9.2 建立 src/app/interview/page.tsx（面試主畫面，整合 InterviewRoom）
- [ ] 9.3 建立 src/components/InterviewRoom.tsx（管理 WebRTC 生命週期、session 狀態）
- [ ] 9.4 建立 src/components/TranscriptPanel.tsx（即時顯示 AI 和使用者的 transcript）
- [ ] 9.5 建立 src/components/EvalResultCard.tsx（顯示 score、summary、missing_points、next_focus）
- [ ] 9.6 實作麥克風權限請求與錯誤提示

## 10. 整合測試

- [ ] 10.1 驗證 docker-compose up 後三個 container 正常啟動
- [ ] 10.2 驗證 Bearer token auth（有效 token 通過，無效 token 返回 401）
- [ ] 10.3 驗證完整單題練習流程（選題 → 語音問答 → 評分輪詢 → 語音回饋 → SM-2 更新）
- [ ] 10.4 驗證 SM-2 選題優先順序（新題 → 到期題 → 低分題）
- [ ] 10.5 驗證 session 去重（同一 session 不重複出題）
- [ ] 10.6 驗證 mock 模式 summary 報告正確產生
- [ ] 10.7 驗證三個 evaluation provider 皆可正常評分並回傳固定 schema
