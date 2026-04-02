from unittest.mock import AsyncMock, patch

import pytest

from babel.llm import generate_seed_draft


@pytest.mark.asyncio
async def test_generate_seed_draft_normalizes_common_provider_drift():
    raw_seed = {
        "name": "Aurora Bazaar",
        "description": "A floating market above a frozen sea.",
        "lore": "Trust is traded like currency\nNo one owns the sky lanes",
        "locations": [
            {
                "name": "Sky Dock",
                "description": "Ships tether here.",
                "tags": "trade, transit",
                "connections": "Ice Market",
            },
            {
                "name": "Ice Market",
                "description": "A maze of glowing stalls.",
                "tags": [],
                "connections": ["Sky Dock"],
            },
        ],
        "resources": [],
        "agents": [
            {
                "id": "harbor_singer",
                "name": "Harbor Singer",
                "description": "A broker with a perfect memory.",
                "personality": "Soft-spoken and precise.",
                "goals": "Keep the peace\nProtect the sky routes",
                "inventory": "ledger, flare",
                "location": "Sky Dock",
            }
        ],
        "initial_events": "A warning bell rings across the harbor",
        "time": {
            "unit": "hour",
            "ticks_per_unit": 1,
            "start": "",
            "day_cycle": True,
            "day_length": 24,
            "periods": ["Dawn", "Day", "Dusk", "Night"],
        },
        "narrator": {
            "persona": "Measured and observant.",
            "auto_commentary": False,
            "commentary_interval": 5,
        },
    }

    with patch("babel.llm._complete_json", new=AsyncMock(return_value=raw_seed)):
        seed = await generate_seed_draft("A market in the sky.")

    assert seed["lore"] == ["Trust is traded like currency", "No one owns the sky lanes"]
    assert seed["locations"][0]["tags"] == ["trade", "transit"]
    assert seed["locations"][0]["connections"] == ["Ice Market"]
    assert seed["agents"][0]["goals"] == ["Keep the peace", "Protect the sky routes"]
    assert seed["agents"][0]["inventory"] == ["ledger", "flare"]
    assert seed["time"]["periods"][0] == {"name": "dawn", "start": 5, "end": 8}
    assert seed["time"]["periods"][-1] == {"name": "night", "start": 21, "end": 5}
