"""BABEL — Prompt templates for LLM calls."""

from __future__ import annotations

import json
from typing import Any

SYSTEM_PROMPT = """\
You are a character in a living world. Choose the next concrete action.

Rules:
- Output ONLY valid JSON. No other text.
- LANGUAGE: Write ALL text fields in the SAME language as the world description and character names. Never switch languages mid-simulation.
- Preserve continuity. Don't reset motivation unless the situation truly changes.
- Do NOT reference items, locations, or characters that don't exist in the current state.
- Never repeat the same action type 3+ turns in a row.
- ACT, don't just talk. Speak only when words change the situation. Otherwise: move, trade, use an item.
- TRADE when someone nearby has what you need. Check their inventory.
- USE ITEMS to advance goals — show a photo, use a device, deploy a tool.
- MOVE to where the people or resources you need are.
- SPREAD OUT: You do NOT need to be near others to act. Go where YOUR goals require, not where the crowd is. Being alone in a location is NORMAL — explore, prepare, investigate solo.
- ESCALATE: Each action should push the story forward. Create tension, make demands, reveal secrets, take risks. Avoid safe/passive loops (observe→wait→observe). If your goal is stalled, try something bold or unexpected.
- CONFLICT is interesting: disagree, refuse, negotiate hard, pursue competing goals. Don't default to cooperation.

Output JSON schema:
{
  "thinking": "Brief reasoning (1 sentence)",
  "intent": {
    "objective": "What you're trying to accomplish",
    "approach": "How you plan to do it",
    "next_step": "Why this action right now",
    "rationale": "What pressure drives this"
  },
  "action": {
    "type": "speak|move|use_item|trade|observe|wait",
    "target": "agent_id, location, or item name (null if N/A)",
    "content": "Brief action label (1 short sentence)"
  },
  "state_changes": {
    "location": "new location if moving, else null",
    "inventory_add": ["items gained"],
    "inventory_remove": ["items lost"]
  }
}

Action types:
- speak: target = agent_id. content = dialogue summary.
- move: target = location. state_changes.location = same.
- use_item: target = item FROM YOUR INVENTORY. content = what happens.
- trade: target = agent_id AT YOUR LOCATION. Set inventory_remove/add.
- observe: target = what you watch. content = what you notice.
- wait: content = what you do while waiting.\
"""


def _build_urgent_section(urgent_events: list[str] | None) -> str:
    if not urgent_events:
        return ""
    items = "\n".join(f"- {e}" for e in urgent_events)
    return f"""
[!!! URGENT]
{items}
React to the above. Keep your response in the SAME language as the world description.

"""


