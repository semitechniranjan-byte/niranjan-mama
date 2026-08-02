"""Tracks in-flight calls so many can run at once.

Each live call gets its own CallHandler, registered here by session_id. The telephony
provider's media-stream websocket carries the session id back to us (Exotel echoes it in
`custom_parameters`), so an incoming stream can be routed to the handler that owns it.

Concurrency is bounded per agent: an agent is a named worker pool with a maximum number
of simultaneous calls, so a 20k-row datasheet is dialled in controlled waves instead of
one call at a time (or all at once).
"""

import asyncio
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# session_id -> CallHandler for every call currently in progress.
_active_calls: Dict[str, object] = {}
_lock = asyncio.Lock()

# agent_id -> semaphore capping that agent's simultaneous calls.
_agent_semaphores: Dict[str, asyncio.Semaphore] = {}
_agent_capacity: Dict[str, int] = {}

DEFAULT_AGENT_CAPACITY = 100


async def register_call(session_id: str, handler: object) -> None:
    if not session_id:
        return
    async with _lock:
        _active_calls[session_id] = handler


async def unregister_call(session_id: str) -> None:
    if not session_id:
        return
    async with _lock:
        _active_calls.pop(session_id, None)


def get_call(session_id: str) -> Optional[object]:
    return _active_calls.get(session_id)


def active_session_ids() -> list[str]:
    return list(_active_calls.keys())


def active_count() -> int:
    return len(_active_calls)


def only_active_call() -> Optional[object]:
    """The single in-flight call, when there is exactly one.

    Fallback for a provider that connects its media stream without telling us which
    session it belongs to; unambiguous only while one call is running.
    """
    if len(_active_calls) == 1:
        return next(iter(_active_calls.values()))
    return None


def get_agent_semaphore(agent_id: str, capacity: int) -> asyncio.Semaphore:
    """Semaphore capping one agent's concurrent calls, rebuilt if capacity changed."""
    capacity = max(1, int(capacity or DEFAULT_AGENT_CAPACITY))
    if _agent_capacity.get(agent_id) != capacity or agent_id not in _agent_semaphores:
        _agent_semaphores[agent_id] = asyncio.Semaphore(capacity)
        _agent_capacity[agent_id] = capacity
        logger.info("Agent %s concurrency set to %s", agent_id, capacity)
    return _agent_semaphores[agent_id]


def agent_capacity(agent_id: str) -> int:
    return _agent_capacity.get(agent_id, DEFAULT_AGENT_CAPACITY)


def agent_active_count(agent_id: str) -> int:
    """Calls this agent currently has in flight (capacity minus free slots)."""
    semaphore = _agent_semaphores.get(agent_id)
    if semaphore is None:
        return 0
    return max(0, _agent_capacity.get(agent_id, DEFAULT_AGENT_CAPACITY) - semaphore._value)
