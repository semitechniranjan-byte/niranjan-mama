import asyncio
import logging
import os
import time
import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("cron_processor")

# Read from the environment rather than being baked into the source, so publishing this
# repository does not publish the key. Must match analyze_sessions.API_KEY.
API_KEY = os.getenv("ANALYZE_SESSIONS_API_KEY") or os.getenv("API_KEY", "dev-key")
_move_temp_to_main_lock = asyncio.Lock()
_move_temp_to_main_running = False
_datasheet_update_running = False


async def get_next_queue_call_data_watch_cron():
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("http://localhost:5000/process-next-agent-queue-call", params={"api_key": API_KEY, "cron_job": "true"}, timeout=15)
            response.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("Cron queue call watch failed: %s", exc)
        return False


async def get_next_execution_data_watch_cron():
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("http://localhost:5000/get-next-execution-data", params={"api_key": API_KEY}, timeout=15)
            response.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("Cron execution watch failed: %s", exc)
        return False


async def move_temp_to_main_cron(db_service):
    global _move_temp_to_main_running
    if _move_temp_to_main_running:
        return False
    _move_temp_to_main_running = True
    try:
        if hasattr(db_service, "move_completed_sessions_to_main"):
            return await db_service.move_completed_sessions_to_main()
        return True
    finally:
        _move_temp_to_main_running = False


async def datasheet_update_cron(db_service):
    global _datasheet_update_running
    if _datasheet_update_running:
        return False
    _datasheet_update_running = True
    try:
        if hasattr(db_service, "process_datasheet_updates_for_execution"):
            queuecall = await db_service.get_analyzing_queuecall_for_datasheet_update()
            if not queuecall:
                return True
            execution_id = queuecall.get("execution_id")
            if execution_id:
                return await db_service.process_datasheet_updates_for_execution(execution_id=execution_id)
        return True
    finally:
        _datasheet_update_running = False
