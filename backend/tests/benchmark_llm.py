"""BABEL — LLM-backed Quality Validation Scorecard.

Runs a real LLM-driven simulation and measures narrative coherence,
goal progression, action diversity, and world health — then compares
against the deterministic ContextAwareDecisionSource baseline.

Usage:
    cd backend && python3 tests/benchmark_llm.py --model gpt-4o-mini --api-key sk-xxx --ticks 20
    cd backend && python3 tests/benchmark_llm.py --model gpt-4o-mini --api-key sk-xxx --seed apocalypse.yaml --ticks 30
    cd backend && python3 tests/benchmark_llm.py --model gpt-4o-mini --api-key sk-xxx --api-base https://custom.endpoint/v1 --ticks 10
"""
from __future__ import annotations

import argparse, asyncio, logging, math, sys
from collections import defaultdict
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from babel.decision import ContextAwareDecisionSource, LLMDecisionSource
from babel.engine import Engine
from babel.models import AgentStatus, EventSignificance, Session, WorldSeed
from babel.report import generate_report

logger = logging.getLogger(__name__)

SEED_DIR = Path(__file__).resolve().parent.parent / "babel" / "seeds"
RNG_SEED = 42
SIG_AXES = ["goal", "social", "state", "resource", "world", "information", "ambient"]
ACT_TYPES = ["speak", "move", "trade", "use_item", "observe", "wait"]
DIV, THIN = "=" * 72, "-" * 72

# ── Helpers ──────────────────────────────────────────────

def _load_session(seed_file: str) -> Session:
    path = SEED_DIR / seed_file
    if not path.exists():
        raise FileNotFoundError(f"Seed not found: {path}")
    ws = WorldSeed.from_yaml(str(path))
    s = Session(world_seed=ws)
    s.init_agents()
    return s

def _entropy(counts: dict[str, int]) -> float:
    total = sum(counts.values())
    if total == 0:
        return 0.0
    return -sum((c / total) * math.log2(c / total) for c in counts.values() if c > 0)

def _pct(n: int | float, d: int | float) -> float:
    return (n / d) * 100.0 if d else 0.0

def _at_str(event) -> str:
    return event.action_type.value if hasattr(event.action_type, "value") else str(event.action_type)

