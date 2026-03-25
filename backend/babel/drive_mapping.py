"""BABEL — Drive-Goal Affinity Mapping.

Maps goal text to Psyche drive affinities using keyword classification.
Pure functions, no I/O. Supports Chinese and English goal text.

Drives (Maslow hierarchy):
  survival  — existence, protection, resources
  safety    — security, stability, shelter
  connection — social bonds, alliances, help
  esteem    — recognition, leadership, mastery
  curiosity — exploration, discovery, learning
"""

from __future__ import annotations

DRIVE_KEYWORDS: dict[str, list[str]] = {
    "survival": [
        "survive", "escape", "protect", "defend", "shelter", "food", "water",
        "heal", "rescue", "save", "alive", "death", "kill", "danger", "threat",
        "生存", "逃离", "保护", "防御", "庇护", "食物", "水源", "治愈",
        "拯救", "活着", "死亡", "危险", "威胁", "活下去",
    ],
    "safety": [
        "secure", "guard", "fortify", "hide", "avoid", "safe", "stable",
        "calm", "peace", "settle", "rest", "home", "territory", "watch",
        "安全", "守卫", "躲避", "稳定", "平静", "和平", "安顿",
        "休息", "家", "领地", "巡逻",
    ],
    "connection": [
        "talk", "meet", "ally", "friend", "help", "bond", "unite", "together",
        "trust", "love", "family", "companion", "partner", "chat", "comfort",
        "daughter", "son", "mother", "father", "reunion", "reconcile",
        "交谈", "结盟", "朋友", "帮助", "团结", "信任", "爱",
        "家人", "伙伴", "女儿", "儿子", "母亲", "父亲", "重逢", "和解",
        "找到", "寻找", "失踪",
    ],
    "esteem": [
        "prove", "lead", "master", "earn", "recognition", "respect", "honor",
        "power", "authority", "reputation", "fame", "status", "dominance",
        "control", "influence", "win", "victory", "conquer",
        "证明", "领导", "掌握", "尊重", "荣誉", "权力", "威望",
        "名声", "地位", "支配", "控制", "影响", "胜利", "征服",
    ],
    "curiosity": [
        "explore", "find", "discover", "investigate", "learn", "search",
        "examine", "study", "research", "uncover", "mystery", "secret",
        "clue", "trace", "puzzle", "understand", "know", "truth",
        "探索", "发现", "调查", "学习", "寻找", "研究", "揭开",
        "秘密", "线索", "谜", "追踪", "真相", "了解",
    ],
}

# All drive names
DRIVES = ("survival", "safety", "connection", "esteem", "curiosity")

# Minimum affinity for the highest-scoring drive (ensures every goal maps somewhere)
MIN_AFFINITY = 0.2


def infer_drive_affinities(goal_text: str) -> dict[str, float]:
    """Infer drive affinities from goal text using keyword matching.

    Returns a dict mapping drive names to affinity scores (0.0-1.0).
    At least one drive will have affinity >= MIN_AFFINITY.
    """
    if not goal_text:
        return {d: MIN_AFFINITY for d in DRIVES}

    text_lower = goal_text.lower()
    scores: dict[str, float] = {}

    for drive, keywords in DRIVE_KEYWORDS.items():
        hits = sum(1 for kw in keywords if kw in text_lower)
        scores[drive] = hits

    max_score = max(scores.values()) if scores else 0

    if max_score == 0:
        # No keywords matched — even distribution with baseline
        return {d: MIN_AFFINITY for d in DRIVES}

    # Normalize to 0.0-1.0 range
    result = {}
    for drive in DRIVES:
        normalized = scores.get(drive, 0) / max_score
        result[drive] = round(normalized, 2)

    # Ensure at least one drive meets minimum
    if max(result.values()) < MIN_AFFINITY:
        top_drive = max(result, key=result.get)  # type: ignore[arg-type]
        result[top_drive] = MIN_AFFINITY

    return result


def score_goal_by_drives(
    goal_text: str,
    drive_state: dict[str, float],
) -> float:
    """Score a goal based on how well it addresses unsatisfied drives.

    Higher score = goal addresses drives that are more depleted.
    drive_state values are 0-100 (satisfaction level).
    """
    affinities = infer_drive_affinities(goal_text)
    score = 0.0
    for drive, affinity in affinities.items():
        # Drive need = inverse of satisfaction (0-100 scale)
        need = (100 - drive_state.get(drive, 50)) / 100
        score += affinity * need
    return score