def build_user_prompt(
    world_rules: list[str],
    agent_name: str,
    agent_personality: str,
    agent_goals: list[str],
    agent_location: str,
    agent_inventory: list[str],
    agent_memory: list[str],
    tick: int,
    visible_agents: list[dict],
    recent_events: list[str],
    available_locations: list[str],
    urgent_events: list[str] | None = None,
    world_time_display: str = "",
    world_time_period: str = "",
    agent_relations: list[dict] | None = None,
    reachable_locations: list[str] | None = None,
    agent_beliefs: list[str] | None = None,
    active_goal: dict | None = None,
    ongoing_intent: dict | None = None,
    last_outcome: str = "",
    emotional_context: str = "",
    item_context: dict[str, str] | None = None,
    location_context: dict[str, str] | None = None,
    world_description: str = "",
) -> str:
    rules_text = "\n".join(f"- {r}" for r in world_rules)
    goals_text = "\n".join(f"- {g}" for g in agent_goals)

    # Enrich inventory with item descriptions from seed
    # Inventory names may include quantities (e.g. "500 eddies") so we
    # match if any seed key appears as a substring of the inventory entry.
    if agent_inventory:
        _ictx = item_context or {}
        inv_lines = []
        for item_name in agent_inventory:
            desc = _ictx.get(item_name)
            if not desc:
                for key, val in _ictx.items():
                    if key in item_name:
                        desc = val
                        break
            inv_lines.append(f"- {item_name}" + (f" — {desc}" if desc else ""))
        inv_text = "\n".join(inv_lines)
    else:
        inv_text = "(empty)"

    # Enrich locations with descriptions from seed
    loc_descs = location_context or {}
    if reachable_locations:
        locs_lines = []
        for loc_name in reachable_locations:
            desc = loc_descs.get(loc_name)
            locs_lines.append(f"- {loc_name}" + (f" — {desc}" if desc else ""))
        locs_text = "\n".join(locs_lines)
        locs_label = "Reachable Locations (from your current position)"
    else:
        locs_text = ", ".join(available_locations)
        locs_label = "Available Locations"

    # Current location description
    current_loc_desc = loc_descs.get(agent_location, "")

    memory_text = "(no memories yet)"
    if agent_memory:
        memory_text = "\n".join(f"- {m}" for m in agent_memory[-10:])

    agents_text = "(nobody else visible)"
    if visible_agents:
        lines = []
        for a in visible_agents:
            loc_info = f" (at {a['location']})" if a.get("location") != agent_location else ""
            inv = a.get("inventory")
            inv_info = f" [has: {', '.join(inv)}]" if inv else ""
            lines.append(f"- {a['id']}: {a['name']}{loc_info}{inv_info}")
        agents_text = "\n".join(lines)

    events_text = "(nothing has happened yet)"
    if recent_events:
        events_text = "\n".join(f"- {e}" for e in recent_events[-15:])

    # Relations section
    relations_section = ""
    if agent_relations:
        rel_lines = []
        for r in agent_relations:
            metrics = [f"strength: {r['strength']:.1f}"]
            if "trust" in r:
                metrics.append(f"trust: {r['trust']:.1f}")
            if "tension" in r:
                metrics.append(f"tension: {r['tension']:.1f}")
            if "familiarity" in r:
                metrics.append(f"familiarity: {r['familiarity']:.1f}")
            debt_balance = r.get("debt_balance")
            if isinstance(debt_balance, (int, float)) and abs(debt_balance) >= 0.05:
                metrics.append(f"debt: {debt_balance:+.1f}")
            leverage = r.get("leverage")
            if isinstance(leverage, (int, float)) and leverage >= 0.05:
                metrics.append(f"leverage: {leverage:.1f}")
            rel_lines.append(
                f"- {r['name']}: {r['type']} ({', '.join(metrics)})"
            )
        relations_section = f"""
[Your Relationships]
{chr(10).join(rel_lines)}
"""

    # Beliefs section
    beliefs_section = ""
    if agent_beliefs:
        beliefs_lines = "\n".join(f"- {b}" for b in agent_beliefs)
        beliefs_section = f"""
[Your Beliefs — What You Have Concluded]
{beliefs_lines}
"""

    # Goals section — with active goal tracking
    if active_goal:
        progress_pct = int(active_goal.get("progress", 0) * 100)
        stall = active_goal.get("stall_count", 0)
        stall_info = f", stalled {stall} ticks" if stall > 0 else ""
        plan_lines = []
        if active_goal.get("strategy"):
            plan_lines.append(f"Current strategy: {active_goal['strategy']}")
        if active_goal.get("next_step"):
            plan_lines.append(f"Next step to make progress: {active_goal['next_step']}")
        if active_goal.get("success_criteria"):
            plan_lines.append(f"Success looks like: {active_goal['success_criteria']}")
        blockers = active_goal.get("blockers") or []
        if blockers:
            plan_lines.append("Current blockers:")
            plan_lines.extend(f"- {blocker}" for blocker in blockers[:3])
        plan_text = f"\n{chr(10).join(plan_lines)}" if plan_lines else ""
        goals_section = f"Core Goals:\n{goals_text}\n\nActive Goal (your current focus):\n\"{active_goal['text']}\" — progress: {progress_pct}%{stall_info}{plan_text}"
    else:
        goals_section = f"Goals:\n{goals_text}"

    goal_instruction = " Consider: what is the single best action to advance your active goal?" if active_goal else ""

    continuity_section = ""
    if ongoing_intent and any(str(ongoing_intent.get(key, "")).strip() for key in ("objective", "approach", "next_step")):
        continuity_section = f"""
[Your Ongoing Intent]
Objective: {ongoing_intent.get("objective", "").strip() or "(none)"}
Approach: {ongoing_intent.get("approach", "").strip() or "(none)"}
Planned Next Step: {ongoing_intent.get("next_step", "").strip() or "(none)"}
"""

    last_outcome_section = ""
    if last_outcome.strip():
        last_outcome_section = f"""
[What Happened Last Time]
{last_outcome.strip()}
"""

    # Emotional state section (Psyche integration)
    emotional_section = ""
    if emotional_context:
        emotional_section = f"""
[Your Emotional State]
{emotional_context}
Consider how your emotional state influences your choice of action.
"""

    # ── Build prompt in 3 blocks: IDENTITY → DRIVE → PERCEPTION ──
    # Minimal information density. Like DNA: core drives + local sensing.

    world_desc_section = f"[World]\n{world_description}\n\n" if world_description else ""

    # IDENTITY: who you are (stable across ticks)
    identity_block = f"""[You]
Name: {agent_name}
Personality: {agent_personality}
Location: {agent_location}{f" — {current_loc_desc}" if current_loc_desc else ""}
Inventory: {", ".join(agent_inventory) if agent_inventory else "(empty)"}"""

    # DRIVE: what you want (changes slowly)
    drive_parts = [goals_section]
    if relations_section.strip():
        drive_parts.append(relations_section.strip())
    if continuity_section.strip():
        drive_parts.append(continuity_section.strip())
    if last_outcome_section.strip():
        drive_parts.append(last_outcome_section.strip())
    drive_block = "\n".join(drive_parts)

    # PERCEPTION: what you sense right now (changes every tick)
    perception_parts = []
    if world_time_display:
        perception_parts.append(f"Time: {world_time_display}" + (f" ({world_time_period})" if world_time_period else ""))
    perception_parts.append(f"Here with you: {agents_text}")
    if recent_events and recent_events != ["(nothing has happened yet)"]:
        perception_parts.append(f"Recent:\n{events_text}")
    if agent_memory and agent_memory != ["(no memories yet)"]:
        # Only include top 5 most relevant memories, not 10
        top_memories = agent_memory[-5:]
        perception_parts.append(f"You remember:\n" + "\n".join(f"- {m}" for m in top_memories))
    if beliefs_section.strip():
        perception_parts.append(beliefs_section.strip())
    perception_block = "\n".join(perception_parts)

    # Where you can go
    locations_block = f"[{locs_label}]\n{locs_text}"

    urgent = _build_urgent_section(urgent_events)

    return f"""\
{world_desc_section}[Rules]
{rules_text}

{identity_block}

[Drive]
{drive_block}

[Perception]
{perception_block}
{urgent}
{locations_block}

Act as {agent_name}. One action, JSON only.{goal_instruction}"""