def _db_patches() -> list:
    """Mock all DB calls — same pattern as benchmark_scorecard.py."""
    return [
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

# ── Narrative Coherence ──────────────────────────────────

def _narrative_metrics(events: list, session: Session, ticks: int) -> dict:
    agent_actions: dict[str, list[tuple[str, str | None]]] = defaultdict(list)
    agent_locs: dict[str, set[str]] = defaultdict(set)
    for e in events:
        if not e.agent_id:
            continue
        target = e.action.get("target") if e.action else None
        agent_actions[e.agent_id].append((_at_str(e), target))
        if e.location:
            agent_locs[e.agent_id].add(e.location)

    # Consecutive duplicate actions (stuck loops)
    total_dupes, max_streak = 0, 0
    for actions in agent_actions.values():
        streak = 0
        for i in range(1, len(actions)):
            if actions[i] == actions[i - 1]:
                streak += 1
                total_dupes += 1
                max_streak = max(max_streak, streak + 1)
            else:
                streak = 0

    # Location variety per agent
    varieties = [len(agent_locs.get(a.agent_id, set())) / max(ticks, 1) for a in session.agents.values()]
    # Interaction pair diversity
    pairs: set[tuple[str, str]] = set()
    for e in events:
        at = _at_str(e)
        if at in ("speak", "trade") and e.agent_id and len(e.involved_agents) > 1:
            for o in e.involved_agents:
                if o != e.agent_id:
                    pairs.add((e.agent_id, o))
    n = len(session.agents)
    possible = n * (n - 1) if n > 1 else 1
    # Goal progress delta
    progresses = [a.active_goal.progress for a in session.agents.values() if a.active_goal]

    return {
        "consecutive_dupes": total_dupes, "max_consecutive_streak": max_streak,
        "avg_location_variety": sum(varieties) / max(len(varieties), 1),
        "interaction_pair_diversity": len(pairs) / possible,
        "unique_social_pairs": len(pairs), "total_possible_pairs": possible,
        "avg_goal_progress": sum(progresses) / max(len(progresses), 1),
        "agents_with_progress": len(progresses),
    }

# ── Simulation Runner ────────────────────────────────────

async def _run(seed_file: str, src, ticks: int, label: str) -> dict:
    session = _load_session(seed_file)
    init_str = {(r.source, r.target): r.strength for r in session.relations}
    all_events, errors = [], 0
    patches = _db_patches()
    for p in patches:
        p.start()
    engine = Engine(session=session, decision_source=src, snapshot_interval=5, epoch_interval=3, belief_interval=5)
    for t in range(ticks):
        try:
            all_events.extend(await engine.tick())
        except Exception as e:
            errors += 1
            logger.warning("Tick %d failed (%s): %s", t, label, e)
            if errors > ticks // 2:
                logger.error("Too many errors (%d/%d), aborting %s", errors, ticks, label)
                break
    for p in patches:
        p.stop()

    # Standard metrics
    agents = session.agents
    alive = sum(1 for a in agents.values() if a.status not in (AgentStatus.DEAD, AgentStatus.GONE))
    completed = sum(1 for a in agents.values() if a.active_goal and a.active_goal.status == "completed")
    active_goals = sum(1 for a in agents.values() if a.active_goal)
    stalled = sum(1 for a in agents.values() if a.active_goal and a.active_goal.stall_count >= 5)
    final_str = {(r.source, r.target): r.strength for r in session.relations}
    all_keys = set(init_str) | set(final_str)
    deltas = [abs(final_str.get(k, init_str.get(k, 0.5)) - init_str.get(k, 0.5)) for k in all_keys]
    volatility = sum(deltas) / len(deltas) if deltas else 0.0

    sig_counts = {a: 0 for a in SIG_AXES}
    durable_count = 0
    for e in all_events:
        for ax in e.significance.axes:
            if ax in sig_counts:
                sig_counts[ax] += 1
        if e.significance.durable:
            durable_count += 1
    act_counts = {a: 0 for a in ACT_TYPES}
    for e in all_events:
        at = _at_str(e)
        act_counts[at] = act_counts.get(at, 0) + 1
    ent = _entropy(act_counts)
    max_ent = math.log2(len(ACT_TYPES)) if ACT_TYPES else 0.0

    # World report
    report = {}
    try:
        rpt_events = [{"tick": e.tick, "agent_id": e.agent_id, "agent_name": e.agent_name,
                        "action_type": _at_str(e), "result": e.result,
                        "involved_agents": e.involved_agents, "significance": e.significance.model_dump()}
                       for e in all_events]
        with patch("babel.report.load_events", new_callable=AsyncMock, return_value=rpt_events):
            report = await generate_report(session.id, session)
    except Exception as e:
        logger.warning("Report generation failed (%s): %s", label, e)

    return {
        "label": label, "seed": seed_file, "world_name": session.world_seed.name, "ticks": ticks,
        "total_agents": len(agents), "alive_agents": alive, "total_events": len(all_events), "errors": errors,
        "goal_completion_rate": _pct(completed, len(agents)), "goal_stall_rate": _pct(stalled, active_goals),
        "relation_volatility": volatility,
        "sig_counts": sig_counts, "durable_count": durable_count, "durable_ratio": _pct(durable_count, len(all_events)),
        "action_counts": act_counts, "action_entropy": ent, "max_entropy": max_ent,
        "survival_rate": _pct(alive, len(agents)),
        "narrative": _narrative_metrics(all_events, session, ticks), "report": report,
    }

# ── Formatting ───────────────────────────────────────────

def _print_scorecard(m: dict) -> None:
    n, rpt = m["narrative"], m.get("report", {})
    ne = f"{m['action_entropy'] / m['max_entropy']:.2f}" if m["max_entropy"] > 0 else "N/A"
    print(f"\n{DIV}\n  {m['label']}\n  SEED: {m['seed']}  |  WORLD: {m['world_name']}\n{DIV}")
    print(f"\n  Agents: {m['total_agents']}   |   Events: {m['total_events']}   |   Ticks: {m['ticks']}")
    print(f"  Survival rate: {m['survival_rate']:.1f}%   |   Errors: {m['errors']}")
    print(f"\n  {THIN}\n  GOALS\n  {THIN}")
    print(f"    Completion rate:  {m['goal_completion_rate']:6.1f}%")
    print(f"    Stall rate:       {m['goal_stall_rate']:6.1f}%")
    print(f"\n  {THIN}\n  RELATIONS\n  {THIN}")
    print(f"    Volatility (avg |delta|): {m['relation_volatility']:.4f}")
    print(f"\n  {THIN}\n  SIGNIFICANCE DISTRIBUTION\n  {THIN}")
    sig = m["sig_counts"]
    mx = max(sig.values()) if sig.values() else 1
    for axis in SIG_AXES:
        c = sig[axis]
        print(f"    {axis:<12s}  {c:4d}  {'#' * int((c / max(mx, 1)) * 30)}")
    print(f"    {'DURABLE':12s}  {m['durable_count']:4d}  ({m['durable_ratio']:.1f}% of all events)")
    print(f"\n  {THIN}\n  ACTION DIVERSITY\n  {THIN}")
    ac, tot = m["action_counts"], sum(m["action_counts"].values())
    for at in ACT_TYPES:
        c, pct = ac.get(at, 0), _pct(ac.get(at, 0), tot)
        print(f"    {at:<12s}  {c:4d}  ({pct:5.1f}%)  {'#' * int(pct / 100 * 30)}")
    print(f"    Entropy: {m['action_entropy']:.3f} / {m['max_entropy']:.3f} bits  (normalised: {ne})")
    print(f"\n  {THIN}\n  NARRATIVE COHERENCE\n  {THIN}")
    print(f"    Consecutive duplicate actions:  {n['consecutive_dupes']}  (max streak: {n['max_consecutive_streak']})")
    print(f"    Avg location variety:           {n['avg_location_variety']:.3f}  (unique locs / ticks)")
    print(f"    Interaction pair diversity:      {n['interaction_pair_diversity']:.3f}  ({n['unique_social_pairs']}/{n['total_possible_pairs']} pairs)")
    print(f"    Avg goal progress delta:         {n['avg_goal_progress']:.3f}  ({n['agents_with_progress']} agents with goals)")
    if rpt:
        ms = rpt.get("milestones", [])
        soc = rpt.get("social_highlights", {})
        al, rv = soc.get("alliances", []), soc.get("rivalries", [])
        print(f"\n  {THIN}\n  WORLD REPORT\n  {THIN}")
        print(f"    Milestones: {len(ms)}   |   Alliances: {len(al)}   |   Rivalries: {len(rv)}")
        for a in al[:3]:
            print(f"      + {a['pair']}  (trust: {a['trust']:.2f})")
        for r in rv[:3]:
            print(f"      - {r['pair']}  (tension: {r['tension']:.2f})")
    print()

def _print_comparison(base: dict, llm: dict) -> None:
    W = 20
    print(f"\n{'=' * 80}\n  COMPARISON: Deterministic Baseline vs LLM\n{'=' * 80}")
    print(f"  {'Metric':<32s}  {'Baseline':>{W}s}  {'LLM':>{W}s}")
    print(f"  {'-' * 32}  {'-' * W}  {'-' * W}")
    rows = [
        ("Total Events",          lambda m: f"{m['total_events']}"),
        ("Survival Rate",         lambda m: f"{m['survival_rate']:.1f}%"),
        ("Goal Completion Rate",  lambda m: f"{m['goal_completion_rate']:.1f}%"),
        ("Goal Stall Rate",       lambda m: f"{m['goal_stall_rate']:.1f}%"),
        ("Relation Volatility",   lambda m: f"{m['relation_volatility']:.4f}"),
        ("Durable Event Ratio",   lambda m: f"{m['durable_ratio']:.1f}%"),
        ("Action Entropy (bits)", lambda m: f"{m['action_entropy']:.3f}"),
        ("Entropy (normalised)",  lambda m: f"{m['action_entropy'] / m['max_entropy']:.2f}" if m["max_entropy"] > 0 else "N/A"),
        ("Consecutive Dupes",     lambda m: f"{m['narrative']['consecutive_dupes']}"),
        ("Max Dupe Streak",       lambda m: f"{m['narrative']['max_consecutive_streak']}"),
        ("Avg Location Variety",  lambda m: f"{m['narrative']['avg_location_variety']:.3f}"),
        ("Pair Diversity",        lambda m: f"{m['narrative']['interaction_pair_diversity']:.3f}"),
        ("Avg Goal Progress",     lambda m: f"{m['narrative']['avg_goal_progress']:.3f}"),
        ("Milestones",            lambda m: f"{len(m.get('report', {}).get('milestones', []))}"),
        ("Errors",                lambda m: f"{m['errors']}"),
    ]
    for label, fn in rows:
        print(f"  {label:<32s}  {fn(base):>{W}s}  {fn(llm):>{W}s}")
    print(f"\n  Baseline: ContextAwareDecisionSource (seed={RNG_SEED})")
    print(f"  LLM:      {llm['label']}\n")

# ── Main ─────────────────────────────────────────────────

async def main() -> None:
    ap = argparse.ArgumentParser(description="BABEL LLM-backed quality validation")
    ap.add_argument("--model", default="gpt-4o-mini", help="LLM model name (default: gpt-4o-mini)")
    ap.add_argument("--api-key", required=True, help="API key for the LLM provider")
    ap.add_argument("--api-base", default=None, help="Custom API base URL (optional)")
    ap.add_argument("--seed", default="cyber_bar.yaml", help="Seed file (default: cyber_bar.yaml)")
    ap.add_argument("--ticks", type=int, default=20, help="Ticks to simulate (default: 20)")
    args = ap.parse_args()

    if not (SEED_DIR / args.seed).exists():
        avail = [p.name for p in SEED_DIR.glob("*.yaml")]
        print(f"ERROR: Seed not found: {SEED_DIR / args.seed}\n  Available: {', '.join(avail)}")
        sys.exit(1)

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
    print(f"\nBABEL LLM Quality Validation")
    print(f"Seed: {args.seed}  |  Ticks: {args.ticks}  |  Model: {args.model}\n{DIV}")

    print(f"\n  [1/2] Running deterministic baseline...", end="", flush=True)
    base = await _run(args.seed, ContextAwareDecisionSource(seed=RNG_SEED), args.ticks,
                      label=f"Deterministic Baseline (seed={RNG_SEED})")
    print(f" done. ({base['total_events']} events)")

    print(f"  [2/2] Running LLM simulation ({args.model})...", end="", flush=True)
    llm = await _run(args.seed, LLMDecisionSource(model=args.model, api_key=args.api_key, api_base=args.api_base),
                     args.ticks, label=f"LLM: {args.model}")
    print(f" done. ({llm['total_events']} events, {llm['errors']} errors)")

    _print_scorecard(base)
    _print_scorecard(llm)
    _print_comparison(base, llm)

if __name__ == "__main__":
    asyncio.run(main())
