import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

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


class CreateClientSecretWithPinnedQuestionTest(unittest.IsolatedAsyncioTestCase):
    async def test_uses_question_keywords_when_pinned_question_id_provided(self):
        from app.routers.realtime import create_client_secret, ClientSecretRequest
        from app.models.interview_session import InterviewSession
        from app.models.question import Question

        session_uuid = uuid.uuid4()
        question_uuid = uuid.uuid4()
        fake_session = InterviewSession(id=session_uuid, mode="single")
        fake_question = Question(
            id=question_uuid,
            text="What is XSS?",
            category="security",
            difficulty="medium",
            reference_answer="Use innerHTML carefully.",
            tags=[],
            transcription_keywords=["innerHTML", "DOMPurify"],
        )

        session_scalar = MagicMock()
        session_scalar.scalar_one_or_none.return_value = fake_session
        question_scalar = MagicMock()
        question_scalar.scalar_one_or_none.return_value = fake_question

        db = MagicMock()
        db.execute = AsyncMock(side_effect=[session_scalar, question_scalar])
        db.add = MagicMock()
        db.commit = AsyncMock()

        fake_openai_response = MagicMock()
        fake_openai_response.expires_at = 1900000000
        fake_openai_response.session.id = "rt_session_abc"
        fake_openai_response.value = "secret_xyz"

        captured: dict = {}

        async def fake_create(*, session):
            captured["session"] = session
            return fake_openai_response

        with patch("app.routers.realtime.AsyncOpenAI") as mock_cls:
            mock_client = MagicMock()
            mock_client.realtime.client_secrets.create = fake_create
            mock_cls.return_value = mock_client

            body = ClientSecretRequest(
                session_id=session_uuid,
                pinned_question_id=question_uuid,
            )
            result = await create_client_secret(body=body, db=db, _=None)

        prompt = captured["session"]["audio"]["input"]["transcription"]["prompt"]
        self.assertIn("innerHTML", prompt)
        self.assertIn("DOMPurify", prompt)
        self.assertEqual(result["client_secret"], "secret_xyz")

    async def test_returns_404_when_pinned_question_id_not_found(self):
        from app.routers.realtime import create_client_secret, ClientSecretRequest
        from app.models.interview_session import InterviewSession
        from fastapi import HTTPException

        session_uuid = uuid.uuid4()
        fake_session = InterviewSession(id=session_uuid, mode="single")
        session_scalar = MagicMock()
        session_scalar.scalar_one_or_none.return_value = fake_session
        question_scalar = MagicMock()
        question_scalar.scalar_one_or_none.return_value = None

        db = MagicMock()
        db.execute = AsyncMock(side_effect=[session_scalar, question_scalar])

        body = ClientSecretRequest(
            session_id=session_uuid,
            pinned_question_id=uuid.uuid4(),
        )
        with self.assertRaises(HTTPException) as ctx:
            await create_client_secret(body=body, db=db, _=None)
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