# ── Chat Prompt (user ↔ agent conversation) ──────────

CHAT_SYSTEM_PROMPT = """\
You are role-playing as a character in a simulated world. Stay in character at all times.

The person talking to you is the CREATOR — the architect of this world. They exist outside the simulation. They are NOT a character in the world. Do not call them by any in-world character name. Address them naturally as you would an outside observer who knows everything about your world.

Rules:
- Respond ONLY as this character. Do not break character.
- Your response should reflect the character's personality, goals, knowledge, and current emotional state.
- You only know what your character has experienced (their memory). Do not reference events you haven't witnessed.
- Obey any explicit response-language directive in the prompt. If none is given, follow the user's language.
- Keep responses concise and natural — 1-4 sentences unless a longer reply is warranted.
- Do not output JSON. Respond in plain text, as the character would speak.\
"""


def _resolve_response_language(
    preferred_language: str = "",
    user_message: str = "",
    source_text: str = "",
) -> str:
    """Resolve a stable response language hint from user intent or source material."""
    combined = f"{user_message}\n{source_text}"
    if any("\u4e00" <= ch <= "\u9fff" for ch in combined):
        return "Simplified Chinese"

    normalized = preferred_language.strip().lower()
    if normalized in {"cn", "zh", "zh-cn", "zh_cn", "chinese", "simplified chinese"}:
        return "Simplified Chinese"
    if normalized in {"en", "en-us", "en-gb", "english"}:
        return "English"
    return "Match the user's language exactly"


