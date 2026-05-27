import unittest
from unittest.mock import AsyncMock, MagicMock, patch


class NormalizeTranscriptTest(unittest.IsolatedAsyncioTestCase):
    async def test_returns_empty_string_unchanged(self):
        from app.services.transcript import normalize_transcript
        self.assertEqual(await normalize_transcript(""), "")

    async def test_returns_whitespace_only_unchanged(self):
        from app.services.transcript import normalize_transcript
        self.assertEqual(await normalize_transcript("   "), "   ")

    async def test_skips_api_call_in_offline_mode(self):
        from app.services.transcript import normalize_transcript
        with patch("app.services.transcript.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = True
            mock_settings.openai_api_key = "key"
            with patch("app.services.transcript.AsyncOpenAI") as mock_cls:
                result = await normalize_transcript("偶一 常數時間")
                mock_cls.assert_not_called()
                self.assertEqual(result, "偶一 常數時間")

    async def test_returns_cleaned_text_from_api(self):
        from app.services.transcript import normalize_transcript
        mock_response = MagicMock()
        mock_response.choices[0].message.content = "O(1) 常數時間"
        with patch("app.services.transcript.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcript.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client
                result = await normalize_transcript("偶一 常數時間")
                mock_cls.assert_called_once_with(api_key="test-key")
                self.assertEqual(result, "O(1) 常數時間")

    async def test_falls_back_to_raw_when_api_returns_no_choices(self):
        from app.services.transcript import normalize_transcript
        mock_response = MagicMock()
        mock_response.choices = []
        with patch("app.services.transcript.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcript.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client
                result = await normalize_transcript("偶一 常數時間")
                self.assertEqual(result, "偶一 常數時間")

    async def test_falls_back_to_raw_on_api_error(self):
        from app.services.transcript import normalize_transcript
        with patch("app.services.transcript.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcript.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(side_effect=Exception("network error"))
                mock_cls.return_value = mock_client
                result = await normalize_transcript("偶一 常數時間")
                self.assertEqual(result, "偶一 常數時間")

    async def test_falls_back_to_raw_when_api_returns_empty(self):
        from app.services.transcript import normalize_transcript
        mock_response = MagicMock()
        mock_response.choices[0].message.content = ""
        with patch("app.services.transcript.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcript.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client
                result = await normalize_transcript("偶一 常數時間")
                self.assertEqual(result, "偶一 常數時間")


if __name__ == "__main__":
    unittest.main()
