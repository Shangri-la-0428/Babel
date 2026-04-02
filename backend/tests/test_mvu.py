"""BABEL — MVU (Minimum Viable Universe) test.

Proves the complete loop: external agent inhabits world for 100 ticks.
Actions change world state. Traces are recorded. No LLM needed.

Success criteria (from roadmap):
  1. One SDK agent inhabits a Babel world for 100 ticks autonomously
  2. Its actions change world state
  3. Traces are recorded with action variety
  4. World feedback influences agent behavior
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import pytest
import yaml

from babel.decision import AgentContext, ExternalDecisionSource, ScriptedDecisionSource
from babel.engine import Engine
from babel.models import ActionOutput, ActionType, Session, WorldSeed
from babel.mvu import MVUBrain, MVUTracer


SEED_PATH = Path(__file__).parent.parent / "babel" / "seeds" / "mvu.yaml"
MVU_TICKS = 100


def _load_seed() -> WorldSeed:
    raw = yaml.safe_load(SEED_PATH.read_text())
    return WorldSeed(**raw)


def _build_engine(world_seed: WorldSeed) -> Engine:
    session = Session(world_seed=world_seed)
    session.init_agents()
    ext = ExternalDecisionSource(fallback=ScriptedDecisionSource(), timeout=30.0)
    ext.connect("kael")
    return Engine(session=session, decision_source=ext)


@pytest.mark.asyncio
async def test_mvu_100_ticks():
    """The proof: one external agent, 100 ticks, world state changes."""
    import babel.db as db_module

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "mvu.db"
        db_module.DB_PATH = db_path
        await db_module.init_db(db_path)

        world_seed = _load_seed()
        engine = _build_engine(world_seed)
        ext: ExternalDecisionSource = engine.decision_source

        brain = MVUBrain()
        tracer = MVUTracer()

        for tick_num in range(MVU_TICKS):
            # Engine starts tick — blocks on Kael's decide()
            tick_task = asyncio.create_task(engine.tick())

            # Kael perceives
            ctx = await ext.perceive("kael", timeout=15.0)
            assert ctx is not None, f"tick {tick_num}: perceive returned None"

            # Brain decides
            action = brain.decide(ctx)

            # Record trace
            tracer.record(tick_num, ctx, action)

            # Feed world experience back to brain (simulated Psyche feedback)
            if len(ctx.visible_agents) == 0:
                brain.stress = min(1.0, brain.stress + 0.05)  # isolation → stress
            else:
                brain.stress = max(0.0, brain.stress - 0.1)   # company → calm
                brain.trust = min(1.0, brain.trust + 0.02)    # repeated contact → trust

            # Act
            accepted = ext.act("kael", action)
            assert accepted, f"tick {tick_num}: act not accepted"

            # Wait for tick to complete
            await tick_task

        # ── Verify success criteria ──

        summary = tracer.summary()

        # 1. Completed 100 ticks
        assert summary["ticks"] == MVU_TICKS

        # 2. Action variety (at least 3 different action types)
        assert summary["action_variety"] >= 3, \
            f"only {summary['action_variety']} action types: {summary['actions']}"

        # 3. Agent moved between locations (world state changed)
        assert len(summary["locations"]) >= 2, \
            f"only visited: {summary['locations']}"

        # 4. Social interaction happened
        social = summary["actions"].get("speak", 0) + summary["actions"].get("trade", 0)
        assert social > 0, f"no social actions in {MVU_TICKS} ticks: {summary['actions']}"

        # 5. World tick advanced
        assert engine.session.tick == MVU_TICKS

        # 6. Stress/trust changed (world feedback → agent behavior loop)
        assert brain.stress != 0.0 or brain.trust != 0.5, \
            "no emotional feedback occurred"

        # 7. Physics: items actually transferred/consumed (not infinite)
        kael = engine.session.agents["kael"]
        mira = engine.session.agents["mira"]
        kael_inv = list(kael.inventory)
        mira_inv = list(mira.inventory)
        # Kael started with ["waterskin", "waterskin", "herb pouch"]
        # After many trades and use_items, inventory should have changed
        kael_start = ["waterskin", "waterskin", "herb pouch"]
        mira_start = ["pickaxe", "ore chunk", "ore chunk"]
        inventories_changed = (sorted(kael_inv) != sorted(kael_start) or
                               sorted(mira_inv) != sorted(mira_start))
        assert inventories_changed, (
            f"Physics not working! Kael: {kael_inv} (was {kael_start}), "
            f"Mira: {mira_inv} (was {mira_start})"
        )

        print(f"\n{'='*60}")
        print(f"  MVU COMPLETE: {MVU_TICKS} ticks")
        print(f"  Actions: {summary['actions']}")
        print(f"  Locations: {summary['locations']}")
        print(f"  Stress: {brain.stress:.2f}  Trust: {brain.trust:.2f}")
        print(f"  Traces: {len(tracer.traces)}")
        print(f"  Kael inventory: {kael_inv}")
        print(f"  Mira inventory: {mira_inv}")
        print(f"{'='*60}\n")


@pytest.mark.asyncio
async def test_mvu_brain_unit():
    """MVUBrain produces varied actions based on context."""
    brain = MVUBrain()

    # Alone with reachable locations → observes first (waits for others)
    ctx = AgentContext(
        agent_id="kael", agent_name="Kael", agent_location="Wellspring",
        agent_inventory=["waterskin"],
        visible_agents=[], reachable_locations=["Dustroad"],
        available_locations=["Wellspring", "Dustroad"],
    )
    action = brain.decide(ctx)
    assert action.type == ActionType.OBSERVE  # waits before moving
    # After 3 ticks at same location → moves
    brain.decide(ctx)
    brain.decide(ctx)
    action_move = brain.decide(ctx)
    assert action_move.type == ActionType.MOVE

    # With visible agent → should speak or trade
    ctx2 = AgentContext(
        agent_id="kael", agent_name="Kael", agent_location="Dustroad",
        agent_inventory=["waterskin", "herb pouch"],
        visible_agents=[{"id": "mira", "name": "Mira", "location": "Dustroad"}],
        reachable_locations=["Wellspring", "Ironhold"],
        available_locations=["Wellspring", "Ironhold", "Dustroad"],
    )
    action2 = brain.decide(ctx2)
    assert action2.type in (ActionType.SPEAK, ActionType.TRADE)

    # High stress → should withdraw
    brain.stress = 0.9
    ctx3 = AgentContext(
        agent_id="kael", agent_name="Kael", agent_location="Dustroad",
        agent_inventory=["waterskin"],
        visible_agents=[{"id": "mira", "name": "Mira", "location": "Dustroad"}],
        reachable_locations=["Wellspring", "Ironhold"],
        available_locations=["Wellspring", "Ironhold", "Dustroad"],
    )
    action3 = brain.decide(ctx3)
    assert action3.type == ActionType.MOVE  # withdrawing


@pytest.mark.asyncio
async def test_mvu_tracer():
    """MVUTracer records and summarizes correctly."""
    tracer = MVUTracer()
    ctx = AgentContext(
        agent_id="kael", agent_name="Kael", agent_location="Wellspring",
        agent_inventory=["waterskin"],
        visible_agents=[],
    )

    tracer.record(0, ctx, ActionOutput(type=ActionType.MOVE, target="Dustroad", content="traveling"))
    tracer.record(1, ctx, ActionOutput(type=ActionType.SPEAK, target="mira", content="hello"))
    tracer.record(2, ctx, ActionOutput(type=ActionType.OBSERVE, content="looking"))

    s = tracer.summary()
    assert s["ticks"] == 3
    assert s["action_variety"] == 3
    assert "move" in s["actions"]