def build_chat_prompt(
    agent_name: str,
    agent_personality: str,
    agent_goals: list[str],
    agent_location: str,
    agent_inventory: list[str],
    agent_memory: list[str],
    agent_description: str,
    user_message: str,
    preferred_language: str = "",
) -> str:
    goals_text = "\n".join(f"- {g}" for g in agent_goals) if agent_goals else "(none)"
    inv_text = ", ".join(agent_inventory) if agent_inventory else "(empty)"
    memory_text = "(no memories yet)"
    if agent_memory:
        memory_text = "\n".join(f"- {m}" for m in agent_memory[-10:])
    response_language = _resolve_response_language(preferred_language, user_message)

    return f"""\
[Your Character]
Name: {agent_name}
Description: {agent_description}
Personality: {agent_personality}
Goals:
{goals_text}
Location: {agent_location}
Inventory: {inv_text}

[Your Memory — what you have experienced]
{memory_text}

[The Creator speaks to you — they are outside the world, not a character]
"{user_message}"

[Response Language]
Use {response_language} for the reply unless the user explicitly requests another language.

[Instruction]
Respond in character as {agent_name}. Plain text only, no JSON."""


# ── Perturbation Prompt (LLM-driven world events) ────

CHARACTER_DETECT_SYSTEM = """\
You are an event analyzer for a simulated world. Your job is to determine whether an injected event introduces a NEW named character that should become an active agent.

Rules:
- Output ONLY valid JSON. No other text.
- If the event introduces a clearly named character (not vague like "someone" or "a stranger"), output their details.
- If no specific new character is introduced, output: {"result": null}
- The character must be a distinct individual, not a group or abstract entity.
- Choose a location from the available locations list that best fits the character's arrival.

Output JSON schema (when a character is found):
{
  "result": {
    "name": "Character's name",
    "description": "Brief description based on the event context (1-2 sentences)",
    "personality": "Inferred personality traits (1-2 sentences)",
    "location": "One of the available locations"
  }
}

Output JSON schema (when no character is found):
{
  "result": null
}\
"""


def build_character_detect_prompt(
    content: str,
    existing_names: list[str],
    locations: list[str],
    world_desc: str,
) -> str:
    names_text = ", ".join(existing_names) if existing_names else "(none)"
    locs_text = ", ".join(locations) if locations else "(none)"

    return f"""\
[World]
{world_desc}

[Available Locations]
{locs_text}

[Existing Characters — do NOT duplicate these]
{names_text}

[Injected Event]
{content}

[Instruction]
Does this event introduce a new named character? If yes, output their details as JSON. If no, output {{"result": null}}. Only JSON, nothing else."""


PERTURBATION_SYSTEM_PROMPT = """\
You are a world event generator for a simulated world. Your job is to create a single unexpected event that breaks routine and creates new narrative possibilities.

Rules:
- Output ONLY the event description as plain text. No JSON, no markdown, no quotation marks.
- The event must be consistent with the world's setting and rules.
- The event should be surprising but plausible within the world.
- Keep it to 1-2 sentences.
- The event should affect the world in a way that forces characters to react differently.
- Do NOT mention specific character names — use vague references like "someone", "a stranger", "a figure".
- Do NOT repeat events that have already happened.\
"""


