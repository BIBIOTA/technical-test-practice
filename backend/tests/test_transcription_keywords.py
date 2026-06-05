import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch


class ExtractTranscriptionKeywordsTest(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        from app.services.transcription_keywords import extract_transcription_keywords

        cls.extract_transcription_keywords = staticmethod(extract_transcription_keywords)

    async def test_offline_mode_returns_empty_list_without_instantiating_openai(self):
        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = True
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                result = await self.extract_transcription_keywords(
                    question_text="如何避免 XSS？",
                    reference_answer="使用 innerHTML 前要先透過 DOMPurify 清理內容。",
                    key_points=[{"point": "說明 innerHTML 的風險"}],
                    common_mistakes=["忽略 Content Security Policy"],
                )

                mock_cls.assert_not_called()
                self.assertEqual(result, [])

    async def test_returns_sanitized_keywords_from_api(self):
        mock_response = MagicMock()
        mock_response.choices[0].message.content = json.dumps(
            {"keywords": ["innerHTML", "DOMPurify", "Content Security Policy"]}
        )

        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client

                result = await self.extract_transcription_keywords(
                    question_text="如何避免 XSS？",
                    reference_answer="使用 innerHTML 前要先透過 DOMPurify 清理內容，並搭配 Content Security Policy。",
                    key_points=[{"point": "說明 innerHTML 的風險"}],
                    common_mistakes=["忽略 Content Security Policy"],
                )

                mock_cls.assert_called_once_with(api_key="test-key")
                call_kwargs = mock_client.chat.completions.create.call_args.kwargs
                self.assertEqual(call_kwargs["model"], "gpt-4o-mini")
                self.assertEqual(call_kwargs["temperature"], 0)
                self.assertEqual(call_kwargs["max_tokens"], 512)
                self.assertEqual(
                    call_kwargs["response_format"]["json_schema"]["name"],
                    "transcription_keywords",
                )
                keywords_schema = (
                    call_kwargs["response_format"]["json_schema"]["schema"]["properties"]["keywords"]
                )
                self.assertEqual(keywords_schema["maxItems"], 15)
                user_content = call_kwargs["messages"][1]["content"]
                self.assertIn("如何避免 XSS？", user_content)
                self.assertIn("使用 innerHTML 前要先透過 DOMPurify 清理內容", user_content)
                self.assertIn("說明 innerHTML 的風險", user_content)
                self.assertIn("忽略 Content Security Policy", user_content)
                self.assertEqual(result, ["innerHTML", "DOMPurify", "Content Security Policy"])

    async def test_filters_chinese_long_duplicate_blank_and_non_string_keywords(self):
        mock_response = MagicMock()
        mock_response.choices[0].message.content = json.dumps(
            {
                "keywords": [
                    "innerHTML",
                    "中文術語",
                    "x" * 41,
                    "innerHTML",
                    "   ",
                    123,
                    " DOMPurify ",
                    "Content Security Policy",
                ]
            }
        )

        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client

                result = await self.extract_transcription_keywords(
                    question_text="如何避免 XSS？",
                    reference_answer="使用 innerHTML 前要先透過 DOMPurify 清理內容。",
                    key_points=[],
                    common_mistakes=[],
                )

                self.assertEqual(result, ["innerHTML", "DOMPurify", "Content Security Policy"])

    async def test_filters_implausible_keyword_shapes(self):
        mock_response = MagicMock()
        mock_response.choices[0].message.content = json.dumps(
            {
                "keywords": [
                    "innerHTML",
                    "DOMPurify",
                    "Content Security Policy",
                    "CSRF token",
                    "dangerouslySetInnerHTML",
                    "O(log n)",
                    "😀",
                    "line\nbreak",
                    "!!!",
                    "this has four words",
                ]
            }
        )

        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client

                result = await self.extract_transcription_keywords(
                    question_text="如何避免 XSS？",
                    reference_answer="使用 innerHTML 前要先透過 DOMPurify 清理內容。",
                    key_points=[],
                    common_mistakes=[],
                )

                self.assertEqual(
                    result,
                    [
                        "innerHTML",
                        "DOMPurify",
                        "Content Security Policy",
                        "CSRF token",
                        "dangerouslySetInnerHTML",
                        "O(log n)",
                    ],
                )

    async def test_limits_sanitized_keywords_to_first_15(self):
        mock_response = MagicMock()
        mock_response.choices[0].message.content = json.dumps(
            {"keywords": [f"Term{i}" for i in range(1, 21)]}
        )

        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client

                result = await self.extract_transcription_keywords(
                    question_text="請說明快取策略。",
                    reference_answer="可提到 LRU cache 與 TTL。",
                    key_points=[],
                    common_mistakes=[],
                )

                self.assertEqual(result, [f"Term{i}" for i in range(1, 16)])

    async def test_api_exception_returns_empty_list(self):
        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(side_effect=Exception("network error"))
                mock_cls.return_value = mock_client
                with patch("app.services.transcription_keywords.logger.warning") as mock_warning:
                    result = await self.extract_transcription_keywords(
                        question_text="如何避免 XSS？",
                        reference_answer="使用 innerHTML 前要先透過 DOMPurify 清理內容。",
                        key_points=[],
                        common_mistakes=[],
                    )

                    mock_warning.assert_called_once()
                    self.assertEqual(result, [])

    async def test_malformed_json_returns_empty_list(self):
        mock_response = MagicMock()
        mock_response.choices[0].message.content = "not-json"

        with patch("app.services.transcription_keywords.settings") as mock_settings:
            mock_settings.evaluation_offline_mode = False
            mock_settings.openai_api_key = "test-key"
            with patch("app.services.transcription_keywords.AsyncOpenAI") as mock_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
                mock_cls.return_value = mock_client
                with patch("app.services.transcription_keywords.logger.warning") as mock_warning:
                    result = await self.extract_transcription_keywords(
                        question_text="如何避免 XSS？",
                        reference_answer="使用 innerHTML 前要先透過 DOMPurify 清理內容。",
                        key_points=[],
                        common_mistakes=[],
                    )

                    mock_warning.assert_called_once()
                    self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
