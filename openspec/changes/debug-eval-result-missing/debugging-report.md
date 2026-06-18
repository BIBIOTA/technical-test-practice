# Debugging Report: debug-eval-result-missing

Date: 2026-06-18
Debugger: claude-opus-4-7 (system-debugging skill)
Note: 此為僅供除錯使用的 ad-hoc 報告，未對應任何進行中的 OpenSpec 變更。

## Symptom
- Reported behavior: 使用者 2026-06-17 在 single mode 練習時，按下「送出答案」後，右側「評分結果」分頁一直顯示「評分結果將在回答後顯示」，AI 也沒有以語音念出評分結果。
- Expected behavior: 送出答案後約 10–30 秒內，右側分頁切換至「評分結果」並顯示分數、summary、missing_points、next_focus、ideal_answer，AI 同時以語音播報摘要。
- Impact: 使用者完成回答後拿不到任何回饋；後端評分其實成功，但結果被孤立在 DB，UI 永遠看不到。

## Reproduction
- Status: reproduced from production logs (recorded 2026-06-17 session)
- Steps: 進入 single mode → 開始 session → 朗讀回答 → 按「送出答案」按鈕。
- Environment: 本機 docker compose（backend / frontend / postgres 容器自 2026-06-16 起持續運行 26h）。
- Test data / record IDs:
  - Session ID: `2a9d1b26-8863-48bd-8ab5-4b461d989e18`
  - Question ID: `4e912a7d-9940-4337-ab61-bba248dada30`
  - Attempt ID: `6b3d828a-6f9d-4b46-9aff-8b54d8ea6848`

## Observation Plan
| Layer | Observation method | Evidence captured |
|---|---|---|
| Browser/UI | 檢視 `frontend/app/interview/page.tsx` → `onEvalResult` callback 流程 | UI 顯示分數需 `RealtimeClient.callbacks.onEvalResult` 觸發；該 callback 僅在 `get_evaluation_summary` tool 取得 `completed` 結果時呼叫 |
| API/backend | `docker logs technical-test-practice-backend-1`；`backend/app/routers/attempts.py` | 後端只看到 `POST /attempts → 202 Accepted`，沒有任何 `GET /attempts/{id}/result` 或 `/summary` 的請求 |
| Database/persistence | `psql attempts ORDER BY created_at DESC LIMIT 5` | 該 attempt status=`completed`、score=`55`、completed_at 落在 created_at 之後 13s |
| Background/async | `attempts._run_evaluation` 內的 `logger.exception` | 沒有評分失敗日誌；後端評分成功落地 |
| Environment/build | 容器 `Up 26 hours`；最近一次代碼 commit 為 2026-06-05 (`2159713`) | 昨日無新部署，問題與環境一致性無關 |
| Realtime tool trace | `backend/logs/transcript-debug.jsonl` | 有 `submit/commit` → `mark_answer_completed` → `backend_response`，但**完全沒有 `get_evaluation_summary` 事件** |

## Evidence

### Backend access log（取自 docker logs）
```text
POST /sessions HTTP/1.1 201 Created
GET  /questions/next?...question_id=4e912a7d... HTTP/1.1 200 OK
POST /realtime/client-secret HTTP/1.1 200 OK
POST /debug/transcript-log HTTP/1.1 204 (x8)
POST /attempts HTTP/1.1 202 Accepted
POST /debug/transcript-log HTTP/1.1 204
# ... 沒有任何 GET /attempts/{id}/result 或 /summary ...
```

### Database state
```text
id      = 6b3d828a-6f9d-4b46-9aff-8b54d8ea6848
status  = completed
score   = 55
created_at   = 2026-06-17 02:55:57.212201+00
completed_at = 2026-06-17 02:56:10.564685+00   ← 13s 內已評分完成
```

### Realtime debug log（簡化版時間軸）
```text
02:54:56  session_start
02:55:41  transcription.completed (chunk 0)
02:55:53  transcription.completed (chunk 4) → "我不要講太多。"
02:55:53.600  submit/commit                 ← 使用者按下「送出答案」
02:55:54.769  mark_answer_completed         ← AI 1.1s 後呼叫 tool
02:55:57.273  backend_response (attempt_id 已回傳)
( 之後完全沒有任何事件 — 沒有 get_evaluation_summary )
```