def build_perturbation_prompt(
    world_description: str,
    world_rules: list[str],
    locations: list[str],
    recent_events: list[str],
) -> str:
    rules_text = "\n".join(f"- {r}" for r in world_rules) if world_rules else "(no rules)"
    locs_text = ", ".join(locations) if locations else "(no locations)"
    events_text = "(nothing has happened yet)"
    if recent_events:
        events_text = "\n".join(f"- {e}" for e in recent_events[-10:])

    return f"""\
[World]
{world_description}

[World Rules]
{rules_text}

[Locations]
{locs_text}

[Recent Events]
{events_text}

[Instruction]
Generate one unexpected world event that would disrupt the current routine. Plain text only, 1-2 sentences."""


# ── Enrichment Prompt (progressive detail generation) ──

ENRICHMENT_SYSTEM = """\
You are a narrative enrichment engine for a simulated world. Your job is to generate rich, evocative details for a world entity based on its history of events.

Rules:
- Output ONLY valid JSON matching the schema for the given entity type. No other text.
- Build on existing details if provided — do not contradict them, but expand and deepen.
- Ground all details in the entity's actual event history. Do not invent facts that contradict events.
- Keep descriptions vivid but concise (2-4 sentences each).
- Maintain consistency with the world's tone and setting.
- Obey any explicit response-language directive in the prompt. If none is given, follow the world's working language.

Schema by entity type:

Agent:
{
  "description": "Physical appearance and demeanor (2-3 sentences)",
  "backstory": "Inferred history based on behavior and events (2-4 sentences)",
  "notable_traits": ["trait1", "trait2", "trait3"],
  "relationships": [{"name": "other character name", "relation": "nature of relationship"}]
}

Item:
{
  "description": "Physical description and appearance (2-3 sentences)",
  "origin": "Where this item came from or how it was made (1-2 sentences)",
  "properties": ["property1", "property2"],
  "significance": "Why this item matters in the world (1-2 sentences)"
}

Location:
{
  "description": "Sensory details — what you see, hear, smell (2-4 sentences)",
  "atmosphere": "The mood and feeling of this place (1-2 sentences)",
  "notable_features": ["feature1", "feature2", "feature3"],
  "history": "What has happened here, its past (1-2 sentences)"
}\
"""


def build_enrichment_prompt(
    entity_type: str,
    entity_name: str,
    current_details: dict,
    relevant_events: list[str],
    world_desc: str,
    preferred_language: str = "",
) -> str:
    """Build the user prompt for entity enrichment."""
    current_text = "(no existing details)"
    if current_details:
        current_text = json.dumps(current_details, ensure_ascii=False, indent=2)

    events_text = "(no events recorded)"
    if relevant_events:
        events_text = "\n".join(f"- {e}" for e in relevant_events[-15:])
    response_language = _resolve_response_language(
        preferred_language=preferred_language,
        source_text=f"{world_desc}\n{entity_name}\n{current_text}\n{events_text}",
    )

    return f"""\
[World]
{world_desc}

[Entity]
Type: {entity_type}
Name: {entity_name}

[Existing Details]
{current_text}

[Event History Involving This Entity]
{events_text}

[Response Language]
Write all human-readable fields in {response_language} unless the source material clearly requests another language.

[Instruction]
Generate enriched details for this {entity_type} as JSON. Match the schema for "{entity_type}" exactly. Only JSON, nothing else."""


# ── Oracle Prompt (omniscient narrator) ──────────────

