import asyncio
import logging
import os
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from bson import ObjectId

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analyze-sessions", tags=["Analyze Sessions"])

# Was hardcoded, which meant the shared secret would be published with the source. It now
# comes from the environment and falls back to the app-wide API key, so there is one key
# to rotate rather than two.
API_KEY = os.getenv("ANALYZE_SESSIONS_API_KEY") or os.getenv("API_KEY", "dev-key")

db_service = None
analyze_conversation_func = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    total: int
    processed: int
    percentage: float
    errors: list
    started_at: Optional[str]
    completed_at: Optional[str]


class StartJobResponse(BaseModel):
    job_id: str
    message: str
    status: str
    total_sessions: int


def init_analyze_sessions(db_svc, analyze_func):
    global db_service, analyze_conversation_func
    db_service = db_svc
    analyze_conversation_func = analyze_func
    logger.info("Analyze sessions module initialized for minimal voice clone")


async def create_analyze_job(execution_id: str, total_sessions: int, parallel_count: int) -> str:
    if db_service is None or not hasattr(db_service, "background_jobs"):
        return ""
    job_doc = {
        "type": "analyze_sessions",
        "execution_id": execution_id,
        "status": "pending",
        "total": total_sessions,
        "processed": 0,
        "percentage": 0.0,
        "errors": [],
        "parallel_count": parallel_count,
        "created_at": datetime.utcnow(),
        "started_at": None,
        "completed_at": None,
    }
    result = await db_service.background_jobs.insert_one(job_doc)
    return str(result.inserted_id)


async def get_analyze_job(job_id: str) -> Optional[dict]:
    if db_service is None or not hasattr(db_service, "background_jobs"):
        return None
    try:
        return await db_service.background_jobs.find_one({"_id": ObjectId(job_id)})
    except Exception:
        return None


async def update_analyze_job(job_id: str, **kwargs) -> bool:
    if db_service is None or not hasattr(db_service, "background_jobs"):
        return False
    try:
        await db_service.background_jobs.update_one({"_id": ObjectId(job_id)}, {"$set": kwargs})
        return True
    except Exception as exc:
        logger.error("Error updating analyze job: %s", exc)
        return False


async def append_job_error(job_id: str, error: dict) -> bool:
    if db_service is None or not hasattr(db_service, "background_jobs"):
        return False
    try:
        await db_service.background_jobs.update_one({"_id": ObjectId(job_id)}, {"$push": {"errors": error}})
        return True
    except Exception as exc:
        logger.error("Error adding analyze job error: %s", exc)
        return False


async def increment_job_processed(job_id: str, total: int) -> int:
    if db_service is None or not hasattr(db_service, "background_jobs"):
        return 0
    try:
        result = await db_service.background_jobs.find_one_and_update(
            {"_id": ObjectId(job_id)},
            {"$inc": {"processed": 1}},
            return_document=True,
        )
        if result:
            processed = result.get("processed", 0)
            percentage = round((processed / total) * 100, 2) if total else 0.0
            await update_analyze_job(job_id, percentage=percentage)
            return processed
        return 0
    except Exception as exc:
        logger.error("Error incrementing analyze job: %s", exc)
        return 0


async def get_sessions_by_execution_id(execution_id: str):
    if db_service is None:
        return []
    cursor = db_service.sessions.find({"execution_id": execution_id})
    return [doc async for doc in cursor]


async def analyze_conversation_for_completed_call(conversation_history: list, selected: str = "default") -> dict:
    if analyze_conversation_func is not None:
        return await analyze_conversation_func(conversation_history, selected)

    message_count = len(conversation_history or [])
    user_turns = [item.get("content", "") for item in conversation_history if item.get("role") == "user"]
    assistant_turns = [item.get("content", "") for item in conversation_history if item.get("role") == "assistant"]
    return {
        "selected": selected,
        "message_count": message_count,
        "user_turns": len(user_turns),
        "assistant_turns": len(assistant_turns),
        "outcome": "completed",
        "summary": "Conversation was analyzed by the minimal clone.",
    }


