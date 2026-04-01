"""BABEL — Benchmark Scorecard.

Runs 100-tick simulations on all benchmark seeds using ContextAwareDecisionSource
(zero LLM calls) and outputs a comparative scorecard of world-health metrics.

Usage:
    cd backend && .venv/bin/python tests/benchmark_scorecard.py
"""

from __future__ import annotations

import asyncio
import math
import sys
from collections import Counter
from pathlib import Path
from unittest.mock import AsyncMock, patch

# Ensure the backend package is importable when running as a script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from babel.decision import ContextAwareDecisionSource
from babel.engine import Engine
from babel.models import AgentStatus, EventSignificance, GoalState, Session, WorldSeed


# ── Configuration ────────────────────────────────────────

SEED_DIR = Path(__file__).resolve().parent.parent / "babel" / "seeds"
BENCHMARK_SEEDS = ["cyber_bar.yaml"]
TICKS = 100
RNG_SEED = 42

SIGNIFICANCE_AXES = ["goal", "social", "state", "resource", "world", "information", "ambient"]
ACTION_TYPES = ["speak", "move", "trade", "use_item", "observe", "wait"]

# ── Helpers ──────────────────────────────────────────────


def _load_session(seed_file: str) -> Session:
    """Load a seed YAML into a fresh Session with agents initialised."""
    path = SEED_DIR / seed_file
    if not path.exists():
        raise FileNotFoundError(f"Seed not found: {path}")
    ws = WorldSeed.from_yaml(str(path))
    session = Session(world_seed=ws)
    session.init_agents()
    return session


def _entropy(counts: dict[str, int]) -> float:
    """Shannon entropy in bits: -sum(p * log2(p))."""
    total = sum(counts.values())
    if total == 0:
        return 0.0
    ent = 0.0
    for c in counts.values():
        if c > 0:
            p = c / total
            ent -= p * math.log2(p)
    return ent


def _pct(numerator: int | float, denominator: int | float) -> float:
    """Safe percentage."""
    if denominator == 0:
        return 0.0
    return (numerator / denominator) * 100.0


# ── Simulation Runner ────────────────────────────────────