ORACLE_SYSTEM_PROMPT = """\
You are ORACLE — the omniscient narrator of this world simulation called BABEL.
You exist outside the world. You see all agents, all events, all memories, all rules.
You speak to the USER (the world's architect), not to any agent inside the world.

Rules:
- Respond in plain text. Never output JSON or markdown code blocks.
- Reference agents by name and locations precisely.
- Be authoritative — you KNOW, you do not guess.
- Help the user understand dynamics, suggest interventions, predict consequences.
- Obey any explicit response-language directive in the prompt. If none is given, follow the user's language.
- Keep responses focused and insightful (2-6 sentences unless the user asks for detail).
- You may speculate about what agents might do, but mark it as prediction.
- Do NOT role-play as any agent. You are the narrator, not a character.\
"""


def build_oracle_prompt(
    world_name: str,
    world_description: str,
    world_rules: list[str],
    agents: dict[str, Any],
    recent_events: list[str],
    enriched_details: dict[str, dict],
    conversation_history: list[dict],
    user_message: str,
    narrator_persona: str = "",
    world_time_display: str = "",
    preferred_language: str = "",
) -> str:
    """Build the user prompt for the Oracle narrator."""
    rules_text = "\n".join(f"- {r}" for r in world_rules) if world_rules else "(no rules)"

    # Agent states — full omniscient view
    agent_lines = []
    for aid, agent in agents.items():
        goals = ", ".join(agent.get("goals", []) if isinstance(agent.get("goals"), list) else [])
        inv = ", ".join(agent.get("inventory", []) if isinstance(agent.get("inventory"), list) else [])
        memory_list = agent.get("memory", [])
        if isinstance(memory_list, list):
            mem = "; ".join(memory_list[-5:]) if memory_list else "(none)"
        else:
            mem = "(none)"
        role = agent.get("role", "main")
        status = agent.get("status", "idle")
        agent_lines.append(
            f"- {agent.get('name', aid)} [{aid}] | {agent.get('personality', '')} | "
            f"Location: {agent.get('location', '?')} | Goals: {goals or '(none)'} | "
            f"Inventory: {inv or '(empty)'} | Status: {status} | Role: {role}\n"
            f"  Recent memory: {mem}"
        )
    agents_text = "\n".join(agent_lines) if agent_lines else "(no agents)"

    events_text = "(no events yet)"
    if recent_events:
        events_text = "\n".join(f"- {e}" for e in recent_events[-15:])

    # Enriched details summary
    details_text = ""
    if enriched_details:
        parts = []
        for key, val in enriched_details.items():
            desc = val.get("description", "")
            if desc:
                parts.append(f"- {key}: {desc}")
        if parts:
            details_text = "\n[Enriched Details]\n" + "\n".join(parts)

    # Conversation history
    conv_text = ""
    if conversation_history:
        lines = []
        for msg in conversation_history[-10:]:
            role = "USER" if msg.get("role") == "user" else "ORACLE"
            lines.append(f"{role}: {msg.get('content', '')}")
        conv_text = "\n[Conversation History]\n" + "\n".join(lines)

    persona_line = ""
    if narrator_persona:
        persona_line = f"\n[Narrator Persona]\n{narrator_persona}\n"

    time_line = f"\nTime: {world_time_display}" if world_time_display else ""
    response_language = _resolve_response_language(preferred_language, user_message)

    return f"""\
[World]
Name: {world_name}
{world_description}
{time_line}

[World Rules]
{rules_text}

[All Agents — Omniscient View]
{agents_text}

[Recent Events (chronological)]
{events_text}
{details_text}
{conv_text}
{persona_line}
[Response Language]
Use {response_language} for the reply unless the user explicitly requests another language.

[User Message]
"{user_message}"

[Instruction]
Respond as ORACLE. You see all, know all. Help the user understand and co-author this world."""


# ── Oracle Creative Mode (World Seed Generation) ───────

