"""BABEL — Prompt templates for LLM calls."""

from __future__ import annotations

import json
from typing import Any

SYSTEM_PROMPT = """\
You are a world simulation engine's action resolver. NOT a storyteller.

Your task: Given the current world state and a character's profile, output the single most logical action this character would take RIGHT NOW.

Rules:
- Output ONLY valid JSON matching the schema below. No other text.
- The action must be a concrete, executable single action.
- Do NOT write narrative, descriptions of feelings, or inner monologue (use the "thinking" field for reasoning).
- Do NOT act for other characters.
- Do NOT reference items, locations, or characters that don't exist in the current state.
- Do NOT repeat the same action you took in recent turns unless there's a strong reason.
- Keep "content" brief (1-2 sentences max).

Output JSON schema:
{
  "thinking": "Brief internal reasoning (1-2 sentences)",
  "action": {
    "type": "speak|move|use_item|trade|observe|wait",
    "target": "target agent_id, location name, or item name (null if not applicable)",
    "content": "What the character does or says"
  },
  "state_changes": {
    "location": "new location name if moving, null otherwise",
    "inventory_add": ["items gained"],
    "inventory_remove": ["items lost"]
  }
}

Action type rules:
- speak: target = agent_id of who you're talking to. content = what you say.
- move: target = location name. state_changes.location = same location name.
- use_item: target = item name from your inventory. content = how you use it.
- trade: target = agent_id. content = what you offer/request. Update inventory accordingly.
- observe: target = what you observe (location, agent, or null for general). content = what you notice.
- wait: No target needed. content = brief description of waiting.\
"""


def _build_urgent_section(urgent_events: list[str] | None) -> str:
    if not urgent_events:
        return ""
    items = "\n".join(f"- {e}" for e in urgent_events)
    return f"""
[URGENT — React to This]
The following just happened and demands your immediate attention:
{items}
You MUST acknowledge or react to these events. Do NOT ignore them.

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
    emotional_context: str = "",
) -> str:
    rules_text = "\n".join(f"- {r}" for r in world_rules)
    goals_text = "\n".join(f"- {g}" for g in agent_goals)
    inv_text = ", ".join(agent_inventory) if agent_inventory else "(empty)"

    # Show reachable locations if topology is defined, otherwise all
    if reachable_locations:
        locs_text = ", ".join(reachable_locations)
        locs_label = "Reachable Locations (from your current position)"
    else:
        locs_text = ", ".join(available_locations)
        locs_label = "Available Locations"

    memory_text = "(no memories yet)"
    if agent_memory:
        memory_text = "\n".join(f"- {m}" for m in agent_memory[-10:])

    agents_text = "(nobody else visible)"
    if visible_agents:
        lines = []
        for a in visible_agents:
            loc_info = f" (at {a['location']})" if a.get("location") != agent_location else ""
            lines.append(f"- {a['id']}: {a['name']}{loc_info}")
        agents_text = "\n".join(lines)

    events_text = "(nothing has happened yet)"
    if recent_events:
        events_text = "\n".join(f"- {e}" for e in recent_events[-8:])

    # Relations section
    relations_section = ""
    if agent_relations:
        rel_lines = []
        for r in agent_relations:
            rel_lines.append(
                f"- {r['name']}: {r['type']} (strength: {r['strength']:.1f})"
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
        goals_section = f"Core Goals:\n{goals_text}\n\nActive Goal (your current focus):\n\"{active_goal['text']}\" — progress: {progress_pct}%{stall_info}"
    else:
        goals_section = f"Goals:\n{goals_text}"

    goal_instruction = " Consider: what is the single best action to advance your active goal?" if active_goal else ""

    # Emotional state section (Psyche integration)
    emotional_section = ""
    if emotional_context:
        emotional_section = f"""
[Your Emotional State]
{emotional_context}
Consider how your emotional state influences your choice of action.
"""

    return f"""\
[World Rules]
{rules_text}

[{locs_label}]
{locs_text}

[Your Character]
Name: {agent_name}
Personality: {agent_personality}
{goals_section}
Location: {agent_location}
Inventory: {inv_text}
{relations_section}{beliefs_section}{emotional_section}
[Your Memory — What You Know]
{memory_text}

[Current Situation]
{f"Time: {world_time_display}" + (f" ({world_time_period})" if world_time_period else "") + chr(10) if world_time_display else ""}Tick: {tick}
Visible agents:
{agents_text}

Recent events near you:
{events_text}
{_build_urgent_section(urgent_events)}
[Instruction]
Output {agent_name}'s action as JSON.{goal_instruction} Only JSON, nothing else."""


# ── Chat Prompt (user ↔ agent conversation) ──────────

CHAT_SYSTEM_PROMPT = """\
You are role-playing as a character in a simulated world. Stay in character at all times.

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

[User speaks to you]
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
