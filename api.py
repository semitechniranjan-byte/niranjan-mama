import asyncio
import base64
import hashlib
import json
import logging
import os
import csv
import io as _io
import re
from datetime import datetime, timedelta
import secrets
import traceback
from fastapi import Depends, FastAPI, Header, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

try:
    from .analyze_sessions import router as analyze_sessions_router, init_analyze_sessions
    from .call_handler import CallHandler, LLM_HEDGE_AFTER_SECONDS
    from .config import settings
    from .datasheet_service import parse_datasheet_file, validate_columns
    from .campaign_service import run_campaign
    from .template_service import SUPPORTED_LANGUAGES, resolve_template_config, apply_format_value_transforms
    from .providers import describe_providers
    from . import call_registry
except ImportError:  # pragma: no cover
    from analyze_sessions import router as analyze_sessions_router, init_analyze_sessions
    from call_handler import CallHandler, LLM_HEDGE_AFTER_SECONDS
    from config import settings
    from datasheet_service import parse_datasheet_file, validate_columns
    from campaign_service import run_campaign
    from template_service import SUPPORTED_LANGUAGES, resolve_template_config, apply_format_value_transforms
    from providers import describe_providers
    import call_registry

app = FastAPI(title="Minimal Voice Clone API")
# When the built frontend is served by this same app the origin matches and CORS is moot,
# but a separately hosted UI (or a local dev server pointed at the deployed API) needs its
# origin listed. ALLOWED_ORIGINS is a comma-separated list, e.g.
# "https://voicebot.onrender.com,https://app.vercel.app".
_extra_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_extra_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(analyze_sessions_router)
handler = CallHandler()


# ---------------------------------------------------------------------------
# Accounts and roles
#
# Two fixed sign-ins: an admin who sees everything, and an operator who only needs the
# day-to-day screens. Credentials come from the environment so they can be rotated on the
# host without a code change; the defaults exist only so a fresh checkout runs.
#
# Each role gets a DIFFERENT token. Without that the backend could not tell the two apart
# and hiding menu items would be decoration — anyone could call an admin endpoint directly.
# ---------------------------------------------------------------------------
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "qsilonadmin@gmail.com")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "@qsilonadmin@2026")
USER_EMAIL = os.getenv("USER_EMAIL", "qsilonuser@gmail.com")
USER_PASSWORD = os.getenv("USER_PASSWORD", "@qsilon@2026")

# The admin token is the existing API key, so nothing that already uses it breaks. The
# operator token is derived from it, which means rotating API_KEY rotates both at once.
ADMIN_TOKEN = settings.API_KEY
USER_TOKEN = hashlib.sha256(f"{settings.API_KEY}:operator".encode()).hexdigest()[:32]

# Which screens each role may open. The frontend renders its menu from this, so the two
# can never drift apart.
ROLE_PAGES = {
    "admin": [
        "/", "/campaigns", "/sessions", "/calls", "/agents",
        "/analytics", "/reports", "/templates", "/datasheets", "/settings",
    ],
    # Conversations is where transcripts and outcomes live, which is the whole point of
    # the product for a collections operator. Config, prompts and agents stay admin-only.
    "user": [
        "/", "/campaigns", "/sessions", "/calls",
        "/datasheets", "/reports", "/analytics",
    ],
}


def _role_for_token(token: Optional[str]) -> Optional[str]:
    if token and secrets.compare_digest(token, ADMIN_TOKEN):
        return "admin"
    if token and secrets.compare_digest(token, USER_TOKEN):
        return "user"
    return None


def require_api_key(x_api_key: Optional[str] = Header(None)) -> str:
    """Any signed-in role. Returns the role so callers can vary behaviour if needed."""
    role = _role_for_token(x_api_key)
    if role is None:
        raise HTTPException(status_code=401, detail="invalid or missing API key")
    return role


def require_admin(x_api_key: Optional[str] = Header(None)) -> str:
    """Admin only - configuration, prompts, agents and logs."""
    role = _role_for_token(x_api_key)
    if role != "admin":
        raise HTTPException(status_code=403, detail="admin access required")
    return role


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/auth/login")
async def auth_login(payload: LoginRequest) -> dict:
    email = (payload.email or "").strip().lower()
    password = payload.password or ""

    if email == ADMIN_EMAIL.lower() and secrets.compare_digest(password, ADMIN_PASSWORD):
        role, token = "admin", ADMIN_TOKEN
    elif email == USER_EMAIL.lower() and secrets.compare_digest(password, USER_PASSWORD):
        role, token = "user", USER_TOKEN
    else:
        # Same message either way, so the response cannot be used to discover valid emails.
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return {"token": token, "role": role, "email": email, "pages": ROLE_PAGES[role]}


@app.get("/auth/me")
async def auth_me(x_api_key: Optional[str] = Header(None)) -> dict:
    """Role and allowed pages for the key presented.

    The console stored its page list once, at sign-in, so a page added to the product
    later stayed invisible until the operator happened to sign out and back in - Reports
    shipped, was live on the server, and nobody could find it. Reading this on load means
    a new page appears by itself on the next visit.
    """
    token = (x_api_key or "").strip()
    if token and secrets.compare_digest(token, ADMIN_TOKEN):
        role, email = "admin", ADMIN_EMAIL
    elif token and secrets.compare_digest(token, USER_TOKEN):
        role, email = "user", USER_EMAIL
    else:
        raise HTTPException(status_code=401, detail="Not signed in")
    return {"role": role, "email": email, "pages": ROLE_PAGES[role]}


async def _initialize_analysis_support() -> None:
    init_analyze_sessions(handler.db, handler.db.get_conversation_history_route)


def _log_configuration_report() -> None:
    """Print, once at boot, exactly which credentials arrived.

    Without this a missing variable only shows up later as a confusing runtime error
    ("Connection refused" against localhost), which hides the real cause: the host never
    received the configuration at all.
    """
    checks = {
        "MONGO_URI": bool(settings.MONGO_URI) and "localhost" not in settings.MONGO_URI,
        "DEEPGRAM_API_KEY": bool(settings.DEEPGRAM_API_KEY),
        "GEMINI_API_KEY": bool(settings.GEMINI_API_KEY),
        "CARTESIA_API_KEY": bool(settings.CARTESIA_API_KEY),
        "CARTESIA_VOICE_ID": bool(settings.CARTESIA_VOICE_ID),
        "VOBIZ_AUTH_ID": bool(settings.VOBIZ_AUTH_ID),
        "VOBIZ_AUTH_TOKEN": bool(settings.VOBIZ_AUTH_TOKEN),
        "VOBIZ_PHONE_NUMBER": bool(settings.VOBIZ_PHONE_NUMBER),
    }
    missing = [name for name, ok in checks.items() if not ok]
    present = [name for name, ok in checks.items() if ok]
    logger.warning("CONFIG: %s/%s set -> %s", len(present), len(checks), ", ".join(present) or "none")
    if missing:
        logger.warning(
            "CONFIG: MISSING -> %s | set these as environment variables on the host "
            "(Render: Environment tab, not Secret Files), or upload the .env to "
            "/etc/secrets/.env",
            ", ".join(missing),
        )
    else:
        logger.warning("CONFIG: all required credentials present")
    # Which models actually loaded, so a secret file that did not take effect is visible
    # at boot rather than being inferred from a backup line in the middle of a call.
    logger.warning(
        "CONFIG: llm primary=%s backup=%s/%s hedge=%.1fs",
        settings.GEMINI_MODEL or "-",
        settings.LLM_BACKUP_PROVIDER or "-",
        settings.LLM_BACKUP_MODEL or "(provider default)",
        LLM_HEDGE_AFTER_SECONDS,
    )


@app.on_event("startup")
async def startup() -> None:
    _log_configuration_report()
    await handler.initialize(persist_session=False)
    await _initialize_analysis_support()


class OutboundCallRequest(BaseModel):
    to_number: str
    from_number: Optional[str] = None
    system_prompt: Optional[str] = None
    format_values: Optional[Dict[str, Any]] = None
    dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None
    greeting_text: Optional[str] = None
    # Resolve the script server-side from the template, exactly like a campaign row does,
    # so a test call exercises the same path as production instead of a hand-typed prompt.
    use_case: Optional[str] = None
    language: Optional[str] = None
    template_id: Optional[str] = None


class CallRequest(BaseModel):
    from_number: str
    to_number: str
    system_prompt: Optional[str] = None
    format_values: Optional[Dict[str, Any]] = None
    dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None
    greeting_text: Optional[str] = None
    provider: Optional[str] = "twilio"
    stt_service: Optional[str] = "deepgram"
    tts_service: Optional[str] = "cartesia"
    llm_service: Optional[str] = "groq"
    stt_lan_code: Optional[str] = "en-US"
    tts_lan_code: Optional[str] = "en"
    tts_model_id: Optional[str] = "sonic-3"
    tts_voice_id: Optional[str] = ""
    language: Optional[str] = "en"


