## Why

使用者在「單題練習」流程中需要能在選題前後查看題目的完整資料（題幹、參考答案、評分要點、常見錯誤）以利複習。資料庫已存有 `reference_answer`、`key_points`、`common_mistakes` 等欄位，但前端沒有任何介面瀏覽。本變更新增一個唯讀詳情頁，讓使用者可以複習，並能從詳情頁直接開始練習這題。

## What Changes

- **question-bank**: 新增 `GET /questions/{question_id}` 端點回傳完整題目欄位（含 `reference_answer`、`key_points`、`common_mistakes`、`tags`）；新增前端詳情頁 `/questions/[id]` 展示四個區塊；在 `/questions/select` 每張題卡上新增「查看內容」次要按鈕作為入口；詳情頁底部提供「返回選題」與「開始練習這題」兩個動作，後者沿用既有 single mode 流程。

## Impact

- Affected specs: `specs/question-bank/`
- Affected code:
  - `backend/app/routers/questions.py`（新端點）
  - `backend/app/services/sm2.py`（新 service function）
  - `frontend/lib/api.ts`（新 type + fetch function）
  - `frontend/app/questions/[id]/page.tsx`（新檔）
  - `frontend/app/questions/select/page.tsx`（題卡加按鈕）
  - `e2e/api/`、`e2e/playwright/`（新增測試）
- Breaking changes: No — 既有 `GET /questions` 列表端點 shape 不變更，SM2 / attempt 邏輯不變。

## Related Artifacts

### Design
- [design.md](./design.md)
- [tasks.md](./tasks.md)