## Data Flow Trace
- Symptom observed at: 前端右側分頁停留在「評分結果將在回答後顯示」（`evalResult` state 為 null）。
- First incorrect state found at: `RealtimeClient.handleToolCall` 中 `get_evaluation_summary` 分支從未被執行，因此 `pollAttemptResult` / `getAttemptSummary` 從未呼叫，`onEvalResult` callback 也從未觸發。
- Boundary where expected became actual: Realtime AI 完成 `mark_answer_completed` 後，依照系統提示應「告知正在評分」並「約 10 秒後呼叫 `get_evaluation_summary`」。但 `gpt-realtime-2025-08-28` 沒有真正的計時 / sleep 機制，使用者按按鈕送出後也沒有額外語音輸入觸發下一輪 response。AI 在說完一句話後就靜止，從未發出第二個 tool call。

## Working Reference
- Reference 1: e2e 測試 `e2e/playwright/tests/interview.spec.ts` 使用 mock 直接觸發 `get_evaluation_summary`（行 384、531），因此測試通過 — 真實 realtime model 不會自動排程這個 tool call，被 mock 掩蓋。
- Reference 2: 同一資料庫 2026-06-04 的成功 attempts（status=completed, score=80/72/70/65）都有對應的 `GET /attempts/{id}/result` 與 `/summary` 請求，但歷史日誌已被新一輪 docker logs 覆寫；行為差異存在於 realtime AI 是否在該次 session 順利接力。
- Meaningful differences: 系統提示要求 AI 完成 `mark_answer_completed` 後須「告知正在評分」並「約 10 秒後呼叫 `get_evaluation_summary`」。Realtime 模型缺乏可靠的計時/延遲機制，且我們對 `mark_answer_completed` tool output 的處理（`sendResponseCreate` 後就交給 AI）使整個輪詢路徑只能依賴 AI 自動跟進，沒有 deterministic fallback。

## Hypothesis
我認為根因是：**前端把「等待評分 → 取結果 → 顯示」這條關鍵路徑完全綁在 Realtime AI 主動呼叫 `get_evaluation_summary` 之上**；昨天的 session 中 AI 完成 `mark_answer_completed` 後沒有再發出第二個 tool call，於是 `pollAttemptResult`/`getAttemptSummary` 從未執行、`onEvalResult` callback 從未觸發、UI 永遠看不到結果。
證據：
1. DB 與後端日誌證實後端評分成功（score=55、13 秒內 completed），但完全沒有 attempt result/summary 端點被呼叫。
2. `transcript-debug.jsonl` 顯示 `mark_answer_completed` 是該 session 最後一個事件，沒有任何 `get_evaluation_summary` 痕跡。
3. 系統提示中「約 10 秒後呼叫 get_evaluation_summary」依賴 AI 自行計時，但 `gpt-realtime-2025-08-28` 不會在沒有後續使用者語音或事件刺激時主動排程未來的 tool call。

## Next Action
- Route to: `spec-driven-dev:writing-spec`（既有 spec 需要新增「無論 AI 是否呼叫 `get_evaluation_summary`，前端必須在 `mark_answer_completed` 完成後主動取得評分結果」的 requirement）。
- Minimal fix/test direction:
  1. 在 `RealtimeClient.handleToolCall` 的 `mark_answer_completed` 分支中，於 `createAttempt` 成功取得 `attempt_id` 後，啟動一個與 AI 無關的非同步 `pollAttemptResult(attempt.attempt_id)`；完成後直接呼叫 `getAttemptSummary` → `onEvalResult`。把 AI 對 `get_evaluation_summary` 的呼叫當成 best-effort 語音播報，而不是 UI 顯示分數的唯一管道。
  2. 對 `onEvalResult` 加上去重（已 set 過就忽略），避免 AI 跟進時與前端 fallback 同時觸發。
  3. 新增 e2e/integration 測試：模擬 Realtime AI 只呼叫 `mark_answer_completed`、之後不呼叫 `get_evaluation_summary` 的情境，仍能在 30s 內把分數顯示在 UI。
  4. （次要）放寬系統提示，移除「約 10 秒後呼叫」描述中對 sleep 的隱含假設，改為「收到 `mark_answer_completed` 工具輸出後，立刻呼叫 `get_evaluation_summary`；若回傳 pending 再重試」，降低 AI 採取錯誤策略的機率。