class VoiceRequest(BaseModel):
    session_id: str
    user_text: str
    system_prompt: Optional[str] = None
    format_values: Optional[Dict[str, Any]] = None
    dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None


class PromptConfigRequest(BaseModel):
    system_prompt: Optional[str] = None
    format_values: Optional[Dict[str, Any]] = None
    dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None


class QueueCallRequest(BaseModel):
    to_number: str
    from_number: Optional[str] = None
    system_prompt: Optional[str] = None
    format_values: Optional[Dict[str, Any]] = None
    dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None
    greeting_text: Optional[str] = None


class MultiVoiceConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    voices: Optional[Dict[str, Any]] = None
    dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None
    session_id: Optional[str] = None


class DynamicVariantConfig(BaseModel):
    active: bool = False
    column: Optional[str] = None
    mapping: Optional[Dict[str, str]] = None


class TemplateRequest(BaseModel):
    name: str
    from_number: Optional[str] = None
    phone_column: Optional[str] = None
    input_fields: Optional[list[str]] = None
    format_values: Optional[Dict[str, Any]] = None
    dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None
    prompts: Optional[Dict[str, str]] = None
    analysis_prompts: Optional[Dict[str, str]] = None
    greetings: Optional[Dict[str, str]] = None
    stt_lan_codes: Optional[Dict[str, str]] = None
    tts_lan_codes: Optional[Dict[str, str]] = None
    tts_model_ids: Optional[Dict[str, str]] = None
    tts_voice_ids: Optional[Dict[str, str]] = None
    format_values_mapping_methods: Optional[Dict[str, Dict[str, str]]] = None
    dynamic: Optional[DynamicVariantConfig] = None
    telephony_provider: Optional[str] = None
    # use_cases: {use_case_key: {label, languages: {lang_key: LanguageConfig}}}
    use_cases: Optional[Dict[str, Dict[str, Any]]] = None
    default_use_case: Optional[str] = None
    default_language: Optional[str] = None
    language_column: Optional[str] = None
    language_column_mapping: Optional[Dict[str, str]] = None


class TemplateUpdateRequest(BaseModel):
    name: Optional[str] = None
    from_number: Optional[str] = None
    phone_column: Optional[str] = None
    input_fields: Optional[list[str]] = None
    format_values: Optional[Dict[str, Any]] = None
    dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None
    prompts: Optional[Dict[str, str]] = None
    analysis_prompts: Optional[Dict[str, str]] = None
    greetings: Optional[Dict[str, str]] = None
    stt_lan_codes: Optional[Dict[str, str]] = None
    tts_lan_codes: Optional[Dict[str, str]] = None
    tts_model_ids: Optional[Dict[str, str]] = None
    tts_voice_ids: Optional[Dict[str, str]] = None
    format_values_mapping_methods: Optional[Dict[str, Dict[str, str]]] = None
    dynamic: Optional[DynamicVariantConfig] = None
    telephony_provider: Optional[str] = None
    # use_cases: {use_case_key: {label, languages: {lang_key: LanguageConfig}}}
    use_cases: Optional[Dict[str, Dict[str, Any]]] = None
    default_use_case: Optional[str] = None
    default_language: Optional[str] = None
    language_column: Optional[str] = None
    language_column_mapping: Optional[Dict[str, str]] = None


class DatasheetTemplateRequest(BaseModel):
    name: str
    required_columns: list[str] = []
    required_columns_mapping: Dict[str, str] = {}
    update_columns_mapping: Dict[str, str] = {}
    attempt_columns: Optional[list[str]] = None


class DatasheetTemplateUpdateRequest(BaseModel):
    name: Optional[str] = None
    required_columns: Optional[list[str]] = None
    required_columns_mapping: Optional[Dict[str, str]] = None
    update_columns_mapping: Optional[Dict[str, str]] = None
    attempt_columns: Optional[list[str]] = None


class DatasheetRenameRequest(BaseModel):
    name: str


class DispositionItem(BaseModel):
    value: str
    color: str
    label: str


class DispositionsUpdateRequest(BaseModel):
    data: list[DispositionItem]


class MappingKeysUpdateRequest(BaseModel):
    categories: dict[str, list[str]]


class AgentRequest(BaseModel):
    """A named worker pool: how many calls it runs at once and how long each may last."""

    name: str
    description: Optional[str] = None
    max_concurrent_calls: int = 100
    max_call_seconds: int = 180
    status: str = "active"


class AgentUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    max_concurrent_calls: Optional[int] = None
    max_call_seconds: Optional[int] = None
    status: Optional[str] = None


class AppSettingsRequest(BaseModel):
    """Global runtime settings, previously scattered across each prompt template."""

    telephony_provider: Optional[str] = None
    from_number: Optional[str] = None
    stt_provider: Optional[str] = None
    stt_model: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    tts_provider: Optional[str] = None
    tts_model_id: Optional[str] = None
    tts_voice_id: Optional[str] = None
    default_language: Optional[str] = None
    silence_first_seconds: Optional[int] = None
    silence_second_seconds: Optional[int] = None
    max_call_seconds: Optional[int] = None


class CampaignRequest(BaseModel):
    name: str
    mode: str = "test"
    datasheet_id: str
    prompt_template_id: str
    template_variant: str = "default"  # legacy flat variant; kept for older clients
    use_case: Optional[str] = None
    # A language key runs the whole campaign in that language; "auto" resolves each
    # row from the template's language column.
    language: Optional[str] = None
    agent_id: Optional[str] = None
    # Several agents can work one campaign so a large datasheet uses all capacity.
    agent_ids: Optional[list[str]] = None


class TranscribeRequest(BaseModel):
    audio_base64: str


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "mongo_ready": handler.db.ready,
        "tts_ready": handler.tts.ready,
        "stt_ready": handler.stt.ready,
        "llm_ready": handler.llm.ready,
    }


@app.post("/calls/outbound", dependencies=[Depends(require_api_key)])
async def create_outbound_call(payload: OutboundCallRequest) -> dict:
    """Place one call.

    Given a use case + language, the prompt/greeting/voice are resolved from the template
    the same way a campaign row is, so a test call is a faithful rehearsal of production.
    """
    app_settings = await handler.db.get_app_settings()
    provider = app_settings.get("telephony_provider") or "twilio"
    from_number = payload.from_number or app_settings.get("from_number") or None

    system_prompt = payload.system_prompt
    greeting_text = payload.greeting_text
    format_values = dict(payload.format_values or {})
    dynamic_fields = payload.dynamic_fields
    resolved: Dict[str, Any] = {}

    if payload.use_case or payload.language:
        templates = await handler.db.list_templates()
        template = None
        if payload.template_id:
            template = await handler.db.get_template(payload.template_id)
        if not template:
            template = templates[0] if templates else None
        if not template:
            raise HTTPException(status_code=400, detail="no prompt template configured")

        resolved = resolve_template_config(
            template, format_values, language=payload.language, use_case=payload.use_case
        )
        system_prompt = system_prompt or resolved["system_prompt"]
        greeting_text = greeting_text or resolved["greeting_text"]
        dynamic_fields = dynamic_fields or template.get("dynamic_fields") or {}
        format_values = apply_format_value_transforms(template, format_values)
        from_number = from_number or template.get("from_number") or None
        if not system_prompt:
            raise HTTPException(
                status_code=400,
                detail=f"'{resolved['language']}' has no prompt configured for use case "
                f"'{resolved['use_case']}'. Add one under Templates first.",
            )

    # A dedicated handler keeps this call's audio/session state off the shared instance,
    # so a test call can run while campaigns are dialling.
    call = CallHandler(db=handler.db)
    call.llm.set_provider(app_settings.get("llm_provider"))
    call.llm.set_model(app_settings.get("llm_model"))
    if resolved:
        call.tts.set_voice(resolved["tts_voice_id"], resolved["tts_model_id"], resolved["tts_language"])
        call.stt.set_language(resolved["stt_language"])
        # Without this a test call finished with no disposition at all: the scoring prompt
        # lives on the template and was only ever read by the campaign runner.
        call.analysis_prompt = resolved.get("analysis_prompt") or None

    result = await call.handle_outbound_call(
        payload.to_number,
        from_number,
        system_prompt=system_prompt,
        format_values=format_values,
        dynamic_fields=dynamic_fields,
        greeting_text=greeting_text,
        provider=provider,
    )
    session_id = result.get("session_id")
    if session_id:
        await call_registry.register_call(session_id, call)
        await handler.db.mark_session_state(
            session_id,
            "active",
            source="test_call",
            use_case=resolved.get("use_case"),
            language=resolved.get("language"),
        )
    return {
        **result,
        "use_case": resolved.get("use_case"),
        "language": resolved.get("language"),
        "provider": provider,
    }


