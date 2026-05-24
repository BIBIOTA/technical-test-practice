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
- [ ] 7.4 設定 Tailwind 主題色彩 token（依 design.md「色彩規格」表，使用 CSS variables）

## 8. Realtime Client

- [ ] 8.1 建立 src/lib/realtimeClient.ts（WebRTC 連線建立、音訊 track 設定）
- [ ] 8.2 實作 ephemeral token 取得流程（呼叫 POST /realtime/client-secret）
- [ ] 8.3 實作 tool calling 事件處理（get_next_question、mark_answer_completed、get_evaluation_summary）
- [ ] 8.4 實作 function_call_output 回傳（將 backend API 結果注入 Realtime session）
- [ ] 8.5 實作 transcript 事件接收（response.audio_transcript.delta / done）
- [ ] 8.6 實作 polling 邏輯（每 2 秒輪詢 /attempts/{id}/result，30 秒 timeout）

## 9. Frontend UI

> **設計稿**：[Figma — Interview Practice System](https://www.figma.com/design/TJMfUV9YBE3ungBwNhxE5j)
> 詳細色彩規格、間距與元件結構請見 `design.md` 的「Figma Design Reference」段落。

- [ ] 9.1 建立 `src/app/page.tsx`（Mode Selection 頁）
  - Figma 參考：Page 1「Mode Selection Screen」
  - Header：Logo icon + App 名稱 + Session 總數
  - 三個 Mode Card（Single / Mock / Weak Review）水平排列，選取時顯示紫色邊框
  - 底部 Controls Row：Eval Provider chip 選擇器 + 題庫統計 + 開始面試按鈕
  - State：`selectedMode`、`evalProvider` 選取高亮

- [ ] 9.2 建立 `src/app/interview/page.tsx`（Interview Room 頁）
  - Figma 參考：Page 2「Interview Room Screen」（進行中狀態）與「Interview Room - Eval Result」（完成狀態）
  - 整合 InterviewRoom、TranscriptPanel、EvalResultCard
  - 管理頁面層級 state：session 物件、當前題目、activeTab（"transcript" | "eval"）

- [ ] 9.3 建立 `src/components/InterviewRoom.tsx`
  - Figma 參考：Page 2 左側面板（Left Panel）
  - Question Card：題目文字 + Difficulty Badge（Amber）+ Category Badge（Teal）+ SM-2 資訊
  - Voice Interface（進行中）：AI Avatar（80px circle）+ Sound Wave 動畫 bars + 靜音/麥克風/下一題按鈕
  - Answer Summary（完成）：顯示使用者回答摘要文字
  - Header：返回按鈕 + Mode badge + Q 計數 + 計時器 + Eval badge + 結束面試按鈕

- [ ] 9.4 建立 `src/components/TranscriptPanel.tsx`
  - Figma 參考：Page 2 右側面板，「對話紀錄」tab
  - AI 訊息：左側 28px 紫色圓形 + 深色氣泡（#23273A）
  - User 訊息：右對齊，紫色半透明氣泡（#6C63FF opacity 0.2）
  - Typing indicator：三點動畫 bubble
  - Tab row（與 EvalResultCard 共用）：對話紀錄 / 評分結果

- [ ] 9.5 建立 `src/components/EvalResultCard.tsx`
  - Figma 參考：Page 2 右側面板，「評分結果」tab
  - Score 大字（Bold 48, #6C63FF）+ 評分模型來源 + SM-2 更新 block
  - 四維度進度條（技術深度 / 架構設計 / 溝通表達 / 問題解決），各維度有對應色
  - AI 詳細反饋：優勢區塊（綠色）/ 待改善區塊（琥珀色）
  - 「下一題 →」按鈕（FILL 寬度，#6C63FF 背景）

- [ ] 9.6 實作麥克風權限請求與錯誤提示（覆蓋在 Voice Interface 上方的 modal/toast）

## 10. 整合測試

- [ ] 10.1 驗證 docker-compose up 後三個 container 正常啟動
- [ ] 10.2 驗證 Bearer token auth（有效 token 通過，無效 token 返回 401）
- [ ] 10.3 驗證完整單題練習流程（選題 → 語音問答 → 評分輪詢 → 語音回饋 → SM-2 更新）
- [ ] 10.4 驗證 SM-2 選題優先順序（新題 → 到期題 → 低分題）
- [ ] 10.5 驗證 session 去重（同一 session 不重複出題）
- [ ] 10.6 驗證 mock 模式 summary 報告正確產生
- [ ] 10.7 驗證三個 evaluation provider 皆可正常評分並回傳固定 schema