async def _run_seed(seed_file: str) -> dict:
    """Run a 100-tick simulation on a single seed and return raw metrics."""
    session = _load_session(seed_file)
    src = ContextAwareDecisionSource(seed=RNG_SEED)

    # Snapshot initial relation strengths (keyed by (source, target))
    initial_strengths: dict[tuple[str, str], float] = {}
    for rel in session.relations:
        initial_strengths[(rel.source, rel.target)] = rel.strength

    all_events = []

    # Mock all DB calls identically to test_stability.py
    patches = [
        patch("babel.memory.save_memory", new_callable=AsyncMock),
        patch("babel.memory.query_memories", new_callable=AsyncMock, return_value=[]),
        patch("babel.memory.delete_memories", new_callable=AsyncMock),
        patch("babel.memory.update_memory_access", new_callable=AsyncMock),
        patch("babel.memory.load_events_filtered", new_callable=AsyncMock, return_value=[]),
        patch("babel.engine.save_timeline_node", new_callable=AsyncMock),
        patch("babel.engine.save_snapshot", new_callable=AsyncMock),
        patch("babel.engine.get_last_node_id", new_callable=AsyncMock, return_value=None),
        patch("babel.engine.load_entity_details", new_callable=AsyncMock, return_value=None),
        patch("babel.engine.save_entity_details", new_callable=AsyncMock),
        patch("babel.engine.load_events", new_callable=AsyncMock, return_value=[]),
        patch("babel.engine.load_events_filtered", new_callable=AsyncMock, return_value=[]),
    ]

    for p in patches:
        p.start()

    engine = Engine(
        session=session,
        decision_source=src,
        snapshot_interval=5,
        epoch_interval=3,
        belief_interval=5,
    )

    for _ in range(TICKS):
        events = await engine.tick()
        all_events.extend(events)

    for p in patches:
        p.stop()

    # ── Compute Metrics ──

    total_agents = len(session.agents)
    alive_agents = sum(
        1
        for a in session.agents.values()
        if a.status not in (AgentStatus.DEAD, AgentStatus.GONE)
    )

    # Goal completion rate
    agents_with_completed_goal = 0
    total_active_goals = 0
    stalled_goals = 0
    for agent in session.agents.values():
        completed_any = False
        if agent.active_goal:
            total_active_goals += 1
            if agent.active_goal.status == "completed":
                completed_any = True
            if agent.active_goal.stall_count >= 5:
                stalled_goals += 1
        # Check all goals text against active_goal history
        # (the active_goal cycles through goal list, so completion is per-agent)
        if completed_any:
            agents_with_completed_goal += 1

    # Relation volatility: average absolute change in strength across all pairs
    final_strengths: dict[tuple[str, str], float] = {}
    for rel in session.relations:
        final_strengths[(rel.source, rel.target)] = rel.strength

    all_keys = set(initial_strengths.keys()) | set(final_strengths.keys())
    strength_deltas = []
    for key in all_keys:
        before = initial_strengths.get(key, 0.5)  # default 0.5 for new relations
        after = final_strengths.get(key, before)
        strength_deltas.append(abs(after - before))
    relation_volatility = sum(strength_deltas) / len(strength_deltas) if strength_deltas else 0.0
    relation_pair_count = len(all_keys)

    # Significance distribution
    sig_counts: dict[str, int] = {axis: 0 for axis in SIGNIFICANCE_AXES}
    durable_count = 0
    for event in all_events:
        sig: EventSignificance = event.significance
        for axis in sig.axes:
            if axis in sig_counts:
                sig_counts[axis] += 1
        if sig.durable:
            durable_count += 1

    # Action diversity (entropy)
    action_counts: dict[str, int] = {at: 0 for at in ACTION_TYPES}
    for event in all_events:
        at = event.action_type.value if hasattr(event.action_type, "value") else str(event.action_type)
        if at in action_counts:
            action_counts[at] += 1
        else:
            action_counts[at] = action_counts.get(at, 0) + 1
    action_entropy = _entropy(action_counts)
    max_entropy = math.log2(len(ACTION_TYPES)) if ACTION_TYPES else 0.0

    return {
        "seed": seed_file,
        "world_name": session.world_seed.name,
        "total_agents": total_agents,
        "alive_agents": alive_agents,
        "total_events": len(all_events),
        "agents_with_completed_goal": agents_with_completed_goal,
        "total_active_goals": total_active_goals,
        "stalled_goals": stalled_goals,
        "goal_completion_rate": _pct(agents_with_completed_goal, total_agents),
        "goal_stall_rate": _pct(stalled_goals, total_active_goals),
        "relation_volatility": relation_volatility,
        "relation_pair_count": relation_pair_count,
        "sig_counts": sig_counts,
        "durable_count": durable_count,
        "durable_ratio": _pct(durable_count, len(all_events)),
        "action_counts": action_counts,
        "action_entropy": action_entropy,
        "max_entropy": max_entropy,
        "survival_rate": _pct(alive_agents, total_agents),
    }


# ── Formatting ───────────────────────────────────────────

DIVIDER = "=" * 72
THIN_DIVIDER = "-" * 72


def _print_scorecard(m: dict) -> None:
    """Print a formatted scorecard for one seed."""
    print(f"\n{DIVIDER}")
    print(f"  SEED: {m['seed']}")
    print(f"  WORLD: {m['world_name']}")
    print(DIVIDER)

    print(f"\n  Agents: {m['total_agents']}   |   Events: {m['total_events']}   |   Ticks: {TICKS}")
    print(f"  Survival rate: {m['survival_rate']:.1f}%")

    print(f"\n  {THIN_DIVIDER}")
    print("  GOALS")
    print(f"  {THIN_DIVIDER}")
    print(f"    Completion rate:  {m['goal_completion_rate']:6.1f}%   ({m['agents_with_completed_goal']}/{m['total_agents']} agents)")
    print(f"    Stall rate:       {m['goal_stall_rate']:6.1f}%   ({m['stalled_goals']}/{m['total_active_goals']} active goals)")

    print(f"\n  {THIN_DIVIDER}")
    print("  RELATIONS")
    print(f"  {THIN_DIVIDER}")
    print(f"    Volatility (avg |delta|): {m['relation_volatility']:.4f}")
    print(f"    Total relation pairs:     {m['relation_pair_count']}")

    print(f"\n  {THIN_DIVIDER}")
    print("  SIGNIFICANCE DISTRIBUTION")
    print(f"  {THIN_DIVIDER}")
    sig = m["sig_counts"]
    max_count = max(sig.values()) if sig.values() else 1
    for axis in SIGNIFICANCE_AXES:
        count = sig[axis]
        bar_len = int((count / max(max_count, 1)) * 30)
        bar = "#" * bar_len
        print(f"    {axis:<12s}  {count:4d}  {bar}")
    print(f"    {'':12s}  ----")
    print(f"    {'DURABLE':12s}  {m['durable_count']:4d}  ({m['durable_ratio']:.1f}% of all events)")

    print(f"\n  {THIN_DIVIDER}")
    print("  ACTION DIVERSITY")
    print(f"  {THIN_DIVIDER}")
    ac = m["action_counts"]
    total_actions = sum(ac.values())
    for at in ACTION_TYPES:
        count = ac.get(at, 0)
        pct = _pct(count, total_actions)
        bar_len = int(pct / 100 * 30)
        bar = "#" * bar_len
        print(f"    {at:<12s}  {count:4d}  ({pct:5.1f}%)  {bar}")
    print(f"    Entropy: {m['action_entropy']:.3f} / {m['max_entropy']:.3f} bits  (normalised: {m['action_entropy'] / m['max_entropy']:.2f})" if m["max_entropy"] > 0 else "    Entropy: 0")

    print()


