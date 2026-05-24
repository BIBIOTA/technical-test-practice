## Figma Design Reference

**檔案**：[Interview Practice System — Figma](https://www.figma.com/design/TJMfUV9YBE3ungBwNhxE5j)

設計主題：深色系（Dark Theme），桌面版 1440×900。

### 色彩規格

| Token | Hex | 用途 |
|---|---|---|
| Background | `#0F1117` | 頁面底色 |
| Surface | `#1A1D26` | 卡片、面板底色 |
| Surface Elevated | `#23273A` | Header、右側面板底色 `#15172E` |
| Primary | `#6C63FF` | 主要強調色（按鈕、選取邊框、麥克風按鈕） |
| Primary Subtle | `#6C63FF` opacity 0.12~0.2 | 卡片選取背景、tag 背景 |
| Teal | `#4ECDC4` | Mock Interview 強調色 |
| Amber | `#F59E0B` | Weak Review 強調色、Medium 難度 badge |
| Green | `#10B981` | 已完成狀態、優勢 feedback、Speaking 指示燈 |
| Red Subtle | `#C83737` opacity 0.15 | 結束面試按鈕 |
| Text Primary | `#E2E8F0` | 主要文字 |
| Text Secondary | `#94A3B8` | 次要說明文字 |
| Border | `#2D3748` | 卡片邊框 |

### Page 1：Mode Selection（`src/app/page.tsx`）

**畫面名稱**：`Mode Selection Screen`（1440×900）

#### 結構

```
Header (64px)
  Logo Icon (32px circle, #6C63FF) + "Interview Practice" (Semi Bold 18)
  "Total Sessions: 42" badge (右側)

Main Content (padding: 60 120px)
  Hero Block (置中)
    Title: "選擇面試模式" (Bold 36, #E2E8F0)
    Subtitle (Regular 16, #94A3B8)

  Mode Cards Row (三欄等寬, gap 24)
    Card - Single      紫色 #6C63FF  選取時：2px 紫色邊框 + 0.08 opacity 背景
    Card - Mock        青色 #4ECDC4
    Card - Weak Review 琥珀色 #F59E0B

  Controls Row (space-between)
    Eval Provider Section
      Label "評分模型" (Medium 13, #94A3B8)
      Chips: OpenAI(選取) / Claude / Gemini
        選取 chip：1.5px 紫色邊框 + 0.2 opacity 背景，文字 #C4BEFF
        未選取 chip：1px #2D3748 邊框，背景 #23273A
    Info Block (題庫狀態)
      三格統計：總題數 / 已練習 / 待複習（Bold 20, #E2E8F0）
    Start Button
      背景 #6C63FF，borderRadius 12，padding 16 40
      文字 "開始面試" (Semi Bold 16, white)
```

#### 每個 Mode Card 內部結構

```
Icon Box (48×48 or HUG, borderRadius 12, tagColor opacity 0.15)
  Icon char (Bold 20, tagColor)
Title (Semi Bold 18, #E2E8F0, width FILL)
Description (Regular 13, #94A3B8, autoResize HEIGHT, lineHeight 150%)
Tag Badge (borderRadius 6, tagColor opacity 0.12)
  Label (Medium 12, tagColor)
```

---

### Page 2：Interview Room（`src/app/interview/page.tsx`）

兩個狀態畫面，均 1440×900：
- **`Interview Room Screen`**：面試進行中狀態
- **`Interview Room - Eval Result`**：評分完成狀態（評分結果 tab 啟用）

#### Header（60px，兩個狀態共用結構）

```
Left:
  Back Button ("← 返回"，#23273A 背景，borderRadius 8)
  Divider (1×24px，#2D3748)
  Mode Badge ("Single Mode"，#6C63FF opacity 0.15 背景，文字 #C4BEFF)
  Q Indicator ("Q1 / 5"，Regular 14，#94A3B8)
    ↳ 完成狀態改為 "Q1 / 5 · 完成"，文字色 #10B981

Center:
  Timer (Bold 22, #E2E8F0) — 進行中顯示 "04:32"，完成顯示 "08:14"
  Sub label (Regular 11, #94A3B8) — "面試進行中" / "面試已完成"

Right:
  Provider Badge ("Eval: OpenAI"，#23273A 背景)
  End Button ("結束面試"，#C83737 opacity 0.15 背景 + border)
    ↳ 完成狀態隱藏此按鈕
```

#### 左側面板（Left Panel，width FILL）

```
padding: 32px top/bottom, 40px left, 32px right
itemSpacing: 24

Question Card (#1A1D26, borderRadius 16)
  Question Header Row (space-between)
    Left: "當前問題" label + Difficulty Badge (Amber) + Category Badge (Teal)
    Right: SM-2 info text (Regular 11, #94A3B8 60%)
  Question Text (Semi Bold 17, lineHeight 150%)

[進行中] Voice Interface (#1A1D26, borderRadius 16, FILL height)
  Avatar Row:
    AI Avatar (80×80 circle, #6C63FF 0.2 bg + 2px stroke, "AI" Bold 28 #C4BEFF)
    Status Info:
      "AI 面試官" (Semi Bold 15)
      Speaking Indicator (8px green dot + "正在聆聽..." text #10B981)
  Sound Wave: 15 bars (6px wide, 3px radius, various heights 16-60px, #6C63FF)
  Mic Controls Row:
    Mute Button (#23273A, borderRadius 10)
    Mic Button (64×64 circle, #6C63FF, "M" Bold 22 white)
    Next Question Button (#23273A, "下一題 →")

[完成] Answer Summary (#1A1D26, borderRadius 12)
  Label: "您的回答摘要" (Medium 12, #94A3B8)
  Answer text (Regular 13, #C5D0DE, lineHeight 160%)
```

#### 右側面板（Right Panel，width 400px fixed）

```
背景 #15172E，左側 1px 邊框 #23273A
padding: 24，itemSpacing: 20

Tab Row (#1A1D26, borderRadius 10, padding 4)
  "對話紀錄" tab / "評分結果" tab
  Active tab: #23273A 背景，Semi Bold 13，#E2E8F0
  Inactive tab: 無背景，Regular 13，#94A3B8

[對話紀錄 tab - 進行中]
Transcript Section (FILL height)
  AI message: 28px purple circle + bubble (#23273A)
  User message: bubble (#6C63FF opacity 0.2，靠右)
  Typing indicator: 28px purple circle + 三點 bubble

[評分結果 tab - 完成]
Eval Result Card (#1A1D26, borderRadius 16)
  Score Row (space-between):
    Score: Bold 48 "#6C63FF" + "/100 分 · OpenAI" Regular 12
    SM-2 Info Block (#23273A, borderRadius 10):
      "SM-2 更新" label
      "下次複習: 7天後" (Semi Bold 13)
      "EF: 2.36 → 2.50" (#10B981)
  Divider (1px, #2D3748)
  Dimensions Section ("各維度評分"):
    每個維度: name text + score (Semi Bold, tagColor) + 兩層 bar (bg #23273A, fill tagColor)
    技術深度 #6C63FF / 架構設計 #4ECDC4 / 溝通表達 #F59E0B / 問題解決 #10B981

Feedback Card (#1A1D26, borderRadius 16)
  "AI 詳細反饋" label
  Strengths block (#10B981 opacity 0.06 bg): 綠點 + "優勢" + text
  Improvements block (#F59E0B opacity 0.06 bg): 琥珀點 + "待改善" + text

Next Question Button (#6C63FF 背景, FILL width, borderRadius 12)
  "下一題 →" (Semi Bold 15, white)
```

---

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
