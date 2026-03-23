"""BABEL — World clock. Pure-function time computation from tick + config."""

from __future__ import annotations

from dataclasses import dataclass

from .models import TimeConfig


@dataclass
class WorldTime:
    tick: int
    elapsed_units: float
    display: str          # e.g. "Day 1, 22:15" or "Tick 15"
    period: str           # e.g. "night", "morning", or ""
    day: int              # day number (0 if no day cycle)
    is_night: bool


def world_time(tick: int, config: TimeConfig) -> WorldTime:
    """Compute narrative world time from a tick number. Pure, zero side-effects."""

    # Fallback: no time config → just show tick
    if config.unit == "tick":
        return WorldTime(
            tick=tick,
            elapsed_units=float(tick),
            display=f"Tick {tick}",
            period="",
            day=0,
            is_night=False,
        )

    # Elapsed time units since start
    elapsed = tick / max(config.ticks_per_unit, 1)

    # Parse start time to extract initial hour-of-day
    start_hour = _parse_start_hour(config.start)

    # Day and time-of-day calculation
    day = 0
    hour_of_day = 0.0
    period = ""
    is_night = False

    if config.day_cycle and config.day_length > 0:
        total_hours = start_hour + elapsed
        day = int(total_hours // config.day_length) + 1
        hour_of_day = total_hours % config.day_length

        # Find current period
        for p in config.periods:
            p_start = p.get("start", 0)
            p_end = p.get("end", 0)
            if _in_period(hour_of_day, p_start, p_end):
                period = p.get("name", "")
                break

        is_night = _is_night(hour_of_day, config.periods)

    # Build display string
    display = _build_display(config, elapsed, day, hour_of_day)

    return WorldTime(
        tick=tick,
        elapsed_units=elapsed,
        display=display,
        period=period,
        day=day,
        is_night=is_night,
    )


def _parse_start_hour(start: str) -> float:
    """Extract hour-of-day from start string. Best-effort."""
    if not start:
        return 0.0
    # Try "HH:MM" at the end (e.g. "2077-11-15 22:00")
    parts = start.strip().split()
    for part in reversed(parts):
        if ":" in part:
            try:
                h, m = part.split(":")[:2]
                return int(h) + int(m) / 60.0
            except (ValueError, IndexError):
                continue
    return 0.0


def _in_period(hour: float, start: int, end: int) -> bool:
    """Check if hour is within a period (handles wrap-around like 22→6)."""
    h = hour % 24
    if start <= end:
        return start <= h < end
    else:
        # Wraps around midnight
        return h >= start or h < end


def _is_night(hour: float, periods: list[dict]) -> bool:
    """Check if current hour falls in a period named 'night'."""
    for p in periods:
        if p.get("name", "").lower() == "night":
            if _in_period(hour, p.get("start", 22), p.get("end", 6)):
                return True
    return False


def _build_display(config: TimeConfig, elapsed: float, day: int, hour_of_day: float) -> str:
    """Build human-readable time display."""
    if config.unit == "tick":
        return f"Tick {int(elapsed)}"

    if config.day_cycle and config.day_length > 0:
        h = int(hour_of_day)
        m = int((hour_of_day % 1) * 60)
        time_str = f"{h:02d}:{m:02d}"

        if config.unit in ("hour", "minute"):
            return f"Day {day}, {time_str}"
        else:
            return f"Day {day}"
    else:
        # No day cycle — just show elapsed
        unit_label = config.unit if config.unit != "tick" else ""
        return f"{elapsed:.0f} {unit_label}".strip()
