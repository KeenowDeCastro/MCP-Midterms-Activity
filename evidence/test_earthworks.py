"""Tests for earthworks.py (unittest only).  Expected numbers are hand-calculated."""

import unittest

from earthworks import interval_volumes, total_volumes


class TwoSections(unittest.TestCase):
    # Case 1: (0, 10, 0) and (20, 20, 4), 20 m apart.
    # Cut = (10 + 20) / 2 * 20 = 300.  Fill = (0 + 4) / 2 * 20 = 40.
    SECTIONS = [(0, 10, 0), (20, 20, 4)]

    def test_interval_volumes(self):
        self.assertEqual(interval_volumes(self.SECTIONS), [(0, 20, 300, 40)])

    def test_total_volumes(self):
        self.assertEqual(total_volumes(self.SECTIONS), (300, 40))


class ThreeSectionsUnevenSpacing(unittest.TestCase):
    # Case 2: (0, 5, 2), (10, 15, 6), (30, 5, 0).
    # Interval 1: cut (5 + 15) / 2 * 10 = 100, fill (2 + 6) / 2 * 10 = 40.
    # Interval 2: cut (15 + 5) / 2 * 20 = 200, fill (6 + 0) / 2 * 20 = 60.
    SECTIONS = [(0, 5, 2), (10, 15, 6), (30, 5, 0)]

    def test_interval_volumes(self):
        self.assertEqual(
            interval_volumes(self.SECTIONS),
            [(0, 10, 100, 40), (10, 30, 200, 60)],
        )

    def test_total_volumes(self):
        self.assertEqual(total_volumes(self.SECTIONS), (300, 100))

    def test_total_matches_sum_of_intervals(self):
        intervals = interval_volumes(self.SECTIONS)
        self.assertEqual(
            total_volumes(self.SECTIONS),
            (sum(i[2] for i in intervals), sum(i[3] for i in intervals)),
        )


class CutToFillTransition(unittest.TestCase):
    # Case 3: (100, 8, 0) then (110, 0, 6).
    # Cut = (8 + 0) / 2 * 10 = 40.  Fill = (0 + 6) / 2 * 10 = 30.
    # Average end area ignores the true transition shape; this is expected.
    SECTIONS = [(100, 8, 0), (110, 0, 6)]

    def test_interval_volumes(self):
        self.assertEqual(interval_volumes(self.SECTIONS), [(100, 110, 40, 30)])

    def test_total_volumes(self):
        self.assertEqual(total_volumes(self.SECTIONS), (40, 30))


class ZeroAreas(unittest.TestCase):
    # Optional case: zero areas are valid and give zero volumes.
    def test_all_zero_areas(self):
        sections = [(0, 0, 0), (10, 0, 0), (25, 0, 0)]
        self.assertEqual(total_volumes(sections), (0, 0))


class InvalidInput(unittest.TestCase):
    # Case 4: every one of these must raise ValueError, from both functions.
    BAD_INPUTS = {
        "empty list": [],
        "single section": [(0, 1, 1)],
        "equal stations": [(0, 1, 1), (0, 1, 1)],
        "decreasing stations": [(10, 1, 1), (0, 1, 1)],
        "negative cut": [(0, -1, 0), (10, 1, 0)],
        "negative fill": [(0, 0, -1), (10, 0, 1)],
        "section with 2 numbers": [(0, 1), (10, 1, 1)],
        "section with 4 numbers": [(0, 1, 1, 1), (10, 1, 1)],
        "non-numeric value": [(0, "a", 1), (10, 1, 1)],
        "NaN value": [(0, float("nan"), 1), (10, 1, 1)],
        "infinite value": [(0, 1, 1), (10, float("inf"), 1)],
        "bool value": [(0, True, 1), (10, 1, 1)],
        "sections is None": None,
        "row not iterable": [5, (10, 1, 1)],
        "huge int area": [(0, 10**400, 1), (10, 1, 1)],
        "huge int station": [(0, 1, 1), (10**400, 1, 1)],
    }

    def test_interval_volumes_raises(self):
        for name, sections in self.BAD_INPUTS.items():
            with self.subTest(name):
                with self.assertRaises(ValueError):
                    interval_volumes(sections)

    def test_total_volumes_raises(self):
        for name, sections in self.BAD_INPUTS.items():
            with self.subTest(name):
                with self.assertRaises(ValueError):
                    total_volumes(sections)


if __name__ == "__main__":
    unittest.main()
