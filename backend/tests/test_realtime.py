import unittest

from app.routers.realtime import (
    _build_realtime_session_config,
    _build_system_prompt,
    _build_transcription_prompt,
    TRANSCRIPTION_BASE_PROMPT,
)


class BuildTranscriptionPromptTest(unittest.TestCase):
    def test_no_keywords_returns_base_prompt_only(self):
        result = _build_transcription_prompt([])
        self.assertEqual(result, TRANSCRIPTION_BASE_PROMPT)

    def test_with_keywords_appends_term_list(self):
        result = _build_transcription_prompt(["innerHTML", "DOMPurify"])
        self.assertTrue(result.startswith(TRANSCRIPTION_BASE_PROMPT))
        self.assertIn("innerHTML, DOMPurify", result)
        self.assertIn("本題可能會出現的英文術語", result)

    def test_base_prompt_does_not_include_static_term_list(self):
        # The legacy list of "connection pool, deadlock, Redis, Kafka..."
        # must be removed — all term hints are now per-question.
        self.assertNotIn("connection pool", TRANSCRIPTION_BASE_PROMPT)
        self.assertNotIn("Kafka", TRANSCRIPTION_BASE_PROMPT)
        self.assertNotIn("deadlock", TRANSCRIPTION_BASE_PROMPT)


class RealtimeSessionConfigTest(unittest.TestCase):
    def test_turn_detection_absent_from_client_secret_config(self):
        session = _build_realtime_session_config("single", [])
        self.assertNotIn("turn_detection", session)

    def test_transcription_uses_base_prompt_when_no_keywords(self):
        session = _build_realtime_session_config("single", [])
        transcription = session["audio"]["input"]["transcription"]
        self.assertEqual(transcription["model"], "gpt-4o-transcribe")
        self.assertEqual(transcription["language"], "zh")
        self.assertEqual(transcription["prompt"], TRANSCRIPTION_BASE_PROMPT)

    def test_transcription_appends_keywords_when_present(self):
        session = _build_realtime_session_config("single", ["innerHTML"])
        prompt = session["audio"]["input"]["transcription"]["prompt"]
        self.assertIn("innerHTML", prompt)

    def test_output_voice_uses_cedar(self):
        session = _build_realtime_session_config("single", [])
        self.assertEqual(session["audio"]["output"], {"voice": "cedar"})

    def test_system_prompt_does_not_request_male_presenting_voice(self):
        prompt = _build_system_prompt("single")
        self.assertNotIn("偏男性", prompt)
        self.assertNotIn("男性聲線", prompt)


if __name__ == "__main__":
    unittest.main()