@app.post("/calls/queue", dependencies=[Depends(require_api_key)])
async def create_queue_call(payload: QueueCallRequest) -> dict:
    queue_id = await handler.db.enqueue_call(
        {
            "to_number": payload.to_number,
            "from_number": payload.from_number,
            "system_prompt": payload.system_prompt,
            "format_values": payload.format_values or {},
            "dynamic_fields": payload.dynamic_fields or {},
            "greeting_text": payload.greeting_text,
        }
    )
    return {
        "queue_id": queue_id,
        "status": "queued",
        "to_number": payload.to_number,
        "message": "Call queued in MongoDB and will be processed by the next queue worker request.",
    }


@app.get("/calls/queue")
async def list_queue_calls(limit: int = 50) -> dict:
    return {"queue": await handler.db.list_queue_calls(limit)}


@app.post("/calls/queue/process", dependencies=[Depends(require_api_key)])
async def process_next_queue_call() -> dict:
    queue_item = await handler.db.claim_next_queue_call()
    if not queue_item:
        raise HTTPException(status_code=404, detail="no queued calls found")
    payload = queue_item.get("payload", {}) or {}
    result = await handler.handle_outbound_call(
        payload.get("to_number", ""),
        payload.get("from_number"),
        system_prompt=payload.get("system_prompt"),
        format_values=payload.get("format_values"),
        dynamic_fields=payload.get("dynamic_fields"),
        greeting_text=payload.get("greeting_text"),
    )
    result["queue_id"] = str(queue_item.get("_id"))
    return result


@app.post("/call", dependencies=[Depends(require_api_key)])
async def create_call(payload: CallRequest) -> dict:
    return await handler.handle_outbound_call(
        payload.to_number,
        payload.from_number,
        system_prompt=payload.system_prompt,
        format_values=payload.format_values,
        dynamic_fields=payload.dynamic_fields,
        greeting_text=payload.greeting_text,
    )


@app.get("/sessions")
async def list_sessions(
    limit: int = 50,
    skip: int = 0,
    status: Optional[str] = None,
    direction: Optional[str] = None,
    search: Optional[str] = None,
) -> dict:
    """One page of sessions, newest first.

    This used to stream every session in the collection to the browser, which is fine at
    a hundred calls and fatal at a hundred thousand: the whole result set is built in
    memory, serialised, and then rendered as one row per document. Filtering happens in
    the query rather than in the client so a search does not depend on having downloaded
    everything first.
    """
    query: Dict[str, Any] = {}
    if status and status != "all":
        query["status"] = status
    if direction and direction != "all":
        query["direction"] = direction
    if search:
        # Anchored so the index can be used; a leading-wildcard scan defeats the point.
        safe = re.escape(search.strip())
        query["$or"] = [
            {"phone_number": {"$regex": safe}},
            {"session_id": {"$regex": safe}},
        ]

    limit = max(1, min(limit, 200))
    total = await handler.db.sessions.count_documents(query)
    cursor = handler.db.sessions.find(query).sort("created_at", -1).skip(max(0, skip)).limit(limit)
    sessions = []
    async for doc in cursor:
        doc["_id"] = str(doc.get("_id"))
        sessions.append(doc)
    return {"sessions": sessions, "total": total, "limit": limit, "skip": skip}


@app.get("/sessions/{session_id}")
async def get_session(session_id: str) -> dict:
    session = await handler.db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    session["_id"] = str(session.get("_id"))
    return {"session": session}


@app.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str) -> dict:
    messages = []
    cursor = handler.db.conversations.find({"session_id": session_id}).sort("timestamp", 1)
    async for doc in cursor:
        doc["_id"] = str(doc.get("_id"))
        messages.append(doc)
    return {"session_id": session_id, "messages": messages}


@app.post("/sessions/{session_id}/config", dependencies=[Depends(require_api_key)])
async def update_session_config(session_id: str, payload: PromptConfigRequest) -> dict:
    handler.session_id = session_id
    handler.llm.set_db_service(handler.db, session_id)
    await handler.apply_prompt_config(payload.system_prompt, payload.format_values, payload.dynamic_fields)
    return {
        "session_id": session_id,
        "config": {
            "system_prompt": handler.system_prompt_template,
            "format_values": handler.format_values,
            "dynamic_fields": handler.dynamic_fields,
        },
    }


@app.post("/sessions/{session_id}/message", dependencies=[Depends(require_api_key)])
async def add_session_message(session_id: str, payload: VoiceRequest) -> dict:
    handler.session_id = session_id
    handler.llm.set_db_service(handler.db, session_id)
    await handler.db.add_conversation_message(session_id, "user", payload.user_text)
    response_text = await handler.llm.generate_response(payload.user_text)
    await handler.db.add_conversation_message(session_id, "assistant", response_text)
    return {"session_id": session_id, "response_text": response_text}


@app.post("/sessions/{session_id}/end", dependencies=[Depends(require_api_key)])
async def end_session(session_id: str) -> dict:
    return await handler.finalize_call(session_id, status="completed", reason="ended_by_api")


@app.post("/webhooks/twilio/inbound")
async def inbound_webhook(request: Request) -> PlainTextResponse:
    session_id = request.query_params.get("session_id", "")
    system_prompt = request.query_params.get("system_prompt")
    format_values = request.query_params.get("format_values")
    dynamic_fields = request.query_params.get("dynamic_fields")
    xml = await handler.handle_inbound_webhook(
        session_id,
        system_prompt=system_prompt,
        format_values={}
        if not format_values
        else {k: v for k, v in [item.split("=", 1) for item in format_values.split(",") if "=" in item]},
        dynamic_fields={},
    )
    return PlainTextResponse(content=xml, media_type="application/xml")


