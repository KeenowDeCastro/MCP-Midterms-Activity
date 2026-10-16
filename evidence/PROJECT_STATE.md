# PROJECT_STATE

> The single source of truth. Overwrite sections in place (str_replace / write_file with if_version). Keep it under one screen.

## Goal
Build earthworks.py (cut/fill volumes from cross-section areas by the average end area method) plus a unittest file test_earthworks.py. Plain Python 3, standard library only.

## Status
- Phase: Complete. Tests verified by a human run: 10 tests, OK (CP-5, commit 8a42591)
- Last updated by: Builder · 2026-10-16 (session 6)
- A human ran `python -m unittest test_earthworks -v`: "Ran 10 tests in 0.003s, OK". The Builder did not run it and only recorded the human's result.

## Spec (earthworks.py)
Input: `sections`, a sequence of `(station_m, cut_area_m2, fill_area_m2)` tuples, one per cross-section, stations as chainage in metres.
Method: for each pair of consecutive sections, volume = (A1 + A2) / 2 * (s2 - s1), computed separately for cut and fill. Volumes in m3.

- `interval_volumes(sections) -> list[tuple[float, float, float, float]]`
  One tuple per interval: `(start_station, end_station, cut_volume, fill_volume)`. Length = len(sections) - 1.
- `total_volumes(sections) -> tuple[float, float]`
  `(total_cut, total_fill)`: sums of interval_volumes. Must reuse interval_volumes (no duplicated maths).

Errors (all raise `ValueError` with a clear message, checked before any calculation):
- empty input
- fewer than 2 sections (one section has no interval)
- stations not strictly increasing (equal or decreasing)
- negative cut or fill area
- a section that is not 3 numbers, or a NaN/infinite value
Zero areas are valid. No rounding inside the module.

## Test cases (hand-checkable; Builder implements in test_earthworks.py)
1. Two sections 20 m apart: (0, 10, 0), (20, 20, 4). Cut = (10+20)/2*20 = 300. Fill = (0+4)/2*20 = 40. interval_volumes = [(0, 20, 300, 40)]; total = (300, 40).
2. Three sections, uneven spacing: (0, 5, 2), (10, 15, 6), (30, 5, 0).
   Interval 1: cut (5+15)/2*10 = 100, fill (2+6)/2*10 = 40.
   Interval 2: cut (15+5)/2*20 = 200, fill (6+0)/2*20 = 60.
   Total = (300, 100).
3. Cut-to-fill transition: (100, 8, 0), (110, 0, 6). Cut = 4*10 = 40. Fill = 3*10 = 30. Total = (40, 30). (Average end area ignores the true transition shape; this is expected.)
4. Errors, each raises ValueError: empty list; single section; equal stations [(0,1,1),(0,1,1)]; decreasing stations [(10,1,1),(0,1,1)]; negative cut [(0,-1,0),(10,1,0)]; negative fill [(0,0,-1),(10,0,1)].
   Optional: all-zero areas give (0, 0).

## Task list
- [x] Builder: write earthworks.py to the spec (done, tests pass)
- [x] Builder: write test_earthworks.py with the cases above (unittest) (done, tests pass)
- [x] Human: run `python -m unittest test_earthworks -v` and confirm all pass (done: 10 tests, OK; see CP-5)
- [x] Builder: append PLAN_LOG entry; deviation/extra decisions recorded as D-5 in DECISIONS.md
- [x] Builder/human: git_commit done for the implementation (commit bc98866); review-fix commit recorded in CHECKPOINTS CP-4. A "tests pass" CHECKPOINTS entry is still owed after the human run
- [ ] Reviewer/user: re-check test 1 and 2 by hand against the code

## Next step
None. Project complete. Optional Reviewer findings 4, 5 and 6 were deliberately not done (see PLAN_LOG session 5) and can be picked up later if wanted.

## Blockers / open questions
- none

## Key files
- PROJECT_STATE.md: this file
- PLAN_LOG.md: append-only session log
- CHECKPOINTS.md: verified milestones with commit hashes
- DECISIONS.md: design decisions and why
- earthworks.py, test_earthworks.py: implemented by Builder, verified by a human test run (CP-5)
