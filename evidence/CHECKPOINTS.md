# CHECKPOINTS

> Append-only. Add an entry only when something is VERIFIED (tests pass, output checked).
>
> Entry format:
>
> ## CP-N · YYYY-MM-DD · role
> - What is verified:
> - How it was verified:
> - Commit: <short hash from git_commit>

## CP-1: Milestone 3 complete (2026-10-16)
- Milestone: 3
- Verified by: smoke test through the tunnel and a real client connection
- Latest commit at time of checkpoint: b79e207

## CP-2 · 2026-10-16 · Planner
- What is verified: handoff files (PROJECT_STATE, PLAN_LOG, DECISIONS) contain the earthworks spec, 4 test cases and decisions D-1..D-4, and are committed. Test numbers hand-calculated by the Planner. NOT verified: no code exists and no tests have been run.
- How it was verified: file contents written and read back through the file server; commit confirmed by git_commit.
- Commit: 524cb38

## CP-3 · 2026-10-16 · Builder
- What is verified: earthworks.py and test_earthworks.py exist and are committed. Implemented, NOT YET TEST-RUN. Builder cannot execute code, so no test has been run and nothing here is verified by execution.
- How it was verified: files read back through the file server and each test case traced by hand (300/40; 300/100; 40/30; zero areas; error cases). Hand tracing is not a test run.
- Commit: bc98866

## CP-4 · 2026-10-16 · Builder
- What is verified: fixes applied, awaiting human test run. Reviewer findings 1, 2, 3 and 7 are fixed in earthworks.py, test_earthworks.py and DECISIONS.md (D-5 updated, D-6 added). NOT verified: no test has been run; Builder cannot execute code.
- How it was verified: edited files read back through the file server and the new cases traced by hand (bool, None, non-iterable row, 10**400 area and station each end in ValueError). Hand tracing is not a test run.
- Commit: 8a42591

## CP-5 · 2026-10-16 · Builder (recording a human test run)
- What is verified: earthworks.py and test_earthworks.py pass all 10 unit tests (CutToFillTransition 2, InvalidInput 2, ThreeSectionsUneven 3, TwoSections 2, ZeroAreas 1). Verified by execution, by a human.
- How it was verified: a human ran `python -m unittest test_earthworks -v` in the workspace folder; result "Ran 10 tests in 0.003s, OK". The Builder did not run it and is relaying the human's report. git_status confirmed the code files had not changed since the tested commit.
- Commit: 8a42591