@app.post("/webhooks/twilio/status")
async def twilio_status_webhook(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.post("/assistant/voice")
async def assistant_voice(payload: VoiceRequest) -> dict:
    return await handler.process_voice_turn(
        payload.session_id,
        payload.user_text,
        system_prompt=payload.system_prompt,
        format_values=payload.format_values,
        dynamic_fields=payload.dynamic_fields,
    )


@app.post("/stt/transcribe")
async def transcribe_audio(payload: TranscribeRequest) -> dict:
    return await handler.transcribe_audio(payload.audio_base64)


@app.get("/logs", dependencies=[Depends(require_admin)])
async def get_logs() -> PlainTextResponse:
    log_path = os.path.join(os.getcwd(), "fastapi_logs.log")
    if not os.path.exists(log_path):
        return PlainTextResponse("No logs available yet.", media_type="text/plain")
    with open(log_path, "r", encoding="utf-8") as handle:
        lines = handle.readlines()
    return PlainTextResponse("".join(lines[-200:]), media_type="text/plain")


@app.post("/webhook")
async def webhook(request: Request) -> PlainTextResponse:
    try:
        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type:
            data = await request.json()
        else:
            data = dict(await request.form())
    except Exception:
        data = {}

    session_id = request.query_params.get("session_id") or data.get("session_id")
    if not session_id:
        # A genuine telephony webhook always identifies its call. Anything else hitting
        # this URL - and it is a public endpoint, so scanners find it - was creating an
        # "unknown" inbound session, and those junk rows were being scored and counted as
        # real calls on the dashboard.
        call_ref = data.get("CallSid") or data.get("CallUUID") or data.get("call_uuid")
        if not call_ref:
            logger.info("Ignoring /webhook with no session_id and no call id")
            return PlainTextResponse(
                content='<?xml version="1.0" encoding="UTF-8"?><Response/>',
                media_type="application/xml",
            )
        session_doc = await handler.db.create_session("unknown", direction="inbound")
        session_id = session_doc["session_id"]
    await handler.db.mark_session_state(session_id, "active", source="webhook", call_uuid=data.get("CallSid") or data.get("CallUUID") or data.get("call_uuid"))
    xml = handler.telephony_xml.build_stream_response(session_id)
    return PlainTextResponse(content=xml, media_type="application/xml")


@app.post("/hangup-callback")
async def hangup_callback(request: Request) -> JSONResponse:
    try:
        form_data = await request.form()
    except Exception:
        form_data = {}
    session_id = request.query_params.get("session_id") or form_data.get("session_id")
    if session_id:
        call_status = form_data.get("CallStatus") or form_data.get("call_status")
        call_info = {
            "CallStatus": call_status,
            "Duration": form_data.get("CallDuration"),
            "EndTime": form_data.get("Timestamp"),
        }
        await handler.db.mark_session_state(session_id, "ended", hangup_source="callback", call_status=call_status, call_info=call_info)
        await handler.finalize_call(session_id, status="completed", reason="hangup_callback")
    return JSONResponse({"status": "ok", "session_id": session_id})


@app.post("/webhooks/vobiz/answer")
async def vobiz_answer(request: Request) -> PlainTextResponse:
    """Vobiz fetches this when the callee answers; the XML opens the audio stream.

    The create-call response only carried a request_uuid, so this is the first place the
    real CallUUID is available for a later hangup.
    """
    try:
        form_data = dict(await request.form())
    except Exception:
        form_data = {}
    if not form_data:
        try:
            form_data = dict(await request.json())
        except Exception:
            form_data = {}
    session_id = request.query_params.get("session_id") or form_data.get("session_id")
    call_uuid = form_data.get("CallUUID") or form_data.get("call_uuid") or form_data.get("callUUID")
    if session_id:
        call = call_registry.get_call(session_id)
        if call is not None and call_uuid:
            call.call_sid = call_uuid
        # Vobiz waits on this response before it opens the audio stream, and the caller
        # hears silence for the whole round trip. An Atlas write is not worth that delay,
        # so it happens after the XML is on its way.
        asyncio.create_task(
            handler.db.mark_session_state(
                session_id, "active", source="vobiz_answer", call_uuid=call_uuid
            )
        )
    xml = handler.telephony_vobiz.build_stream_response(session_id or "")
    return PlainTextResponse(content=xml, media_type="application/xml")


@app.post("/webhooks/vobiz/hangup")
async def vobiz_hangup(request: Request) -> JSONResponse:
    try:
        form_data = dict(await request.form())
    except Exception:
        form_data = {}
    if not form_data:
        try:
            form_data = dict(await request.json())
        except Exception:
            form_data = {}
    session_id = request.query_params.get("session_id") or form_data.get("session_id")
    if session_id:
        call_status = form_data.get("CallStatus") or form_data.get("Status")
        call_info = {
            "CallStatus": call_status,
            "Duration": form_data.get("Duration") or form_data.get("BillDuration"),
            "EndTime": form_data.get("EndTime"),
            "HangupCause": form_data.get("HangupCauseName") or form_data.get("HangupCause"),
            "RecordingUrl": form_data.get("RecordUrl") or form_data.get("RecordingUrl"),
        }
        await handler.db.mark_session_state(
            session_id, "ended", hangup_source="vobiz_callback",
            call_status=call_status, call_info=call_info,
        )
        await handler.finalize_call(session_id, status="completed", reason="vobiz_hangup_callback")
    return JSONResponse({"status": "ok", "session_id": session_id})


@app.post("/webhooks/plivo/answer")
async def plivo_answer(request: Request) -> PlainTextResponse:
    """Plivo fetches this when the callee picks up; the XML opens the AudioStream.

    This is also the first point at which Plivo tells us the real CallUUID (the create-call
    response only carries a request_uuid), so it is recorded here for later hangup.
    """
    try:
        form_data = dict(await request.form())
    except Exception:
        form_data = {}
    session_id = request.query_params.get("session_id") or form_data.get("session_id")
    call_uuid = form_data.get("CallUUID")
    if session_id:
        call = call_registry.get_call(session_id)
        if call is not None and call_uuid:
            call.call_sid = call_uuid
        await handler.db.mark_session_state(
            session_id, "active", source="plivo_answer", call_uuid=call_uuid
        )
    xml = handler.telephony_plivo.build_stream_response(session_id or "")
    return PlainTextResponse(content=xml, media_type="application/xml")


@app.post("/webhooks/plivo/hangup")
async def plivo_hangup(request: Request) -> JSONResponse:
    try:
        form_data = dict(await request.form())
    except Exception:
        form_data = {}
    session_id = request.query_params.get("session_id") or form_data.get("session_id")
    if session_id:
        call_status = form_data.get("CallStatus") or form_data.get("Status")
        call_info = {
            "CallStatus": call_status,
            "Duration": form_data.get("Duration") or form_data.get("BillDuration"),
            "EndTime": form_data.get("EndTime"),
            "HangupCause": form_data.get("HangupCauseName") or form_data.get("HangupCause"),
            "RecordingUrl": form_data.get("RecordUrl"),
        }
        await handler.db.mark_session_state(
            session_id, "ended", hangup_source="plivo_callback",
            call_status=call_status, call_info=call_info,
        )
        await handler.finalize_call(session_id, status="completed", reason="plivo_hangup_callback")
    return JSONResponse({"status": "ok", "session_id": session_id})


@app.post("/webhooks/exotel/status")
async def exotel_status_callback(request: Request) -> JSONResponse:
    try:
        form_data = dict(await request.form())
    except Exception:
        form_data = {}
    payload = {**dict(request.query_params), **form_data}
    # Exotel's status-callback field names aren't publicly documented; persist the raw
    # payload so the real keys (recording URL, duration, status) can be confirmed
    # instead of guessed. See /debug/exotel-status.
    try:
        with open(EXOTEL_STATUS_DEBUG_PATH, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, default=str)
    except Exception:
        logger.exception("Failed to write Exotel status debug file")
    logger.warning("Exotel status callback payload: %s", payload)

    session_id = request.query_params.get("session_id") or form_data.get("CustomField")
    # A "+" in a query string decodes to a space, so ids like "+9199...-abc" arrive as
    # " 9199...-abc". Recover them, and fall back to the CallSid if that still misses.
    if session_id and session_id.startswith(" "):
        session_id = "+" + session_id[1:]
    if session_id and not await handler.db.get_session(session_id):
        call_sid = _first_present(payload, "CallSid", "Sid", "call_sid")
        if call_sid:
            match = await handler.db.sessions.find_one({"call_info.CallSid": call_sid}) or \
                await handler.db.sessions.find_one({"call_uuid": call_sid})
            if match and match.get("session_id"):
                logger.warning(
                    "Exotel status: session %r not found, matched by CallSid -> %s",
                    session_id, match["session_id"],
                )
                session_id = match["session_id"]
    if session_id:
        call_status = _first_present(payload, "Status", "CallStatus", "DialCallStatus", "status")
        # Exotel has used several names for the recording across products; take the
        # first that is actually present rather than assuming Twilio's "RecordingUrl".
        recording_url = _first_present(
            payload, "RecordingUrl", "RecordingUrI", "recording_url", "Recording", "RecordUrl", "recordingUrl"
        )
        call_info = {
            "CallStatus": call_status,
            "Duration": _first_present(payload, "Duration", "CallDuration", "DialCallDuration", "ConversationDuration"),
            "StartTime": _first_present(payload, "StartTime", "DateCreated"),
            "EndTime": _first_present(payload, "EndTime", "DateUpdated", "EndTimeUtc"),
            "RecordingUrl": recording_url,
        }
        updates = {
            "hangup_source": "exotel_status_callback",
            "call_status": call_status,
            "call_info": call_info,
        }
        if recording_url:
            updates["recording_url"] = recording_url
        await handler.db.mark_session_state(session_id, "ended", **updates)
        await handler.finalize_call(session_id, status="completed", reason="exotel_status_callback")
    return JSONResponse({"status": "ok", "session_id": session_id})


EXOTEL_STATUS_DEBUG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "exotel_status_debug.json"
)


def _first_present(payload: dict, *keys: str):
    for key in keys:
        value = payload.get(key)
        if value not in (None, ""):
            return value
    return None


@app.get("/debug/exotel-status")
async def debug_exotel_status() -> dict:
    if not os.path.exists(EXOTEL_STATUS_DEBUG_PATH):
        return {"status": "no data yet"}
    with open(EXOTEL_STATUS_DEBUG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


@app.post("/stream_callback")
async def stream_callback(request: Request) -> JSONResponse:
    try:
        form_data = await request.form()
    except Exception:
        form_data = {}
    session_id = request.query_params.get("session_id") or form_data.get("session_id")
    if session_id:
        await handler.db.update_session(session_id, stream_id=form_data.get("stream_id") or form_data.get("StreamID"))
    return JSONResponse({"status": "ok", "session_id": session_id})


@app.post("/recording")
async def recording_callback(request: Request) -> JSONResponse:
    try:
        form_data = await request.form()
    except Exception:
        form_data = {}
    session_id = request.query_params.get("session_id") or form_data.get("session_id")
    if session_id:
        await handler.db.update_session(
            session_id,
            recording_url=form_data.get("RecordingUrl") or form_data.get("recording_url") or form_data.get("RecordUrl"),
        )
    return JSONResponse({"status": "ok", "session_id": session_id})


@app.get("/get-next-queue-call-data")
async def get_next_queue_call_data() -> dict:
    return await handler.db.get_next_queue_call_data()


@app.get("/get-next-queue-call-data-watch")
async def get_next_queue_call_data_watch() -> dict:
    queue_item = await handler.db.claim_next_queue_call()
    return {"queued_call": queue_item}


@app.get("/process-next-agent-queue-call")
async def process_next_agent_queue_call(api_key: Optional[str] = None) -> dict:
    if api_key and api_key != "dev-key":
        raise HTTPException(status_code=401, detail="invalid api key")
    return await process_next_queue_call()


@app.post("/config/reload", dependencies=[Depends(require_api_key)])
async def reload_config() -> dict:
    await handler.initialize()
    return {"status": "reloaded", "mongo_ready": handler.db.ready, "llm_ready": handler.llm.ready}


@app.post("/multi-voice-config", dependencies=[Depends(require_api_key)])
async def update_multi_voice_config(payload: MultiVoiceConfigUpdate) -> dict:
    if payload.enabled is not None:
        handler.dynamic_fields = payload.dynamic_fields or handler.dynamic_fields
    if payload.dynamic_fields is not None:
        handler.dynamic_fields = payload.dynamic_fields
    if payload.session_id:
        await handler.db.update_session(payload.session_id, dynamic_fields=handler.dynamic_fields)
    return {"status": "ok", "enabled": payload.enabled, "dynamic_fields": handler.dynamic_fields}


@app.post("/templates", dependencies=[Depends(require_admin)])
async def create_template(payload: TemplateRequest) -> dict:
    template_id = await handler.db.create_template(payload.model_dump(exclude_none=True))
    return {"template_id": template_id}


@app.get("/templates")
async def list_templates() -> dict:
    return {"templates": await handler.db.list_templates()}


@app.get("/templates/{template_id}")
async def get_template(template_id: str) -> dict:
    template = await handler.db.get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="template not found")
    return {"template": template}


