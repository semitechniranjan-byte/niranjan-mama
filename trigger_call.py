from typing import Any, Optional
import httpx
from datetime import datetime
import pytz

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings


async def get_cached_templates_doc(db_service: Any, logger: Any) -> Optional[dict]:
    logger.debug("Fetching templates_doc from MongoDB")
    return await db_service.templates.find_one({"name": "app-template"})


async def get_cached_datasheets_templates_doc(db_service: Any, logger: Any) -> Optional[dict]:
    logger.debug("Fetching datasheets templates doc from MongoDB")
    return await db_service.templates.find_one({"name": "datasheets-template"})


async def get_cached_room_doc(db_service: Any, logger: Any, room_name: str) -> Optional[dict]:
    logger.debug("Fetching room_doc from MongoDB")
    return await db_service.agent_rooms.find_one({"room_name": room_name})


async def get_cached_agent_doc(db_service: Any, logger: Any, agent_name: str, room_name: str) -> Optional[dict]:
    logger.debug("Fetching agent_doc from MongoDB")
    return await db_service.agents.find_one({"name": agent_name, "room_name": room_name})


async def prepare_and_initiate_call_for_agent(
    db_service: Any,
    logger: Any,
    agent_name: str,
    agent_url: str,
    room_doc: Optional[dict] = None,
):
    try:
        templates_doc = await get_cached_templates_doc(db_service, logger)
        if not templates_doc:
            return {"status": "error", "message": "Template 'app-template' not found in database."}
        room_name = getattr(settings, "ROOM_NAME", "default-room")
        if room_doc is None:
            room_doc = await get_cached_room_doc(db_service, logger, room_name)
        if not room_doc:
            return {"status": "error", "message": f"Room {room_name} not found"}
        from_number = room_doc.get("from_number") or templates_doc.get("from_number")
        if not from_number:
            return {"status": "error", "message": f"Room {room_name} from_number not found"}
        agent_doc = await get_cached_agent_doc(db_service, logger, agent_name, room_name)
        if not agent_doc:
            return {"status": "error", "message": f"Agent {agent_name} not found"}
    except Exception as exc:
        logger.error("Database error while fetching data for agent %s: %s", agent_name, exc)
        return {"status": "error", "message": f"Database error: {exc}"}

    runqueuecall_data = await db_service.get_next_queue_call_data()
    if not runqueuecall_data:
        return {"status": "error", "message": "No queue call data available"}

    execution_data = runqueuecall_data.get("execution", {})
    runqueuecall = runqueuecall_data.get("runqueuecall", {})
    payload = {
        "from_number": from_number,
        "to_number": runqueuecall.get("phone_number", ""),
        "system_prompt": "",
        "format_values": runqueuecall.get("format_values", {}),
        "execution_id": execution_data.get("_id"),
        "user_info": runqueuecall,
        "selected": runqueuecall.get("selected", "default"),
    }

    ist = pytz.timezone("Asia/Kolkata")
    payload["format_values"]["current_date"] = datetime.now(ist).strftime("%Y-%m-%d")
    response = await call_make_call_api(agent_url, payload)
    if response.get("status") == "success":
        return {"status": "success", "message": "Call initiated", "session_id": response.get("session_id")}
    return {"status": "error", "message": response.get("message", "Failed to initiate call")}


async def call_make_call_api(api_url: str, call_request_data: dict, timeout: float = 15.0) -> dict:
    headers = {"Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(api_url, json=call_request_data, headers=headers)
        response.raise_for_status()
        return response.json()
