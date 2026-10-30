import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
import report  # noqa: E402


class SummaryTest(unittest.TestCase):
    def test_totals_by_region(self):
        rows = [{"region": "east", "amount": 5}, {"region": "west", "amount": 2}, {"region": "east", "amount": 1}]
        self.assertEqual(report.summary(rows), {"east": 6, "west": 2})

    def test_empty(self):
        self.assertEqual(report.summary([]), {})


if __name__ == "__main__":
    unittest.main()