@app.put("/templates/{template_id}", dependencies=[Depends(require_admin)])
async def update_template(template_id: str, payload: TemplateUpdateRequest) -> dict:
    updated = await handler.db.update_template(template_id, payload.model_dump(exclude_none=True))
    if not updated:
        raise HTTPException(status_code=404, detail="template not found or not modified")
    template = await handler.db.get_template(template_id)
    return {"template": template}


@app.delete("/templates/{template_id}", dependencies=[Depends(require_admin)])
async def delete_template(template_id: str) -> dict:
    deleted = await handler.db.delete_template(template_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="template not found")
    return {"status": "deleted", "template_id": template_id}


@app.post("/datasheet-templates", dependencies=[Depends(require_admin)])
async def create_datasheet_template(payload: DatasheetTemplateRequest) -> dict:
    datasheet_template_id = await handler.db.create_datasheet_template(payload.model_dump())
    return {"datasheet_template_id": datasheet_template_id}


@app.get("/datasheet-templates")
async def list_datasheet_templates() -> dict:
    return {"datasheet_templates": await handler.db.list_datasheet_templates()}


@app.get("/datasheet-templates/{datasheet_template_id}")
async def get_datasheet_template(datasheet_template_id: str) -> dict:
    datasheet_template = await handler.db.get_datasheet_template(datasheet_template_id)
    if not datasheet_template:
        raise HTTPException(status_code=404, detail="datasheet template not found")
    return {"datasheet_template": datasheet_template}


@app.put("/datasheet-templates/{datasheet_template_id}", dependencies=[Depends(require_admin)])
async def update_datasheet_template(datasheet_template_id: str, payload: DatasheetTemplateUpdateRequest) -> dict:
    updated = await handler.db.update_datasheet_template(datasheet_template_id, payload.model_dump(exclude_none=True))
    if not updated:
        raise HTTPException(status_code=404, detail="datasheet template not found or not modified")
    datasheet_template = await handler.db.get_datasheet_template(datasheet_template_id)
    return {"datasheet_template": datasheet_template}


@app.delete("/datasheet-templates/{datasheet_template_id}", dependencies=[Depends(require_admin)])
async def delete_datasheet_template(datasheet_template_id: str) -> dict:
    deleted = await handler.db.delete_datasheet_template(datasheet_template_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="datasheet template not found")
    return {"status": "deleted", "datasheet_template_id": datasheet_template_id}


@app.get("/dispositions")
async def get_dispositions() -> dict:
    return {"dispositions": await handler.db.get_dispositions()}


@app.put("/dispositions", dependencies=[Depends(require_admin)])
async def set_dispositions(payload: DispositionsUpdateRequest) -> dict:
    data = [item.model_dump() for item in payload.data]
    await handler.db.set_dispositions(data)
    return {"dispositions": data}


def _session_window(date_from: Optional[str], date_to: Optional[str]) -> dict:
    """A created_at filter built from two optional YYYY-MM-DD strings."""
    window: dict = {}
    if date_from:
        try:
            window["$gte"] = datetime.strptime(date_from, "%Y-%m-%d")
        except ValueError:
            pass
    if date_to:
        try:
            # Inclusive of the whole closing day.
            window["$lt"] = datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)
        except ValueError:
            pass
    return {"created_at": window} if window else {}


def _report_query(
    date_from: Optional[str], date_to: Optional[str],
    disposition: Optional[str], direction: Optional[str], search: Optional[str],
    execution_id: Optional[str] = None, session_id: Optional[str] = None,
) -> dict:
    query: dict = dict(_session_window(date_from, date_to))
    # A campaign records an execution, and every call it places carries that execution on
    # the session, so one campaign's calls are exactly the sessions that share it.
    if execution_id:
        query["execution_id"] = execution_id
    if session_id:
        query["session_id"] = session_id
    if disposition and disposition != "all":
        query["disposition_code"] = disposition.upper()
    if direction and direction != "all":
        query["direction"] = direction
    if search:
        safe = re.escape(search.strip())
        query["$or"] = [
            {"phone_number": {"$regex": safe, "$options": "i"}},
            {"session_id": {"$regex": safe, "$options": "i"}},
        ]
    return query


def _clean(value: Any) -> str:
    """The analysis writes the string "None" for an absent field; a report shows blank."""
    text = str(value if value is not None else "").strip()
    return "" if text.lower() in ("none", "null", "n/a") else text


def _duration_seconds(session: dict) -> int:
    started = session.get("started_at") or session.get("created_at")
    ended = session.get("ended_at")
    if started and ended:
        return max(0, int((ended - started).total_seconds()))
    raw = (session.get("call_info") or {}).get("Duration")
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return 0


# What a collections desk actually reads, in the order they read it.
REPORT_COLUMNS = [
    ("Date", lambda s, m, n: s["created_at"].strftime("%Y-%m-%d") if s.get("created_at") else ""),
    ("Time", lambda s, m, n: s["created_at"].strftime("%H:%M") if s.get("created_at") else ""),
    ("Phone", lambda s, m, n: s.get("phone_number") or ""),
    ("Direction", lambda s, m, n: s.get("direction") or ""),
    ("Status", lambda s, m, n: s.get("status") or ""),
    ("Outcome", lambda s, m, n: s.get("disposition_code") or ""),
    ("Promise date", lambda s, m, n: _clean(m.get("ptp_date") or m.get("commitment_date"))),
    ("Promise time", lambda s, m, n: _clean(m.get("ptp_time"))),
    ("Promise amount", lambda s, m, n: _clean(m.get("ptp_amt"))),
    ("Cooperation", lambda s, m, n: _clean(m.get("user_cooperation_level"))),
    ("Interruptions", lambda s, m, n: m.get("interruption_count", s.get("interruption_count", 0))),
    ("Turns", lambda s, m, n: n),
    ("Duration (s)", lambda s, m, n: _duration_seconds(s)),
    ("Language", lambda s, m, n: s.get("language") or _clean(m.get("language_detected"))),
    ("Use case", lambda s, m, n: s.get("use_case") or ""),
    ("Ended by", lambda s, m, n: s.get("hangup_source") or ""),
    ("Summary", lambda s, m, n: _clean(m.get("summary"))),
    ("Customer said", lambda s, m, n: _clean(m.get("customer_said"))),
    ("Session id", lambda s, m, n: s.get("session_id") or ""),
]


@app.get("/reports/calls.csv")
async def report_calls_csv(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    disposition: Optional[str] = None,
    direction: Optional[str] = None,
    search: Optional[str] = None,
    execution_id: Optional[str] = None,
    session_id: Optional[str] = None,
    limit: int = 5000,
) -> Response:
    """Every call in the window as a spreadsheet.

    A client asks for the result of a campaign as a file they can open and forward, and
    until now the only way to get one was to read the console screen by screen.
    """
    query = _report_query(
        date_from, date_to, disposition, direction, search, execution_id, session_id
    )
    sessions = await handler.db.sessions.find(query).sort("created_at", -1).to_list(
        max(1, min(limit, 50000))
    )

    buffer = _io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([name for name, _ in REPORT_COLUMNS])
    for session in sessions:
        model = session.get("model_data") or {}
        turns = await handler.db.conversations.count_documents(
            {"session_id": session["session_id"]}
        )
        writer.writerow([fn(session, model, turns) for _, fn in REPORT_COLUMNS])

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    filename = "qsilon-calls-" + stamp + ".csv"
    return Response(
        # Excel reads UTF-8 correctly only with the BOM, and these transcripts are
        # Devanagari more often than not.
        content="\ufeff" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="' + filename + '"'},
    )


