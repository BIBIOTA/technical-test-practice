import unittest

from app.services.evaluation import OpenAIEvaluationProvider


class EvaluationPromptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = OpenAIEvaluationProvider()

    def test_prompt_requires_evidence_aligned_feedback(self) -> None:
        prompt = self.provider._build_prompt(
            question="解釋時間複雜度與 Big O，並舉例說明常見複雜度。",
            reference_answer="需說明 Big O、O(1)、O(log n)、O(n)、O(n log n)、O(n^2)、O(2^n)、O(n!)。",
            transcript=(
                "時間複雜度描述演算法執行時間，可以用 Big O 表示。"
                "我會舉例 O(1)、二分搜尋 O(log n)、迴圈 O(n)、排序 O(n log n)、"
                "巢狀迴圈 O(n^2)、費氏數列 O(2^n)、排列組合 O(n!)。"
            ),
        )

        self.assertIn("逐項比對", prompt)
        self.assertIn("已明確提到", prompt)
        self.assertIn("不得列入 missing_points", prompt)
        self.assertIn("不得泛稱缺少具體範例", prompt)

    def test_prompt_calibrates_complete_but_imprecise_answers_above_80(self) -> None:
        prompt = self.provider._build_prompt(
            question="解釋時間複雜度與 Big O。",
            reference_answer="完整回答需要定義、常見級別、例子與工程取捨。",
            transcript="回答涵蓋定義、Big O、常見級別與多個例子，但部分用語不精準。",
        )

        self.assertIn("80-88", prompt)
        self.assertIn("主要概念完整、例子充足", prompt)
        self.assertNotIn("大多數回答應落在 65-80 分", prompt)


if __name__ == "__main__":
    unittest.main()
