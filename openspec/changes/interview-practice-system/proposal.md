## Why

個人需要一個語音化的技術面試練習工具，能從 Notion 題庫出題、透過 AI 語音面試官互動，並根據歷史答題表現自動調整複習順序。現有工具不支援語音互動與間隔複習的整合。

## What Changes

- 新增 PostgreSQL 題庫（由 Claude Code 從 Notion 手動匯入）
- 新增 OpenAI Realtime API WebRTC 語音面試流程（AI 問題、使用者語音回答、barge-in）
- 新增多 LLM 評分層（OpenAI / Claude / Gemini），與語音層解耦
- 新增 SM-2 間隔複習算法驅動的選題機制
- 新增三種面試模式：單題練習、模擬面試、弱點複習
- 新增 FastAPI 後端，提供 ephemeral token、選題、評分輪詢等 API
- 新增 Next.js 前端，含 WebRTC 連線管理、即時 transcript 顯示、評分結果呈現

## Capabilities

### New Capabilities
- `question-bank`: 題庫 CRUD，支援 category / difficulty / tags 分類，notion_id 防重複匯入
- `voice-interview`: WebRTC + OpenAI Realtime 語音面試流程，含 ephemeral token 產生、AI tool calling、transcript 同步
- `evaluation`: 多 LLM 評分抽象層（EvaluationProvider ABC），非同步執行，固定 JSON schema 輸出，結果存 DB
- `spaced-repetition`: SM-2 算法狀態管理與選題排序，新題優先、到期題次之、低分題再次之
- `interview-session`: Session 生命週期管理（active / completed / aborted），支援 single / mock / weak_review 模式，mock 模式產生整體報告

### Modified Capabilities
<!-- 無既有 specs，全為新建 -->

## Impact

- **Database**: 新增 5 張表（questions、interview_sessions、attempts、sm2_states、realtime_sessions）
- **Backend API**: 8 個端點，Bearer token 靜態 auth
- **External dependencies**: OpenAI Realtime API（語音）、OpenAI / Anthropic / Google AI SDK（評分）、Notion API（題庫來源，僅 Claude Code 使用）
- **Infrastructure**: Docker Compose（postgres + backend + frontend），無 Redis、無 Celery
- **Frontend**: WebRTC 連線需要麥克風權限，須在 HTTPS 或 localhost 環境執行