def _print_summary(results: list[dict]) -> None:
    """Print a comparison table across all seeds."""
    print(f"\n{'=' * 90}")
    print("  BENCHMARK SUMMARY")
    print(f"{'=' * 90}")

    # Header
    col_w = 18
    header = f"  {'Metric':<28s}"
    for r in results:
        label = r["seed"].replace(".yaml", "")
        header += f"  {label:>{col_w}s}"
    print(header)
    print(f"  {'-' * 28}" + f"  {'-' * col_w}" * len(results))

    # Rows
    rows = [
        ("Agents", lambda r: f"{r['total_agents']}"),
        ("Total Events", lambda r: f"{r['total_events']}"),
        ("Survival Rate", lambda r: f"{r['survival_rate']:.1f}%"),
        ("Goal Completion Rate", lambda r: f"{r['goal_completion_rate']:.1f}%"),
        ("Goal Stall Rate", lambda r: f"{r['goal_stall_rate']:.1f}%"),
        ("Relation Volatility", lambda r: f"{r['relation_volatility']:.4f}"),
        ("Durable Event Ratio", lambda r: f"{r['durable_ratio']:.1f}%"),
        ("Action Entropy (bits)", lambda r: f"{r['action_entropy']:.3f}"),
        ("Entropy (normalised)", lambda r: f"{r['action_entropy'] / r['max_entropy']:.2f}" if r["max_entropy"] > 0 else "N/A"),
    ]

    for label, fn in rows:
        line = f"  {label:<28s}"
        for r in results:
            line += f"  {fn(r):>{col_w}s}"
        print(line)

    print(f"\n  Seeds: {', '.join(r['seed'] for r in results)}")
    print(f"  Ticks: {TICKS}  |  RNG seed: {RNG_SEED}  |  Decision source: ContextAwareDecisionSource")
    print()


# ── Main ─────────────────────────────────────────────────


async def main() -> None:
    available = [s for s in BENCHMARK_SEEDS if (SEED_DIR / s).exists()]
    if not available:
        print(f"ERROR: No benchmark seeds found in {SEED_DIR}")
        print(f"  Looked for: {', '.join(BENCHMARK_SEEDS)}")
        sys.exit(1)

    missing = [s for s in BENCHMARK_SEEDS if s not in available]
    if missing:
        print(f"WARNING: Missing seeds (skipped): {', '.join(missing)}")

    print(f"\nBABEL Benchmark Scorecard")
    print(f"Running {TICKS}-tick simulations on {len(available)} seeds...")
    print(f"Decision source: ContextAwareDecisionSource (seed={RNG_SEED})")

    results = []
    for seed_file in available:
        print(f"\n  Simulating {seed_file}...", end="", flush=True)
        metrics = await _run_seed(seed_file)
        print(f" done. ({metrics['total_events']} events)")
        results.append(metrics)

    # Print individual scorecards
    for m in results:
        _print_scorecard(m)

    # Print summary comparison
    if len(results) > 1:
        _print_summary(results)


if __name__ == "__main__":
    asyncio.run(main())