@app.get("/analytics/summary")
async def analytics_summary(
    date_from: Optional[str] = None, date_to: Optional[str] = None
) -> dict:
    """Headline numbers for a period, counted in the database rather than in the browser."""
    window = _session_window(date_from, date_to)
    sessions = handler.db.sessions

    total = await sessions.count_documents(window)
    scored = await sessions.count_documents(
        {**window, "disposition_code": {"$nin": [None, ""]}}
    )

    by_disposition = await sessions.aggregate([
        {"$match": {**window, "disposition_code": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$disposition_code", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]).to_list(50)

    by_day = await sessions.aggregate([
        {"$match": {**window, "created_at": {"$ne": None}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
            "calls": {"$sum": 1},
            "promises": {
                "$sum": {"$cond": [{"$in": ["$disposition_code", ["PTP", "FPTP"]]}, 1, 0]}
            },
        }},
        {"$sort": {"_id": 1}},
    ]).to_list(400)

    by_language = await sessions.aggregate([
        {"$match": {**window, "language": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$language", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]).to_list(20)

    promises = sum(d["count"] for d in by_disposition if d["_id"] in ("PTP", "FPTP"))
    return {
        "total": total,
        "scored": scored,
        "promises": promises,
        "promise_rate": round(promises / scored * 100, 1) if scored else 0.0,
        "by_disposition": [{"code": d["_id"], "count": d["count"]} for d in by_disposition],
        "by_day": [
            {"date": d["_id"], "calls": d["calls"], "promises": d["promises"]} for d in by_day
        ],
        "by_language": [{"language": d["_id"], "count": d["count"]} for d in by_language],
    }


@app.get("/template-placeholders")
async def template_placeholders(
    template_id: Optional[str] = None,
    use_case: Optional[str] = None,
    language: Optional[str] = None,
) -> dict:
    """The {PLACEHOLDER} names the chosen script actually uses.

    A test call had one hardcoded CUSTOMER_NAME box, so every other placeholder in the
    prompt went unfilled and reached the caller as a blank - "kya main  se baat kar rahi
    hoon?". The form can only offer the right boxes if it knows what the script asks for,
    and only the script knows that.
    """
    template = None
    if template_id:
        template = await handler.db.get_template(template_id)
    if not template:
        templates = await handler.db.list_templates()
        template = templates[0] if templates else None
    if not template:
        return {"placeholders": []}

    resolved = resolve_template_config(template, {}, language=language, use_case=use_case)
    script = " ".join(str(resolved.get(k) or "") for k in ("system_prompt", "greeting_text"))
    names: List[str] = []
    seen = set()
    for raw in re.findall(r"\{(\w+)\}", script):
        key = raw.upper()
        if key not in seen:
            seen.add(key)
            names.append(key)
    return {
        "placeholders": names,
        "use_case": resolved.get("use_case"),
        "language": resolved.get("language"),
    }


@app.get("/mapping-keys")
async def get_mapping_keys() -> dict:
    return {"categories": await handler.db.get_mapping_keys()}


@app.put("/mapping-keys", dependencies=[Depends(require_admin)])
async def set_mapping_keys(payload: MappingKeysUpdateRequest) -> dict:
    await handler.db.set_mapping_keys(payload.categories)
    return {"categories": payload.categories}


DEFAULT_APP_SETTINGS = {
    "telephony_provider": "exotel",
    "from_number": "",
    "stt_provider": "deepgram",
    "stt_model": settings.DEEPGRAM_MODEL,
    "llm_provider": "groq",
    "llm_model": settings.GROQ_MODEL,
    "tts_provider": "cartesia",
    "tts_model_id": settings.CARTESIA_MODEL_ID,
    "tts_voice_id": settings.CARTESIA_VOICE_ID,
    "default_language": "hindi",
    # 8+8 hung up 16s after the last completed turn - too short for someone
    # working out a payment date. 12+12 gives them room without stalling.
    "silence_first_seconds": 12,
    "silence_second_seconds": 12,
    "max_call_seconds": 150,
}


@app.get("/settings")
async def get_app_settings() -> dict:
    stored = await handler.db.get_app_settings()
    merged = {**DEFAULT_APP_SETTINGS, **{k: v for k, v in stored.items() if v not in (None, "")}}
    merged.pop("updated_at", None)
    return {
        "settings": merged,
        # Which integrations actually have credentials, so the UI can show real status
        # instead of assuming everything is wired up.
        "credentials": {
            # MONGO_URI defaults to a localhost URI, so a plain truth test reports
            # "configured" on a host that never received the real connection string.
            "mongo": bool(settings.MONGO_URI) and "localhost" not in settings.MONGO_URI,
            "deepgram": bool(settings.DEEPGRAM_API_KEY),
            "groq": bool(settings.GROQ_API_KEY),
            "cerebras": bool(settings.CEREBRAS_API_KEY),
            "cartesia": bool(settings.CARTESIA_API_KEY),
            "twilio": bool(settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN),
            "exotel": bool(settings.EXOTEL_API_KEY and settings.EXOTEL_API_TOKEN),
            "plivo": bool(settings.PLIVO_AUTH_ID and settings.PLIVO_AUTH_TOKEN),
            "vobiz": bool(settings.VOBIZ_AUTH_ID and settings.VOBIZ_AUTH_TOKEN),
        },
        # Caller id per network. The Settings screen uses this as the placeholder for the
        # "Caller ID" field, so a provider missing here shows no hint about which number a
        # blank field would actually dial from.
        "numbers": {
            "twilio": settings.TWILIO_PHONE_NUMBER,
            "exotel": settings.EXOTEL_EXOPHONE,
            "plivo": settings.PLIVO_PHONE_NUMBER,
            "vobiz": settings.VOBIZ_PHONE_NUMBER,
        },
    }


@app.put("/settings", dependencies=[Depends(require_admin)])
async def update_app_settings(payload: AppSettingsRequest) -> dict:
    data = payload.model_dump(exclude_none=True)
    await handler.db.set_app_settings(data)
    return await get_app_settings()


@app.get("/agents")
async def list_agents() -> dict:
    agents = await handler.db.list_agents()
    # Surface live utilisation next to the configured capacity.
    for agent in agents:
        agent["active_calls"] = call_registry.agent_active_count(agent["_id"])
    return {"agents": agents, "total_active_calls": call_registry.active_count()}


@app.post("/agents", dependencies=[Depends(require_admin)])
async def create_agent(payload: AgentRequest) -> dict:
    agent_id = await handler.db.create_agent(payload.model_dump())
    return {"agent_id": agent_id}


@app.put("/agents/{agent_id}", dependencies=[Depends(require_admin)])
async def update_agent(agent_id: str, payload: AgentUpdateRequest) -> dict:
    updated = await handler.db.update_agent(agent_id, payload.model_dump(exclude_none=True))
    if not updated:
        raise HTTPException(status_code=404, detail="agent not found or not modified")
    return {"agent": await handler.db.get_agent(agent_id)}


@app.delete("/agents/{agent_id}", dependencies=[Depends(require_admin)])
async def delete_agent(agent_id: str) -> dict:
    deleted = await handler.db.delete_agent(agent_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="agent not found")
    return {"status": "deleted", "agent_id": agent_id}


@app.get("/providers")
async def list_providers() -> dict:
    """Provider catalogue for the admin UI, annotated with what is actually usable."""
    return {"capabilities": describe_providers()}


@app.get("/languages")
async def list_supported_languages() -> dict:
    return {
        "languages": [
            {"key": key, "label": meta["label"], "stt": meta["stt"], "tts": meta["tts"]}
            for key, meta in SUPPORTED_LANGUAGES.items()
        ]
    }


@app.post("/datasheets/upload", dependencies=[Depends(require_api_key)])
async def upload_datasheet(
    datasheet_template_id: str = Form(...),
    name: str = Form(...),
    file: UploadFile = File(...),
) -> dict:
    datasheet_template = await handler.db.get_datasheet_template(datasheet_template_id)
    if not datasheet_template:
        raise HTTPException(status_code=404, detail="datasheet template not found")

    content = await file.read()
    try:
        columns, rows = parse_datasheet_file(file.filename or "", content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        validate_columns(columns, datasheet_template.get("required_columns") or [])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not rows:
        raise HTTPException(status_code=400, detail="Uploaded file has no data rows.")

    datasheet_id = await handler.db.create_datasheet(name, datasheet_template_id, columns, rows)
    return {"datasheet_id": datasheet_id, "row_count": len(rows), "columns": columns}


@app.get("/datasheets")
async def list_datasheets() -> dict:
    return {"datasheets": await handler.db.list_datasheets()}


@app.get("/datasheets/{datasheet_id}")
async def get_datasheet(datasheet_id: str) -> dict:
    datasheet = await handler.db.get_datasheet(datasheet_id)
    if not datasheet:
        raise HTTPException(status_code=404, detail="datasheet not found")
    return {"datasheet": datasheet}


@app.delete("/datasheets/{datasheet_id}", dependencies=[Depends(require_api_key)])
async def delete_datasheet(datasheet_id: str) -> dict:
    deleted = await handler.db.delete_datasheet(datasheet_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="datasheet not found")
    return {"status": "deleted", "datasheet_id": datasheet_id}


@app.put("/datasheets/{datasheet_id}", dependencies=[Depends(require_api_key)])
async def rename_datasheet(datasheet_id: str, payload: DatasheetRenameRequest) -> dict:
    updated = await handler.db.update_datasheet(datasheet_id, {"name": payload.name})
    if not updated:
        raise HTTPException(status_code=404, detail="datasheet not found or not modified")
    datasheet = await handler.db.get_datasheet(datasheet_id)
    return {"datasheet": datasheet}


@app.post("/campaigns", dependencies=[Depends(require_api_key)])
async def create_campaign(payload: CampaignRequest) -> dict:
    datasheet = await handler.db.get_datasheet(payload.datasheet_id)
    if not datasheet:
        raise HTTPException(status_code=404, detail="datasheet not found")
    template = await handler.db.get_template(payload.prompt_template_id)
    if not template:
        raise HTTPException(status_code=404, detail="prompt template not found")

    total = 1 if payload.mode == "test" else datasheet.get("row_count", 0)
    campaign_id = await handler.db.create_campaign(
        payload.name,
        payload.mode,
        payload.datasheet_id,
        payload.prompt_template_id,
        total,
        payload.template_variant,
        use_case=payload.use_case,
        language=payload.language,
        agent_id=payload.agent_id,
        agent_ids=payload.agent_ids,
    )
    return {"campaign_id": campaign_id}


@app.post("/campaigns/{campaign_id}/launch", dependencies=[Depends(require_api_key)])
async def launch_campaign(campaign_id: str) -> dict:
    campaign = await handler.db.get_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="campaign not found")
    if campaign.get("status") == "running":
        raise HTTPException(status_code=409, detail="campaign is already running")
    asyncio.create_task(run_campaign(handler, campaign_id))
    return {"status": "launching", "campaign_id": campaign_id}


@app.get("/campaigns")
async def list_campaigns() -> dict:
    return {"campaigns": await handler.db.list_campaigns()}


@app.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str) -> dict:
    campaign = await handler.db.get_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="campaign not found")
    datasheet = await handler.db.get_datasheet(campaign["datasheet_id"])
    return {"campaign": campaign, "rows": (datasheet or {}).get("rows", [])}


@app.post("/datasheet-update/start", dependencies=[Depends(require_api_key)])
async def start_datasheet_update(execution_id: str, batch_size: int = 500) -> dict:
    job_id = await handler.db.create_background_job(
        job_type="datasheet_update",
        payload={"execution_id": execution_id, "batch_size": batch_size},
        status="pending",
    )
    return {"job_id": job_id, "status": "pending"}


@app.get("/datasheet-update/status/{job_id}")
async def get_datasheet_update_status(job_id: str) -> dict:
    job = await handler.db.get_background_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.get("/datasheet-update/jobs")
async def list_datasheet_update_jobs(status: Optional[str] = None, limit: int = 20) -> dict:
    jobs = await handler.db.list_background_jobs(status=status, limit=limit)
    return {"jobs": jobs}


@app.post("/sms/sms-status")
async def sms_status_webhook(request: Request) -> JSONResponse:
    form_data = await request.form()
    session_id = form_data.get("session_id")
    if session_id:
        await handler.db.update_session(session_id, sms_status=form_data.get("Status") or form_data.get("status"))
    return JSONResponse({"status": "ok", "received": dict(form_data)})


@app.get("/config")
async def get_current_config() -> dict:
    return {
        "mongo_ready": handler.db.ready,
        "llm_ready": handler.llm.ready,
        "tts_ready": handler.tts.ready,
        "stt_ready": handler.stt.ready,
        "dynamic_fields": handler.dynamic_fields,
    }


@app.get("/get-next-execution-data")
async def get_next_execution_data() -> dict:
    execution = await handler.db.executions.find_one({})
    if not execution:
        return {}
    execution["_id"] = str(execution.get("_id"))
    return {"execution": execution}


@app.websocket("/stream")
async def stream_websocket(websocket: WebSocket) -> None:
    """Twilio Media Stream: bidirectional audio for the live voice conversation.

    Twilio sends `connected`/`start`/`media`/`stop` events; we reply with `media`
    (synthesized speech) and `clear` (barge-in) events on the same socket. See
    https://www.twilio.com/docs/voice/media-streams/websocket-messages
    """
    await websocket.accept()
    session_id = websocket.query_params.get("session_id", "")
    # Route to the handler that owns this call so concurrent streams stay independent.
    call = call_registry.get_call(session_id) or handler
    try:
        await handler.db.update_session(session_id, websocket_connected=True)
        while True:
            message = await websocket.receive_json()
            event = message.get("event")
            if event == "connected":
                continue
            elif event == "start":
                start = message.get("start", {})
                stream_sid = start.get("streamSid")
                await call.attach_stream(websocket, stream_sid)
            elif event == "media":
                payload_b64 = message.get("media", {}).get("payload")
                if payload_b64:
                    await call.handle_incoming_audio(base64.b64decode(payload_b64))
            elif event == "stop":
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Error in Twilio media stream for session %s", session_id)
    finally:
        await call.detach_stream()
        try:
            await websocket.close()
        except Exception:
            pass


@app.websocket("/exotel-stream")
async def exotel_stream_websocket(websocket: WebSocket) -> None:
    """Exotel Voicebot applet stream: bidirectional audio for the live voice conversation.

    The Voicebot applet's URL is static (configured once in the Exotel dashboard Flow),
    so there's no per-call session_id in the query string like the Twilio stream has.
    Calls run sequentially through the single shared CallHandler, so whichever session
    is currently active on `handler` when this socket connects is the right one.

    The exact event schema isn't publicly documented the way Twilio's is, so this parses
    defensively (several likely key names) and logs the raw first message to make it easy
    to adjust once a real call's payload shape is visible in the logs.
    """
    await websocket.accept()
    # Which call this stream belongs to is only known once the `start` event arrives with
    # custom_parameters, so the handler is resolved there rather than up front.
    session_id = ""
    call: Any = None
    seen_events: dict = {}
    frame_count = 0
    try:
        while True:
            message = await websocket.receive_json()
            frame_count += 1

            event = message.get("event") or message.get("type")
            # Record one sample of each distinct event type so the real payload shape
            # can be inspected after the call (see /debug/exotel-stream).
            if event not in seen_events:
                seen_events[event] = message
                logger.warning("Exotel stream event %r for session %s: %s", event, session_id, message)
                _write_exotel_debug(session_id, seen_events, frame_count)

            if event in ("connected", "connect"):
                continue
            elif event == "start":
                start = message.get("start", {}) or {}
                stream_sid = start.get("streamSid") or start.get("stream_sid") or message.get("stream_sid")
                # Exotel echoes the CustomField we sent on the outbound call back as a
                # key of custom_parameters (e.g. {"<session_id>": ""}). That identifies
                # which of the concurrently running calls this stream belongs to.
                custom = start.get("custom_parameters") or {}
                for key, value in custom.items():
                    candidate = value if (isinstance(value, str) and value.strip()) else key
                    if candidate and candidate.strip():
                        session_id = candidate.strip()
                        break

                call = call_registry.get_call(session_id)
                if call is None:
                    # Unknown session: only safe to guess when exactly one call is live.
                    call = call_registry.only_active_call() or handler
                    logger.warning(
                        "Exotel stream for session %r not in registry (%s active); using fallback",
                        session_id,
                        call_registry.active_count(),
                    )
                if session_id:
                    await handler.db.update_session(session_id, websocket_connected=True)
                await call.attach_stream(websocket, stream_sid, provider="exotel")
            elif event == "media":
                media = message.get("media", {}) or {}
                payload_b64 = media.get("payload") or message.get("payload") or message.get("audio")
                if payload_b64 and call is not None:
                    await call.handle_incoming_audio(base64.b64decode(payload_b64))
            elif event in ("stop", "disconnect"):
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Error in Exotel media stream for session %s", session_id)
        _write_exotel_debug(session_id, seen_events, frame_count, error=traceback.format_exc())
    finally:
        _write_exotel_debug(session_id, seen_events, frame_count, closed=True)
        if call is not None:
            await call.detach_stream()
        try:
            await websocket.close()
        except Exception:
            pass


@app.websocket("/vobiz-stream")
async def vobiz_stream_websocket(websocket: WebSocket) -> None:
    """Vobiz audio stream: bidirectional audio for the live conversation.

    Two shape differences from the Plivo/Twilio streams, both silent if missed: messages
    are keyed on "type" rather than "event", and inbound audio arrives as a top-level
    "payload" rather than nested under "media".
    """
    await websocket.accept()
    session_id = websocket.query_params.get("session_id") or ""
    call: Any = call_registry.get_call(session_id) if session_id else None
    if call is None:
        active = call_registry.active_count()
        # Guessing is only safe when there is exactly one call to guess at. With several
        # live it attached this stream to somebody else's handler, so two callers shared
        # one conversation. Refuse instead.
        if active > 1:
            logger.warning(
                "Vobiz stream for session %r rejected: %s calls live, cannot guess",
                session_id, active,
            )
            await websocket.close()
            return
        call = call_registry.only_active_call() or handler
        logger.warning(
            "Vobiz stream for session %r not in registry (%s active); using fallback",
            session_id, active,
        )
    try:
        while True:
            message = await websocket.receive_json()
            event = message.get("type") or message.get("event")
            if event == "start":
                start = message.get("start", {}) or {}
                # Outbound audio is routed by streamId, so this must come from the start
                # payload - not the session id, which Vobiz does not recognise.
                stream_id = (
                    start.get("streamId")
                    or start.get("stream_id")
                    or message.get("streamId")
                    or ""
                )
                # The call id lives in start.callId; the create-call response only carried
                # a request_uuid, and hangup needs the real one.
                call_uuid = (
                    start.get("callId")
                    or start.get("call_id")
                    or message.get("callUUID")
                    or ""
                )
                # Vobiz negotiates the rate (8k/16k/24k) and expects audio back at the same
                # rate. Assuming 8kHz against a 16kHz stream plays everything at the wrong
                # speed and makes transcription unreliable.
                fmt = start.get("mediaFormat") or {}
                rate = fmt.get("sampleRate") if isinstance(fmt, dict) else None
                logger.warning(
                    "Vobiz stream start: session=%s streamId=%s callId=%s format=%s",
                    session_id, stream_id, call_uuid, fmt,
                )
                if call_uuid:
                    call.call_sid = call_uuid
                if session_id:
                    await handler.db.update_session(session_id, websocket_connected=True)
                await call.attach_stream(websocket, stream_id, provider="vobiz")
                if isinstance(rate, int) and rate in (8000, 16000, 24000):
                    call.stream_sample_rate = rate
            elif event == "media":
                payload_b64 = message.get("payload") or (message.get("media") or {}).get("payload")
                if payload_b64:
                    await call.handle_incoming_audio(base64.b64decode(payload_b64))
            elif event in ("stop", "disconnect"):
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Error in Vobiz media stream for session %s", session_id)
    finally:
        if call is not None:
            await call.detach_stream()
        try:
            await websocket.close()
        except Exception:
            pass


@app.websocket("/plivo-stream")
async def plivo_stream_websocket(websocket: WebSocket) -> None:
    """Plivo AudioStream: bidirectional audio for the live conversation.

    Unlike Exotel's applet — whose URL is static and which identifies the call through
    custom_parameters — Plivo's stream URL is built per call, so session_id arrives on the
    query string and the handler can be resolved before the first audio frame.
    """
    await websocket.accept()
    session_id = websocket.query_params.get("session_id") or ""
    call: Any = call_registry.get_call(session_id)
    if call is None:
        call = call_registry.only_active_call() or handler
        logger.warning(
            "Plivo stream for session %r not in registry (%s active); using fallback",
            session_id, call_registry.active_count(),
        )
    try:
        while True:
            message = await websocket.receive_json()
            event = message.get("event")
            if event == "start":
                start = message.get("start", {}) or {}
                stream_id = (
                    start.get("streamId")
                    or start.get("stream_id")
                    or message.get("streamId")
                    or ""
                )
                logger.info("Plivo stream started for session %s (streamId=%s)", session_id, stream_id)
                if session_id:
                    await handler.db.update_session(session_id, websocket_connected=True)
                await call.attach_stream(websocket, stream_id, provider="plivo")
            elif event == "media":
                media = message.get("media", {}) or {}
                payload_b64 = media.get("payload")
                if payload_b64:
                    await call.handle_incoming_audio(base64.b64decode(payload_b64))
            elif event in ("stop", "disconnect"):
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Error in Plivo media stream for session %s", session_id)
    finally:
        if call is not None:
            await call.detach_stream()
        try:
            await websocket.close()
        except Exception:
            pass


EXOTEL_DEBUG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exotel_stream_debug.json")


def _write_exotel_debug(session_id: str, seen_events: dict, frame_count: int, **extra) -> None:
    """Dump a sample of each Exotel stream event type to a file.

    Exotel's Voicebot websocket schema isn't publicly documented, so this makes the
    real payload shape inspectable after a call instead of having to read it out of
    the server's stdout.
    """
    try:
        sample = {}
        for event, message in seen_events.items():
            msg = json.loads(json.dumps(message))  # deep copy
            # Audio payloads are large; keep only a prefix plus decoded byte length.
            media = msg.get("media")
            if isinstance(media, dict) and isinstance(media.get("payload"), str):
                raw = media["payload"]
                media["payload_bytes"] = len(base64.b64decode(raw)) if raw else 0
                media["payload"] = raw[:48] + "...(truncated)"
            sample[str(event)] = msg
        with open(EXOTEL_DEBUG_PATH, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "session_id": session_id,
                    "frame_count": frame_count,
                    "event_types": list(sample.keys()),
                    "samples": sample,
                    **extra,
                },
                fh,
                indent=2,
                default=str,
            )
    except Exception:
        logger.exception("Failed to write Exotel stream debug file")


@app.get("/debug/exotel-stream")
async def debug_exotel_stream() -> dict:
    if not os.path.exists(EXOTEL_DEBUG_PATH):
        return {"status": "no data yet"}
    with open(EXOTEL_DEBUG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Static frontend
#
# In the deployed image the built React app lives in frontend/dist and is served by this
# same process, so the UI and API share an origin (no CORS, one URL to hand a client).
# Registered last on purpose: FastAPI matches routes in declaration order, so every API
# route above still wins, and only unmatched paths fall through to the SPA.
# ---------------------------------------------------------------------------
# The shell is tiny and must never be cached under an API path: a stale copy served to
# an XHR is indistinguishable from an empty API response.
_SPA_SHELL_HEADERS = {
    "Cache-Control": "no-store, must-revalidate",
    "Vary": "Sec-Fetch-Dest, Accept, Accept-Encoding",
}

FRONTEND_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "dist")
_INDEX_HTML = os.path.join(FRONTEND_DIST, "index.html")

# The React routes and the REST routes deliberately share names (/campaigns, /settings,
# /agents, ...). Serving both from one origin means a request for "/campaigns" is
# ambiguous, so they are told apart by intent rather than by path: a browser navigating
# to a page sends "Accept: text/html", while the UI's own fetch() calls do not. Anything
# asking for HTML on a known page route gets the SPA shell; everything else falls through
# to the API exactly as before.
SPA_ROUTES = {
    "/", "/login", "/sessions", "/calls", "/templates", "/datasheets",
    "/datasheet-templates", "/campaigns", "/agents", "/analytics", "/settings",
}


def _is_spa_route(path: str) -> bool:
    if path in SPA_ROUTES:
        return True
    # Detail pages such as /sessions/<id> and /campaigns/<id>.
    return any(path.startswith(route + "/") for route in SPA_ROUTES if route != "/")


if os.path.isdir(FRONTEND_DIST):
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.middleware("http")
    async def spa_navigation_middleware(request: Request, call_next):
        """Serve the SPA shell for page navigations only.

        The Accept header alone is not a safe signal: browsers send an Accept that
        includes text/html on XHR too, so every API route sharing a name with a page
        (/templates, /campaigns, /agents, /datasheets, ...) returned index.html to the
        app's own fetch calls. The UI then read `.templates` off an HTML string, got
        undefined, and rendered an empty page while /health - not a page route - kept
        working, which made it look like a data problem.

        Sec-Fetch-Dest is the reliable signal: browsers set it to "document" only for a
        real navigation, and to "empty" for fetch/XHR. It is sent by every current
        browser over HTTPS; when it is absent (curl, older clients) fall back to Accept.
        """
        if request.method != "GET" or not _is_spa_route(request.url.path):
            return await call_next(request)

        dest = request.headers.get("sec-fetch-dest")
        if dest is not None:
            is_navigation = dest == "document"
        else:
            is_navigation = "text/html" in request.headers.get("accept", "")

        if is_navigation:
            return FileResponse(_INDEX_HTML, headers=_SPA_SHELL_HEADERS)

        response = await call_next(request)
        # Same URL, two different bodies depending on the request. Without Vary a cache
        # stores whichever came first and replays it for the other kind: navigate to
        # /templates (HTML gets cached), then the app's XHR is served that HTML and reads
        # undefined off it. That is the intermittent "works after a refresh" failure.
        response.headers["Vary"] = "Sec-Fetch-Dest, Accept, Accept-Encoding"
        return response

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> Any:
        """Serve static files, and the SPA shell for any other unmatched page route.

        A missing asset must 404 rather than quietly return index.html with a 200, which
        would turn every typo into a blank page instead of an error.
        """
        candidate = os.path.normpath(os.path.join(FRONTEND_DIST, full_path))
        # normpath collapses "..", so confirm the result is still inside the dist folder.
        if candidate.startswith(FRONTEND_DIST) and os.path.isfile(candidate):
            return FileResponse(candidate)
        if os.path.splitext(full_path)[1]:
            raise HTTPException(status_code=404, detail="not found")
        return FileResponse(_INDEX_HTML, headers=_SPA_SHELL_HEADERS)

else:  # pragma: no cover - local dev runs the Vite server separately
    logger.info("No built frontend at %s; serving API only.", FRONTEND_DIST)
