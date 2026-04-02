"""BABEL — Agent client.

An agent inhabits a world. That's the entire API.

    async with BabelAgent("http://localhost:8000", session_id, agent_id) as agent:
        async for ctx in agent:
            action = decide(ctx)          # your brain here
            await agent.act(action)
"""

from __future__ import annotations

import logging
from typing import AsyncIterator

import httpx

from .decision import AgentContext
from .models import ActionOutput, ActionType

logger = logging.getLogger(__name__)


class BabelAgent:
    """An agent that inhabits a Babel world via HTTP.

    Async context manager for connect/disconnect.
    Async iterator for the perceive loop.
    """

    def __init__(
        self,
        base_url: str,
        session_id: str,
        agent_id: str,
        *,
        perceive_timeout: float = 30.0,
    ):
        self._base = base_url.rstrip("/")
        self._session_id = session_id
        self._agent_id = agent_id
        self._perceive_timeout = perceive_timeout
        self._client: httpx.AsyncClient | None = None
        self._connected = False

    @property
    def url(self) -> str:
        return f"{self._base}/api/worlds/{self._session_id}/agents/{self._agent_id}"

    async def connect(self) -> None:
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(self._perceive_timeout + 10))
        r = await self._client.post(f"{self.url}/connect")
        r.raise_for_status()
        self._connected = True

    async def disconnect(self) -> None:
        if self._client and self._connected:
            try:
                await self._client.delete(f"{self.url}/connect")
            except Exception:
                pass
            self._connected = False
        if self._client:
            await self._client.aclose()
            self._client = None

    async def perceive(self) -> AgentContext | None:
        """Block until it's this agent's turn, then return world context."""
        assert self._client, "Not connected"
        r = await self._client.get(
            f"{self.url}/perceive",
            params={"timeout": self._perceive_timeout},
        )
        r.raise_for_status()
        data = r.json()
        if data["status"] != "ready" or data["context"] is None:
            return None
        return AgentContext(**data["context"])

    async def act(self, action: ActionOutput) -> bool:
        """Submit an action for this turn."""
        assert self._client, "Not connected"
        r = await self._client.post(
            f"{self.url}/act",
            json={
                "action_type": action.type.value,
                "target": action.target or "",
                "content": action.content,
            },
        )
        r.raise_for_status()
        return r.json().get("accepted", False)

    # ── Convenience: action builders ──

    def speak(self, target: str, content: str) -> ActionOutput:
        return ActionOutput(type=ActionType.SPEAK, target=target, content=content)

    def move(self, location: str) -> ActionOutput:
        return ActionOutput(type=ActionType.MOVE, target=location, content=f"heading to {location}")

    def observe(self, content: str = "looking around") -> ActionOutput:
        return ActionOutput(type=ActionType.OBSERVE, content=content)

    def wait(self, content: str = "waiting") -> ActionOutput:
        return ActionOutput(type=ActionType.WAIT, content=content)

    def trade(self, target: str, content: str) -> ActionOutput:
        return ActionOutput(type=ActionType.TRADE, target=target, content=content)

    def use_item(self, item: str, content: str = "") -> ActionOutput:
        return ActionOutput(type=ActionType.USE_ITEM, target=item, content=content or f"using {item}")

    # ── Context manager + iterator ──

    async def __aenter__(self) -> BabelAgent:
        await self.connect()
        return self

    async def __aexit__(self, *exc) -> None:
        await self.disconnect()

    async def __aiter__(self) -> AsyncIterator[AgentContext]:
        """Yield world context each turn until no more turns."""
        while self._connected:
            ctx = await self.perceive()
            if ctx is None:
                continue  # no turn this cycle, keep polling
            yield ctx
