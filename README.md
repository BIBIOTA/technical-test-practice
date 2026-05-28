# Technical Test Practice

AI 技術面試練習系統。專案包含 FastAPI 後端、Next.js 前端、PostgreSQL 資料庫，以及 API/UI 端到端測試。使用者可以建立面試 session、抽題或選題、進行語音/文字回答，並取得 AI 評分與詳細反饋。

## 專案結構

```text
.
├── backend/                 # FastAPI API、SQLAlchemy models、Alembic migrations、服務邏輯
├── frontend/                # Next.js App Router 前端
├── e2e/
│   ├── api/                 # pytest API 端到端測試
│   └── playwright/          # Playwright UI 端到端測試
├── openspec/                # OpenSpec 變更與規格文件
├── docker-compose.yml       # 本機開發服務
├── docker-compose.test.yml  # 測試服務
└── Makefile                 # 測試環境與 e2e 指令
```

## 技術棧

- Backend: Python 3.12、FastAPI、SQLAlchemy、Alembic、Pydantic、OpenAI/Anthropic/Gemini SDK
- Frontend: Next.js、React、TypeScript、Tailwind CSS
- Database: PostgreSQL 16
- Tests: pytest、Playwright
- Runtime: Docker Compose

## 環境需求

- Docker / Docker Compose
- Python 3.12+
- Node.js 20+
- npm

## 環境變數

先從範例建立本機環境設定：

```bash
cp .env.example .env
```

主要設定：

```dotenv
INTERVIEW_TOKEN=your-secret-token-here
POSTGRES_USER=interview
POSTGRES_PASSWORD=your-db-password-here
DATABASE_URL=postgresql+asyncpg://interview:interview@postgres:5432/interview_practice
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
DEFAULT_EVAL_PROVIDER=openai
```

注意事項：

- `INTERVIEW_TOKEN` 是前後端呼叫受保護 API 的 Bearer token。
- 至少設定一個 AI provider key，才能使用對應供應商的實際評分或 realtime 能力。
- 不要提交 `.env`、`.env.test`、`frontend/.env.local` 或任何真實金鑰。

## 本機開發

用 Docker Compose 啟動完整服務：

```bash
docker-compose up -d --build
```

服務啟動後：

- Frontend: `http://localhost:3001`
- Backend: `http://localhost:8001`
- Health check: `http://localhost:8001/health`

停止服務：

```bash
docker-compose down
```

如果只要跑前端開發伺服器：

```bash
cd frontend
npm install
npm run dev
```

預設 Next.js dev server 會在 `http://localhost:3000`。

## 測試

啟動測試環境：

```bash
make test-env-up
```

執行全部 e2e 測試：

```bash
make test
```

只跑 API e2e：

```bash
make test-api
```

只跑 UI e2e：

```bash
make test-ui
```

停止測試環境並移除 volumes：

```bash
make test-env-down
```

`make test` 會啟動 `docker-compose.test.yml`，等待 backend health check 通過，再依序執行 API 與 Playwright 測試。

## 常用開發指令

Frontend lint：

```bash
cd frontend
npm run lint
```

Frontend build：

```bash
cd frontend
npm run build
```

Backend container 啟動時會自動執行：

```bash
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## API 概覽

後端主要 routes：

- `GET /health`
- `POST /sessions`
- `POST /sessions/{session_id}/complete`
- `GET /sessions/{session_id}/summary`
- `GET /questions`
- `GET /questions/next`
- `POST /attempts`
- `GET /attempts/{attempt_id}/result`
- `GET /attempts/{attempt_id}/summary`
- `POST /realtime/client-secret`

除 health check 外，受保護 API 需要帶上：

```http
Authorization: Bearer <INTERVIEW_TOKEN>
```

## 資料庫與 migrations

資料庫 schema 變更請透過 Alembic migration 加到 `backend/alembic/versions/`。Docker backend 啟動時會自動套用 migration。

## 開發注意事項

- 後端 route handler 放在 `backend/app/routers/`。
- 後端 business logic 放在 `backend/app/services/`。
- SQLAlchemy models 放在 `backend/app/models/`。
- 前端 app routes 放在 `frontend/app/`。
- UI 樣式優先沿用 `frontend/app/globals.css` 與既有 Tailwind 慣例。
- 窄範圍修改先跑最小相關測試；若改動影響共用流程，再擴大到 `make test`。
