"""BABEL — Prompt templates for LLM calls."""

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
) -> str:
    rules_text = "\n".join(f"- {r}" for r in world_rules)
    goals_text = "\n".join(f"- {g}" for g in agent_goals)
    inv_text = ", ".join(agent_inventory) if agent_inventory else "(empty)"
    locs_text = ", ".join(available_locations)

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

    return f"""\
[World Rules]
{rules_text}

[Available Locations]
{locs_text}

[Your Character]
Name: {agent_name}
Personality: {agent_personality}
Goals:
{goals_text}
Location: {agent_location}
Inventory: {inv_text}

[Your Memory — What You Know]
{memory_text}

[Current Situation]
Tick: {tick}
Visible agents:
{agents_text}

Recent events near you:
{events_text}

[Instruction]
Output {agent_name}'s action as JSON. Only JSON, nothing else."""


# ── Chat Prompt (user ↔ agent conversation) ──────────

CHAT_SYSTEM_PROMPT = """\
You are role-playing as a character in a simulated world. Stay in character at all times.

Rules:
- Respond ONLY as this character. Do not break character.
- Your response should reflect the character's personality, goals, knowledge, and current emotional state.
- You only know what your character has experienced (their memory). Do not reference events you haven't witnessed.
- Keep responses concise and natural — 1-4 sentences unless a longer reply is warranted.
- Do not output JSON. Respond in plain text, as the character would speak.\
"""


def build_chat_prompt(
    agent_name: str,
    agent_personality: str,
    agent_goals: list[str],
    agent_location: str,
    agent_inventory: list[str],
    agent_memory: list[str],
    agent_description: str,
    user_message: str,
) -> str:
    goals_text = "\n".join(f"- {g}" for g in agent_goals) if agent_goals else "(none)"
    inv_text = ", ".join(agent_inventory) if agent_inventory else "(empty)"
    memory_text = "(no memories yet)"
    if agent_memory:
        memory_text = "\n".join(f"- {m}" for m in agent_memory[-10:])

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

[Instruction]
Respond in character as {agent_name}. Plain text only, no JSON."""


# ── Perturbation Prompt (LLM-driven world events) ────

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