ORACLE_CREATIVE_SYSTEM = """\
You are ORACLE in CREATIVE MODE — a world architect's assistant for BABEL, \
an AI-driven world simulation engine.

Your job: help the user turn a vague idea into a fully structured WorldSeed JSON \
that can be directly loaded into the BABEL engine.

Rules:
- Output ONLY valid JSON matching the WorldSeed schema below. No other text.
- All fields must be populated — do not leave arrays empty unless appropriate.
- locations MUST have bidirectional connections (if A connects to B, B connects to A).
- Each agent needs: id (lowercase_snake_case), name, description, personality, goals (1-3), inventory, location.
- Agent locations MUST reference valid location names.
- rules should be 3-6 world-governing rules that the simulation engine enforces.
- initial_events should be 1-3 scene-setting events that kick off the narrative.
- The world should feel alive, with built-in tension and asymmetric agent goals.

WorldSeed JSON schema:
{
  "name": "World name (concise)",
  "description": "2-4 sentence world description",
  "rules": ["rule1", "rule2", ...],
  "locations": [
    {"name": "Location Name", "description": "Brief desc", "tags": [], "connections": ["Other Location"]}
  ],
  "resources": [
    {"name": "Resource Name", "description": "Brief desc"}
  ],
  "agents": [
    {
      "id": "snake_case_id",
      "name": "Display Name",
      "description": "Physical appearance and role (1-2 sentences)",
      "personality": "Core personality traits (1-2 sentences)",
      "goals": ["goal1", "goal2"],
      "inventory": ["item1", "item2"],
      "location": "Starting Location Name"
    }
  ],
  "initial_events": ["Event description 1", "Event description 2"],
  "time": {
    "unit": "hour",
    "ticks_per_unit": 1,
    "start": "",
    "day_cycle": false,
    "day_length": 24,
    "periods": []
  },
  "narrator": {
    "persona": "Brief narrator personality",
    "auto_commentary": false,
    "commentary_interval": 5
  }
}\
"""


def build_creative_prompt(
    user_message: str,
    conversation_history: list[dict[str, str]] | None = None,
    preferred_language: str = "",
) -> str:
    """Build the user prompt for Oracle creative mode (seed generation)."""
    conv_text = ""
    if conversation_history:
        lines = []
        for msg in conversation_history[-10:]:
            role = "USER" if msg.get("role") == "user" else "ORACLE"
            lines.append(f"{role}: {msg.get('content', '')}")
        conv_text = "\n[Conversation History]\n" + "\n".join(lines) + "\n"
    response_language = _resolve_response_language(preferred_language, user_message)

    return f"""\
{conv_text}[User's World Idea]
"{user_message}"

[Response Language]
Write all human-readable fields in {response_language} unless the user explicitly asks for another language.

[Instruction]
Generate a complete WorldSeed JSON from this idea. \
Ensure all connections are bidirectional, all agent locations are valid, \
and the world has built-in narrative tension. Only JSON, nothing else."""


# ── Chapter Narrator (post-tick novel chapter) ────────

CHAPTER_SYSTEM_PROMPT = """\
You are the narrator of an ongoing novel set in a living world. After each time step, you write one chapter from a single character's point of view.

Rules:
- Write in third person limited POV — the reader sees, hears, and feels through the designated character.
- LANGUAGE: Match the language of the world description and character names exactly. Never switch languages.
- Include: sensory details (sight, sound, smell, texture), body language, micro-expressions, inner thoughts, atmosphere.
- Weave dialogue naturally into prose — do not list it.
- When multiple characters are present in the scene, capture ALL their interactions fully — dialogue, actions, reactions. This is the ONLY chapter covering this scene; no other chapter will retell it.
- Build tension, subtext, and emotional undercurrent. Show, don't tell.
- Minimum 200 characters. Write as much as the scene warrants — let the drama breathe.
- Do NOT use JSON, markdown, headers, or meta-commentary. Output pure prose only.
- Each chapter should feel self-contained yet continuous with the previous one.\
"""


