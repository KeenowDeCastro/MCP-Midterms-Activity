"""Cut and fill volumes from cross-section areas (average end area method).

Each section is a tuple ``(station_m, cut_area_m2, fill_area_m2)``.  For two
consecutive sections the volume is ``(A1 + A2) / 2 * (s2 - s1)``, worked out
separately for cut and for fill.  Volumes are in cubic metres.

Standard library only.  No rounding is done anywhere in this module.
"""

import math
from numbers import Real

__all__ = ["interval_volumes", "total_volumes"]


def _is_number(value):
    """True for a finite real number (bool is not accepted).

    A huge int such as 10**400 cannot be converted to float, so math.isfinite
    raises OverflowError; that counts as "not a valid number" (-> ValueError).
    """
    if not isinstance(value, Real) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _validate(sections):
    """Check the input and return it as a list of (station, cut, fill) tuples.

    Raises ValueError with a clear message on any problem.  Nothing is
    calculated here.
    """
    try:
        rows = list(sections)
    except TypeError:
        raise ValueError(
            "sections must be a sequence of (station, cut_area, fill_area) tuples"
        ) from None

    if len(rows) == 0:
        raise ValueError("sections is empty: at least 2 sections are needed")
    if len(rows) < 2:
        raise ValueError(
            "only 1 section given: at least 2 sections are needed to form an interval"
        )

    checked = []
    for index, row in enumerate(rows):
        try:
            values = tuple(row)
        except TypeError:
            raise ValueError(
                f"section {index} must be (station, cut_area, fill_area), got {row!r}"
            ) from None
        if len(values) != 3:
            raise ValueError(
                f"section {index} must have exactly 3 values "
                f"(station, cut_area, fill_area), got {len(values)}"
            )
        for value in values:
            if not _is_number(value):
                raise ValueError(
                    f"section {index} has a value that is not a finite number: {value!r}"
                )
        checked.append(values)

    for index, (_station, cut_area, fill_area) in enumerate(checked):
        if cut_area < 0:
            raise ValueError(f"section {index} has a negative cut area: {cut_area}")
        if fill_area < 0:
            raise ValueError(f"section {index} has a negative fill area: {fill_area}")

    for index in range(1, len(checked)):
        previous_station = checked[index - 1][0]
        station = checked[index][0]
        if station <= previous_station:
            raise ValueError(
                "stations must be strictly increasing, but section "
                f"{index} has station {station} after station {previous_station}"
            )

    return checked


def interval_volumes(sections):
    """Return one ``(start_station, end_station, cut_volume, fill_volume)`` per interval.

    The result has ``len(sections) - 1`` tuples.  Raises ValueError for
    invalid input (see ``_validate``).
    """
    rows = _validate(sections)
    result = []
    for (s1, cut1, fill1), (s2, cut2, fill2) in zip(rows, rows[1:]):
        length = s2 - s1
        cut_volume = (cut1 + cut2) / 2 * length
        fill_volume = (fill1 + fill2) / 2 * length
        result.append((s1, s2, cut_volume, fill_volume))
    return result


def total_volumes(sections):
    """Return ``(total_cut, total_fill)``, the sums over ``interval_volumes``."""
    intervals = interval_volumes(sections)
    total_cut = sum(interval[2] for interval in intervals)
    total_fill = sum(interval[3] for interval in intervals)
    return (total_cut, total_fill)