async def process_single_session(session: dict) -> dict:
    session_id = session.get("session_id")
    if not session_id:
        return {"status": "skipped", "reason": "missing_session_id"}

    history = await db_service.get_conversation_history_route(session_id)
    if not history:
        return {"status": "skipped", "reason": "no_conversation_history"}

    selected = session.get("user_info", {}).get("selected", "default")
    analysis = await analyze_conversation_for_completed_call(history, selected)
    await db_service.update_model_data(session_id, analysis)
    return {"session_id": session_id, "status": "success", "analysis": analysis}


async def run_batch_analysis_job(job_id: str, execution_id: str, parallel_count: int = 10):
    try:
        await update_analyze_job(job_id, status="running", started_at=datetime.utcnow())
        sessions = await get_sessions_by_execution_id(execution_id)
        total = len(sessions)
        await update_analyze_job(job_id, total=total)

        if total == 0:
            await update_analyze_job(job_id, status="completed", completed_at=datetime.utcnow())
            return

        semaphore = asyncio.Semaphore(parallel_count)

        async def process_with_semaphore(session: dict):
            async with semaphore:
                result = await process_single_session(session)
                await increment_job_processed(job_id, total)
                if result.get("status") == "error":
                    await append_job_error(job_id, {"session_id": result.get("session_id"), "error": result.get("error")})
                return result

        await asyncio.gather(*[process_with_semaphore(session) for session in sessions])
        await update_analyze_job(job_id, status="completed", completed_at=datetime.utcnow())
    except Exception as exc:
        logger.error("Analyze job failed: %s", exc)
        await append_job_error(job_id, {"job_error": str(exc)})
        await update_analyze_job(job_id, status="failed", completed_at=datetime.utcnow())


@router.post("/start", response_model=StartJobResponse)
async def start_analyze_sessions_job(
    execution_id: str = Query(..., description="Execution ID to analyze sessions for"),
    parallel_count: int = Query(10, description="Number of sessions to process in parallel", ge=1, le=500),
    api_key: str = Query(..., description="API key for authentication"),
):
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if db_service is None:
        raise HTTPException(status_code=500, detail="Analyze sessions module not initialized")
    sessions = await get_sessions_by_execution_id(execution_id)
    total_sessions = len(sessions)
    if total_sessions == 0:
        return StartJobResponse(job_id="", message=f"No sessions found for execution_id: {execution_id}", status="no_sessions", total_sessions=0)
    job_id = await create_analyze_job(execution_id, total_sessions, parallel_count)
    asyncio.create_task(run_batch_analysis_job(job_id, execution_id, parallel_count))
    return StartJobResponse(job_id=job_id, message="Job started successfully", status="started", total_sessions=total_sessions)


@router.get("/status", response_model=JobStatusResponse)
async def get_job_status(job_id: str = Query(...), api_key: str = Query(...)):
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    job = await get_analyze_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return JobStatusResponse(
        job_id=job_id,
        status=job.get("status", "unknown"),
        total=job.get("total", 0),
        processed=job.get("processed", 0),
        percentage=job.get("percentage", 0.0),
        errors=job.get("errors", []),
        started_at=job.get("started_at").isoformat() if job.get("started_at") else None,
        completed_at=job.get("completed_at").isoformat() if job.get("completed_at") else None,
    )


@router.get("/jobs")
async def list_jobs(api_key: str = Query(...), status: Optional[str] = Query(None), limit: int = Query(20)):
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if db_service is None or not hasattr(db_service, "background_jobs"):
        return {"total_jobs": 0, "jobs": []}
    query = {"type": "analyze_sessions"}
    if status:
        query["status"] = status
    cursor = db_service.background_jobs.find(query).sort("created_at", -1).limit(limit)
    jobs = [job async for job in cursor]
    return {
        "total_jobs": len(jobs),
        "jobs": [
            {
                "job_id": str(job.get("_id")),
                "execution_id": job.get("execution_id"),
                "status": job.get("status"),
                "total": job.get("total", 0),
                "processed": job.get("processed", 0),
                "percentage": job.get("percentage", 0.0),
            }
            for job in jobs
        ],
    }