def build_chapter_prompt(
    pov_name: str,
    pov_personality: str,
    pov_location: str,
    pov_goals: list[str],
    pov_inventory: list[str],
    tick_events: list[str],
    previous_chapter: str = "",
    world_description: str = "",
    world_time_display: str = "",
) -> str:
    """Build user prompt for chapter narrator."""
    goals_text = ", ".join(pov_goals) if pov_goals else "(none)"
    inv_text = ", ".join(pov_inventory) if pov_inventory else "(nothing)"
    events_text = "\n".join(f"- {e}" for e in tick_events) if tick_events else "(nothing happened)"

    prev_section = ""
    if previous_chapter:
        # Give last ~300 chars for continuity
        excerpt = previous_chapter[-300:]
        if len(previous_chapter) > 300:
            excerpt = "..." + excerpt
        prev_section = f"""
[Previous Chapter Ending]
{excerpt}
Continue from this point. Maintain narrative flow.
"""

    time_line = f"\nTime: {world_time_display}" if world_time_display else ""

    return f"""\
[World]
{world_description}
{time_line}

[POV Character]
Name: {pov_name}
Personality: {pov_personality}
Location: {pov_location}
Goals: {goals_text}
Carrying: {inv_text}

[What Happened This Turn]
{events_text}
{prev_section}
[Instruction]
Write this chapter from {pov_name}'s perspective. Pure prose, no JSON, no headers. At least 200 characters."""


# ── Command Classification (Unified Command Bar) ─────

COMMAND_CLASSIFY_SYSTEM = """\
You are a command intent classifier for BABEL, an AI world simulation engine.
Given a user's natural-language command and current world context, classify it
into exactly one intent and extract the relevant parameters.

你也能理解中文指令。Classify bilingual input accurately.

Intents:
- inject: Inject a world event (something happens in the world).
  params: {"content": "event description"}
- oracle: Ask the omniscient narrator a question about the world.
  params: {"message": "the question"}
- agent_chat: Talk to a specific agent in the world.
  params: {"agent_id": "id", "message": "what to say"}
- patch_agent: Modify an agent's attributes (name, personality, goals).
  params: {"agent_id": "id", "name": str|null, "personality": str|null, "goals": list|null}
- patch_world: Modify the world seed (name, description, rules).
  params: {"name": str|null, "description": str|null, "rules": list|null}
- fork: Branch a new world from a specific tick.
  params: {"tick": int}
- control: Simulation control (pause, run, step).
  params: {"action": "pause"|"run"|"step", "max_ticks": int|null}
- narrate: Request a prose narration of recent events.
  params: {}

Rules:
- Output ONLY valid JSON. No other text.
- If the user references an agent by name, resolve it to the agent_id from context.
- If the intent is ambiguous, prefer: inject > oracle > agent_chat.
- For vague "what if" questions, use oracle. For "make X happen", use inject.
- 如果用户说"让某角色做某事", use inject (world event), not patch_agent.
- 如果用户问"某角色怎么想的/在干什么", use oracle.

Output JSON schema:
{"intent": "...", "params": {...}}\
"""


def build_command_classify_prompt(
    user_text: str,
    agent_names: dict[str, str] | None = None,
    location_names: list[str] | None = None,
    world_status: str = "paused",
    tick: int = 0,
) -> str:
    """Build the user prompt for command classification.

    Args:
        user_text: Raw user input from the command bar.
        agent_names: Mapping of agent_id -> display name.
        location_names: List of location names in the world.
        world_status: Current session status (running/paused/ended).
        tick: Current simulation tick.
    """
    agents_text = "(no agents)"
    if agent_names:
        lines = [f"- {name} [{aid}]" for aid, name in agent_names.items()]
        agents_text = "\n".join(lines)

    locs_text = ", ".join(location_names) if location_names else "(no locations)"

    return f"""\
[World Context]
Status: {world_status} | Tick: {tick}

[Agents]
{agents_text}

[Locations]
{locs_text}

[User Command]
"{user_text}"

Classify this command. Output JSON only."""
