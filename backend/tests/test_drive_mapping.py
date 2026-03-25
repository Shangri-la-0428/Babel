"""Tests for drive-goal affinity mapping and drive-weighted goal selection."""

from __future__ import annotations

import pytest

from babel.drive_mapping import (
    DRIVES,
    MIN_AFFINITY,
    infer_drive_affinities,
    score_goal_by_drives,
)


# ── infer_drive_affinities ─────────────────────────────────────


def test_exploration_goal() -> None:
    """English exploration goal → high curiosity affinity."""
    aff = infer_drive_affinities("Explore the ancient ruins and discover their secrets")
    assert aff["curiosity"] == 1.0
    assert aff["curiosity"] > aff.get("safety", 0)


def test_social_goal() -> None:
    """Social/connection goal → high connection affinity."""
    aff = infer_drive_affinities("Meet the villagers and ally with the blacksmith")
    assert aff["connection"] == 1.0


def test_survival_goal() -> None:
    """Survival goal → high survival affinity."""
    aff = infer_drive_affinities("Survive the danger and protect the shelter")
    assert aff["survival"] == 1.0


def test_esteem_goal() -> None:
    """Leadership/esteem goal → high esteem affinity."""
    aff = infer_drive_affinities("Prove my authority and earn respect")
    assert aff["esteem"] == 1.0


def test_safety_goal() -> None:
    """Safety/security goal → high safety affinity."""
    aff = infer_drive_affinities("Guard the territory and avoid threats")
    assert aff["safety"] == 1.0


def test_chinese_exploration_goal() -> None:
    """Chinese exploration goal → high curiosity."""
    aff = infer_drive_affinities("探索这个神秘的洞穴，揭开真相")
    assert aff["curiosity"] == 1.0


def test_chinese_social_goal() -> None:
    """Chinese social goal → high connection."""
    aff = infer_drive_affinities("交谈并结盟，找到朋友")
    assert aff["connection"] == 1.0


def test_mixed_goal() -> None:
    """Goal with multiple drive keywords → multiple nonzero affinities."""
    aff = infer_drive_affinities("Explore the ruins and meet the survivors to help them survive")
    nonzero = [d for d, v in aff.items() if v > 0]
    assert len(nonzero) >= 2


def test_empty_string() -> None:
    """Empty goal text → even baseline distribution."""
    aff = infer_drive_affinities("")
    assert all(v == MIN_AFFINITY for v in aff.values())
    assert set(aff.keys()) == set(DRIVES)


def test_no_keywords_match() -> None:
    """Nonsensical text with no keywords → baseline distribution."""
    aff = infer_drive_affinities("zzzzz qqqq xxxx")
    assert all(v == MIN_AFFINITY for v in aff.values())


def test_all_drives_present() -> None:
    """Result always contains all 5 drive keys."""
    aff = infer_drive_affinities("explore")
    assert set(aff.keys()) == set(DRIVES)


def test_max_affinity_at_least_min() -> None:
    """At least one drive meets the minimum affinity threshold."""
    for text in ["explore", "meet people", "", "random words", "生存"]:
        aff = infer_drive_affinities(text)
        assert max(aff.values()) >= MIN_AFFINITY


# ── score_goal_by_drives ───────────────────────────────────────


def test_hungry_curiosity_prefers_exploration() -> None:
    """When curiosity drive is depleted, exploration goals score highest."""
    drive_state = {"survival": 80, "safety": 70, "connection": 60, "esteem": 50, "curiosity": 10}
    explore_score = score_goal_by_drives("Explore the cave and discover secrets", drive_state)
    social_score = score_goal_by_drives("Talk to the villagers and ally with them", drive_state)
    assert explore_score > social_score


def test_lonely_prefers_social() -> None:
    """When connection drive is depleted, social goals score highest."""
    drive_state = {"survival": 80, "safety": 70, "connection": 10, "esteem": 50, "curiosity": 80}
    social_score = score_goal_by_drives("Meet friends and help the partner", drive_state)
    explore_score = score_goal_by_drives("Explore the ruins", drive_state)
    assert social_score > explore_score


def test_all_drives_satisfied_low_scores() -> None:
    """When all drives are fully satisfied, scores are low."""
    drive_state = {"survival": 100, "safety": 100, "connection": 100, "esteem": 100, "curiosity": 100}
    score = score_goal_by_drives("Explore the cave", drive_state)
    assert score == 0.0


def test_all_drives_depleted_high_scores() -> None:
    """When all drives are zero, any goal with keywords scores high."""
    drive_state = {"survival": 0, "safety": 0, "connection": 0, "esteem": 0, "curiosity": 0}
    score = score_goal_by_drives("Explore and meet people", drive_state)
    assert score > 0.5


def test_score_with_missing_drive_defaults_50() -> None:
    """Missing drives in state default to 50 (neutral satisfaction)."""
    drive_state = {"curiosity": 10}  # Only curiosity specified
    score = score_goal_by_drives("Explore the caves", drive_state)
    assert score > 0  # curiosity is depleted → nonzero score


# ── Drive-weighted goal selection integration ──────────────────


def test_drive_weighted_selection() -> None:
    """Simulate engine's _select_next_goal logic with drive weighting."""
    goals = [
        "Explore the ancient library",
        "Talk to the villagers and make allies",
        "Guard the fortress and stay safe",
    ]
    # Connection depleted → should pick social goal
    drive_state = {"survival": 80, "safety": 80, "connection": 10, "esteem": 50, "curiosity": 80}

    scored = [(score_goal_by_drives(g, drive_state), g) for g in goals]
    scored.sort(key=lambda x: x[0], reverse=True)
    best_goal = scored[0][1]

    assert "Talk" in best_goal or "allies" in best_goal


def test_drive_weighted_selection_no_drives() -> None:
    """Without drive state, scoring still works (defaults to 50)."""
    goals = ["Explore caves", "Guard territory"]
    drive_state: dict[str, float] = {}  # Empty

    scores = [score_goal_by_drives(g, drive_state) for g in goals]
    # Both should get scores based on default 50 satisfaction
    assert all(s >= 0 for s in scores)
