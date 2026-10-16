# DECISIONS

> One entry per design decision, so later sessions do not reopen settled questions.
>
> Entry format:
>
> ## D-N · Short title · YYYY-MM-DD · role
> - Context: what problem needed a choice
> - Decision: what was chosen
> - Why: the reason, and the alternative that was rejected

## D-1 · Input as (station, cut_area, fill_area) tuples · 2026-10-16 · Planner
- Context: needed one input shape for stations plus two areas per station.
- Decision: a single sequence of 3-tuples, one per section.
- Why: keeps each station with its areas so lengths cannot mismatch. Rejected: three parallel lists (length mismatch becomes another error case).

## D-2 · Two public functions, total built on interval volumes · 2026-10-16 · Planner
- Context: user needs volumes, and hand-checking is easier per interval.
- Decision: `interval_volumes` returns per-interval (start, end, cut, fill); `total_volumes` sums them.
- Why: one place for the maths, and per-interval output is what a person checks by hand. Rejected: a single function returning only totals.

## D-3 · Invalid input raises ValueError, never silently fixed · 2026-10-16 · Planner
- Context: empty input, non-increasing stations, negative areas.
- Decision: all raise ValueError with a clear message; stations must be strictly increasing; one section is also an error; zero areas are allowed.
- Why: silent sorting, clamping or returning 0 would hide bad survey data. Rejected: auto-sorting stations and returning zero for empty input.

## D-4 · Cut and fill kept separate, no netting, no rounding · 2026-10-16 · Planner
- Context: a cut area and fill area can exist at the same station.
- Decision: compute each independently with the plain average end area formula; no prismoidal correction, no shrink/swell factors, no rounding.
- Why: matches the stated method and keeps hand checks exact. Known limitation: accuracy drops where a section changes sharply between cut and fill (test case 3).

## D-5 · Validation details the spec left open · 2026-10-16 · Builder
- Context: the spec says "not 3 numbers, or NaN/infinite" but not how to treat bool, strings, or non-iterable input.
- Decision: a value counts as a number only if it is a finite `numbers.Real` and not a bool; a non-iterable `sections`, a non-iterable row, or a row whose length is not 3 raises ValueError. Checks run in this order: empty, single section, row shape and number type, negative areas, station order. Extra error cases for these were added to test_earthworks.py. Because the test is `numbers.Real`, `decimal.Decimal` is rejected (it is not registered as Real, so it raises ValueError) and `fractions.Fraction` is accepted.
- Why: True/False passing as 1/0 would hide bad data (same reasoning as D-3). Not a change to the spec's maths or API. Not yet run, so unverified. (Session 5: the bool, None and non-iterable-row tests promised here were missing and have now been added; still unrun.)

## D-6 · Huge ints raise ValueError, not OverflowError · 2026-10-16 · Builder
- Context: `math.isfinite(10**400)` raises OverflowError because the int cannot become a float. The spec says a bad number raises ValueError. Found by the Reviewer (session 4, finding 2).
- Decision: `_is_number` catches OverflowError and treats the value as not a valid number, so the caller gets ValueError with the usual message. Tests added for a huge int area and a huge int station.
- Why: one error type for all bad input (D-3). Rejected: letting OverflowError escape. Behaviour change for inputs that previously raised OverflowError; valid inputs are unaffected. Not yet run, so unverified.
