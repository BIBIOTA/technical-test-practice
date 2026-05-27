# Realtime Male Traditional Chinese Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the OpenAI Realtime interviewer to use the `cedar` voice with a calm, male-presenting Traditional Chinese interview style.

**Architecture:** The backend owns Realtime session creation, so the voice and voice-style instructions are configured in `backend/app/routers/realtime.py`. Unit coverage lives in `backend/tests/test_realtime.py` and verifies the generated session config without calling OpenAI.

**Tech Stack:** FastAPI, OpenAI Realtime API session config, Python `unittest`/pytest.

---

## File Structure

- Modify: `backend/tests/test_realtime.py`
  - Responsibility: verify `_build_realtime_session_config()` emits the expected Realtime session shape.
- Modify: `backend/app/routers/realtime.py`
  - Responsibility: build the Realtime session config and interviewer system prompt.

No frontend files, migrations, or environment files are needed.

### Task 1: Add Realtime Voice Regression Test

**Files:**
- Modify: `backend/tests/test_realtime.py`

- [ ] **Step 1: Add the failing voice test**

Open `backend/tests/test_realtime.py` and add this method inside `RealtimeSessionConfigTest`, after `test_input_audio_transcription_uses_current_realtime_schema`:

```python
    def test_output_voice_uses_cedar(self) -> None:
        session = _build_realtime_session_config("single")
        self.assertEqual(session["audio"]["output"], {"voice": "cedar"})
```

The full file should become:

```python
import unittest

from app.routers.realtime import _build_realtime_session_config


class RealtimeSessionConfigTest(unittest.TestCase):
    def test_turn_detection_absent_from_client_secret_config(self) -> None:
        # turn_detection is not accepted by client_secrets.create; VAD is
        # disabled via session.update on the data channel after connect.
        session = _build_realtime_session_config("single")
        self.assertNotIn("turn_detection", session)

    def test_input_audio_transcription_uses_current_realtime_schema(self) -> None:
        session = _build_realtime_session_config("single")
        self.assertNotIn("input_audio_transcription", session)
        self.assertEqual(
            session["audio"]["input"]["transcription"],
            {"model": "gpt-4o-transcribe", "language": "zh"},
        )

    def test_output_voice_uses_cedar(self) -> None:
        session = _build_realtime_session_config("single")
        self.assertEqual(session["audio"]["output"], {"voice": "cedar"})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the targeted backend test and confirm it fails**

Run:

```bash
cd backend && python -m pytest tests/test_realtime.py -v
```

Expected: `test_output_voice_uses_cedar` fails because the current config is `{"voice": "coral"}`.

### Task 2: Switch Realtime Voice And Prompt Style

**Files:**
- Modify: `backend/app/routers/realtime.py`
- Test: `backend/tests/test_realtime.py`

- [ ] **Step 1: Add the voice-style prompt rule**

In `backend/app/routers/realtime.py`, update `_build_system_prompt()` so the `規則：` section includes this new rule after the existing first rule:

```text
2. 語音風格需自然、沉穩、專業，呈現偏男性聲線的台灣繁體中文面試官口吻；語速適中，避免簡體中文與中國用語
```

Renumber the following rules so the section reads:

```text
規則：
1. 使用繁體中文進行全程對話
2. 語音風格需自然、沉穩、專業，呈現偏男性聲線的台灣繁體中文面試官口吻；語速適中，避免簡體中文與中國用語
3. 每次只問一個問題，等待應試者完整回答
4. 絕對不透露參考答案
5. 若應試者主動要求提示，僅提供方向性提示
6. 【重要】只有在對話中出現「（送出答案）」文字訊號後，才能呼叫 mark_answer_completed。在此訊號出現之前，不論偵測到任何音訊，均不得呼叫 mark_answer_completed，也不得播放任何語音或輸出任何文字回覆。「（送出答案）」是系統內部訊號，不要讀出或重複。
7. 呼叫 mark_answer_completed 時，transcript 填入緊接在「（送出答案）」訊號後的音訊內容（繁體中文），不可翻譯成英文
8. 評分完成後，呼叫 get_evaluation_summary 取得評分結果，並以語音向應試者說明
```

Do not change the `工作流程：` section.

- [ ] **Step 2: Change the Realtime output voice**

In `_build_realtime_session_config()`, replace:

```python
"output": {"voice": "coral"},
```

with:

```python
"output": {"voice": "cedar"},
```

- [ ] **Step 3: Run the targeted backend test and confirm it passes**

Run:

```bash
cd backend && python -m pytest tests/test_realtime.py -v
```

Expected: all tests in `tests/test_realtime.py` pass.

- [ ] **Step 4: Review the scoped diff**

Run:

```bash
git diff -- backend/app/routers/realtime.py backend/tests/test_realtime.py
```

Expected: the diff only adds the voice-style prompt rule, changes `coral` to `cedar`, and adds the `test_output_voice_uses_cedar` assertion.

- [ ] **Step 5: Commit the implementation**

Before committing, confirm unrelated dirty files remain unstaged:

```bash
git status --short
```

Stage and commit only the implementation files:

```bash
git add backend/app/routers/realtime.py backend/tests/test_realtime.py
git commit -m "feat(realtime): use cedar voice for zh-tw interviewer"
```

Expected: the commit includes only `backend/app/routers/realtime.py` and `backend/tests/test_realtime.py`.

## Manual Verification

If an OpenAI key and the local app stack are available, start an interview and listen to the first AI question.

Expected:

- The AI interviewer uses the `cedar` Realtime voice.
- The spoken style is calm, professional, and suitable for Traditional Chinese interview practice.
- The answer-submission and transcript flow behave as before.

Automated tests verify the backend config. Manual listening is still needed to judge whether the perceived voice fits the requested male-sounding style.

## Self-Review

- Spec coverage: `cedar` voice is covered by Task 1 and Task 2. Prompt guidance for Traditional Chinese male-presenting style is covered by Task 2. No frontend controls or environment-variable support are included.
- Placeholder scan: no placeholder steps remain.
- Type consistency: the plan uses the existing `_build_realtime_session_config(mode: str) -> dict` function and existing `session["audio"]["output"]` shape.
