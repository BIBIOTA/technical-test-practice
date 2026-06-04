import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.seed_questions import QUESTIONS


class TestSeedQuestions(unittest.TestCase):
    def test_security_questions_include_csrf_and_xss(self) -> None:
        question_texts = {q["text"] for q in QUESTIONS}

        self.assertIn("什麼是 CSRF 攻擊？請說明攻擊流程、影響與常見防護方式。", question_texts)
        self.assertIn("什麼是 XSS 攻擊？請說明攻擊類型、影響與常見防護方式。", question_texts)
        self.assertNotIn("什麼是 XDD 攻擊？如果這不是常見正式名詞，面試時應如何釐清？", question_texts)


if __name__ == "__main__":
    unittest.main()
