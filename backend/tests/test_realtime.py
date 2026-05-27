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
