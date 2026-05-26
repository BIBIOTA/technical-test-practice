import unittest

from app.routers.realtime import _build_realtime_session_config


class RealtimeSessionConfigTest(unittest.TestCase):
    def test_input_audio_transcription_uses_current_realtime_schema(self) -> None:
        session = _build_realtime_session_config("single")

        self.assertNotIn("input_audio_transcription", session)
        self.assertEqual(
            session["audio"]["input"]["transcription"],
            {"model": "whisper-1", "language": "zh"},
        )


if __name__ == "__main__":
    unittest.main()
