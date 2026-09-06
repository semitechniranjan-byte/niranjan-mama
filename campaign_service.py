import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

try:
    from .template_service import (
        apply_format_value_transforms,
        apply_update_columns_mapping,
        resolve_template_config,
    )
    from .call_handler import CallHandler
    from . import call_registry
except ImportError:  # pragma: no cover
    from template_service import (
        apply_format_value_transforms,
        apply_update_columns_mapping,
        resolve_template_config,
    )
    from call_handler import CallHandler
    import call_registry

logger = logging.getLogger(__name__)

_running_campaigns: set[str] = set()

# What a running campaign has been told to do. A row consults this after it has taken a
# slot and before it dials, so pausing lets calls already in progress finish rather than
# cutting anyone off mid-sentence, and stopping leaves the untouched rows queued for a
# later run instead of marking them failed.
RUNNING, PAUSED, STOPPED = "running", "paused", "stopped"
_campaign_control: Dict[str, str] = {}
# How often a paused row wakes to see whether it may go.
PAUSE_POLL_SECONDS = 2.0


def control_state(campaign_id: str) -> str:
    return _campaign_control.get(campaign_id, RUNNING)


def set_control_state(campaign_id: str, state: str) -> None:
    _campaign_control[campaign_id] = state

CALL_END_POLL_INTERVAL = 3
CALL_END_TIMEOUT = 180


def is_campaign_running(campaign_id: str) -> bool:
    return campaign_id in _running_campaigns


async def _wait_for_session_end(db, session_id: str, timeout: int = CALL_END_TIMEOUT) -> None:
    waited = 0
    while waited < timeout:
        session = await db.get_session(session_id)
        if not session or session.get("active") is False:
            return
        await asyncio.sleep(CALL_END_POLL_INTERVAL)
        waited += CALL_END_POLL_INTERVAL


async def _run_post_call_analysis(
    handler, session_id: str, analysis_prompt: Optional[str], llm=None,
) -> Dict[str, Any]:
    llm = llm or handler.llm
    if not analysis_prompt or not llm.ready:
        return {}
    history = await handler.db.get_conversation_history(session_id)
    transcript = "\n".join(f"{h.get('role', '').upper()}: {h.get('content', '')}" for h in history)
    if not transcript:
        return {}

    now = datetime.utcnow()
    filled_prompt = (
        analysis_prompt.replace("{conversation_text}", transcript)
        .replace("{call_date_dd_mm_yyyy}", now.strftime("%d-%m-%Y"))
        .replace("{call_date}", now.strftime("%d-%m-%Y"))
    )
    try:
        response = await llm.client.chat.completions.create(
            model=getattr(llm, "model", None) or _groq_model(),
            messages=[{"role": "user", "content": filled_prompt}],
            temperature=0.1,
            # Room enough that a reasoning model can think and still emit the JSON. At 1200
            # one returned finish_reason=length with an empty body and nothing was scored.
            max_tokens=4000,
        )
        content = response.choices[0].message.content or "{}"
        content = content.strip()
        if content.startswith("```"):
            content = content.strip("`")
            if content.lower().startswith("json"):
                content = content[4:]
        windows = _day_windows(await handler.db.get_app_settings())
        return _enforce_disposition_rules(json.loads(content), session_id, windows)
    except Exception as exc:
        logger.warning("Post-call analysis failed for session %s: %s", session_id, exc)
        return {}


# Day windows the business rules define for a payment commitment. These are one client's
# policy, not a law: the disposition labels read "(0-2 days)" and "(3-7 days)" and a desk
# that works to different windows had to edit code to change them. Settings holds them
# now, and these stay as the defaults.
PTP_MAX_DAYS = 2      # 0-2 days  -> PTP
FPTP_MAX_DAYS = 7     # 3-7 days  -> FPTP; beyond that the promise counts as a refusal


# Outcomes that mean nobody was spoken to. A promise or a refusal is an answer and must
# never be dialled again; these are the ones worth another try.
RETRYABLE_CODES = {"NR", "ICR", "RNR", "LM", "NO_ANSWER", "ERROR", "CALL_NOT_PLACED"}
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_RETRY_GAP_HOURS = 4
# India restricts telemarketing to 09:00-21:00. Calls have gone out at 04:00 from this
# deployment, which is a compliance problem before it is a courtesy one.
DEFAULT_CALL_START_HOUR = 9
DEFAULT_CALL_END_HOUR = 21


def _calling_window(app_settings: Optional[Dict[str, Any]] = None) -> tuple[int, int]:
    """The hours calls may be placed in, as configured."""
    conf = app_settings or {}
    try:
        start = int(conf.get("calling_start_hour", DEFAULT_CALL_START_HOUR))
        end = int(conf.get("calling_end_hour", DEFAULT_CALL_END_HOUR))
    except (TypeError, ValueError):
        return DEFAULT_CALL_START_HOUR, DEFAULT_CALL_END_HOUR
    if not (0 <= start < end <= 24):
        return DEFAULT_CALL_START_HOUR, DEFAULT_CALL_END_HOUR
    return start, end


def _within_calling_hours(app_settings: Optional[Dict[str, Any]] = None, now=None) -> bool:
    start, end = _calling_window(app_settings)
    return start <= (now or datetime.now()).hour < end


def _retry_policy(app_settings: Optional[Dict[str, Any]] = None) -> tuple[int, int]:
    """How many attempts a number gets, and how long to leave between them."""
    conf = app_settings or {}
    try:
        attempts = int(conf.get("max_attempts", DEFAULT_MAX_ATTEMPTS))
        gap = int(conf.get("retry_gap_hours", DEFAULT_RETRY_GAP_HOURS))
    except (TypeError, ValueError):
        return DEFAULT_MAX_ATTEMPTS, DEFAULT_RETRY_GAP_HOURS
    return max(1, attempts), max(0, gap)


def _next_window_open(app_settings: Optional[Dict[str, Any]] = None) -> datetime:
    """The next moment calls may go out, in UTC as the rows store it."""
    start, end = _calling_window(app_settings)
    now = datetime.now()
    opens = now.replace(hour=start, minute=0, second=0, microsecond=0)
    if now.hour >= end or now >= opens:
        if now.hour >= start:
            opens += timedelta(days=1)
    # Rows are stored in UTC; the window is local, so carry the offset across.
    return datetime.utcnow() + (opens - now)


async def _schedule_retry(db, datasheet_id: str, row_index: int, row: Optional[dict]) -> None:
    """Book another attempt for a row nobody answered, if it has attempts left.

    Thirty percent of a list ends this way and every one of them used to stop there - the
    campaign page said as much: each row is called once. A number that did not pick up at
    ten in the morning is a different proposition at four in the afternoon.
    """
    if not row:
        return
    code = str(row.get("disposition_code") or "").upper()
    if code and code not in RETRYABLE_CODES:
        return
    conf = await db.get_app_settings()
    max_attempts, gap_hours = _retry_policy(conf)
    attempts = int(row.get("attempt_count") or 1)
    if attempts >= max_attempts:
        await db.update_datasheet_row(
            datasheet_id, row_index, attempt_count=attempts, next_attempt_at=None
        )
        return
    await db.update_datasheet_row(
        datasheet_id,
        row_index,
        attempt_count=attempts,
        next_attempt_at=datetime.utcnow() + timedelta(hours=gap_hours),
    )
    logger.info(
        "RETRY row %s of %s booked for attempt %s in %sh (%s)",
        row_index, datasheet_id, attempts + 1, gap_hours, code or "no outcome",
    )


def _day_windows(app_settings: Optional[Dict[str, Any]] = None) -> tuple[int, int]:
    """The PTP and FPTP day windows, as configured, falling back to the defaults."""
    settings_map = app_settings or {}
    try:
        ptp = int(settings_map.get("ptp_max_days") or PTP_MAX_DAYS)
        fptp = int(settings_map.get("fptp_max_days") or FPTP_MAX_DAYS)
    except (TypeError, ValueError):
        return PTP_MAX_DAYS, FPTP_MAX_DAYS
    # A window that ends before the one inside it would put every promise in the outer
    # bucket, so a bad pair falls back rather than silently reclassifying the book.
    if ptp < 0 or fptp < ptp:
        return PTP_MAX_DAYS, FPTP_MAX_DAYS
    return ptp, fptp


def _enforce_disposition_rules(
    result: Dict[str, Any], session_id: str, windows: Optional[tuple[int, int]] = None,
) -> Dict[str, Any]:
    """Apply the day-window rules deterministically after the model has answered.

    The prompt states these rules, but the model reliably mislabels commitments beyond a
    week as PTP, which would overstate promise-to-pay. Recomputing from ptp_days keeps the
    disposition consistent with the stated policy regardless of what the model returned.
    """
    if not isinstance(result, dict):
        return {}

    code = str(result.get("disposition_code") or "").upper()
    # Only timing-based codes are re-derived; CP/SH/DIF/etc. are left untouched.
    if code not in {"PTP", "FPTP", "RTP"}:
        return result

    try:
        days = int(result.get("ptp_days") or 0)
    except (TypeError, ValueError):
        days = 0

    ptp_max, fptp_max = windows or (PTP_MAX_DAYS, FPTP_MAX_DAYS)
    if days > fptp_max:
        expected = "RTP"
    elif days > ptp_max:
        expected = "FPTP"
    else:
        expected = code if code in {"PTP", "RTP"} else "PTP"

    if expected != code:
        logger.warning(
            "ANALYSIS [%s] disposition %s with ptp_days=%s violates the day rules; correcting to %s",
            session_id, code, days, expected,
        )
        result["disposition_code"] = expected
        result["outcome"] = expected

    if result["disposition_code"] == "RTP":
        # A deferred promise is a refusal: no payment date is carried forward.
        if result.get("ptp_date") not in (None, "None", ""):
            result["commitment_date"] = result.get("ptp_date")
        result["ptp_date"] = None
        result["ptp_flag"] = False
        result["promise_reminder_flag"] = False
        if not result.get("refusal_reason") or result.get("refusal_reason") in ("None", ""):
            result["refusal_reason"] = "will_pay_later"
    else:
        result["ptp_flag"] = True
        result["refusal_reason"] = None

    return result


def _groq_model() -> str:
    try:
        from .config import settings
    except ImportError:  # pragma: no cover
        from config import settings
    return settings.GROQ_MODEL


async def _finalize_row_from_session(
    handler, datasheet_id: str, row_index: int, session_id: Optional[str], analysis_prompt: Optional[str]
) -> None:
    db = handler.db
    if not session_id:
        await db.update_datasheet_row(datasheet_id, row_index, status="failed", disposition_code="CALL_NOT_PLACED")
        return

    history = await db.get_conversation_history(session_id)

    if history:
        analysis_result = await _run_post_call_analysis(handler, session_id, analysis_prompt)
        if analysis_result:
            await db.update_model_data(session_id, analysis_result)

    session = await db.get_session(session_id)
    model_data = (session or {}).get("model_data", {}) or {}

    if not session:
        status, disposition = "failed", "UNKNOWN"
    elif len(history) == 0:
        status, disposition = "no_answer", "NO_ANSWER"
    else:
        status = "completed"
        disposition = model_data.get("disposition_code") or "COMPLETED"

    await db.update_datasheet_row(
        datasheet_id,
        row_index,
        status=status,
        disposition_code=disposition,
        model_data=model_data,
    )


async def _run_one_row(
    *,
    db,
    shared_handler,
    campaign_id: str,
    datasheet_id: str,
    row: dict,
    template: dict,
    phone_column: Optional[str],
    campaign_language: str,
    campaign_use_case: Optional[str],
    provider: str,
    from_number: Optional[str],
    execution_id: Optional[str],
    update_columns_mapping: dict,
    max_call_seconds: int,
    semaphore: asyncio.Semaphore,
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    agent_id: str = "default",
    agent_name: str = "default",
) -> None:
    """Place and finish one call. Runs concurrently with other rows, bounded by `semaphore`."""
    row_index = row["row_index"]
    row_data: Dict[str, Any] = row.get("data", {}) or {}
    phone = str(row_data.get(phone_column, "")).strip() if phone_column else ""

    if not phone:
        await db.update_datasheet_row(
            datasheet_id, row_index, status="failed", disposition_code="MISSING_PHONE"
        )
        await db.shift_campaign_stat(campaign_id, "queued", "failed")
        return

    # Checked before the slot is taken, not after: a suppressed number should not occupy
    # capacity another row could use.
    blocked = await db.is_suppressed(phone)
    if blocked:
        logger.warning(
            "Campaign %s: %s is on the do-not-call list (%s); row %s skipped",
            campaign_id, phone, blocked.get("reason") or blocked.get("source"), row_index,
        )
        await db.update_datasheet_row(
            datasheet_id, row_index, status="skipped", disposition_code="DNC",
            next_attempt_at=None,
        )
        await db.shift_campaign_stat(campaign_id, "queued", "failed")
        return

    # Two limits, deliberately separate: the agent semaphore is the business rule for
    # this pool; the global one is what the host and the LLM tier can actually survive.
    # A campaign configured for 500 concurrent calls would otherwise dial 500 at once
    # and degrade every one of them at the same time.
    async with call_registry.global_call_semaphore():
        async with semaphore:
            # Hold here while the run is paused, and leave the row queued if it was stopped.
            # Checking after the slot is taken rather than before means the decision is read
            # as late as possible - a stop reaches rows that were still waiting their turn.
            while control_state(campaign_id) == PAUSED:
                await asyncio.sleep(PAUSE_POLL_SECONDS)
            if control_state(campaign_id) == STOPPED:
                logger.warning(
                    "Campaign %s stopped; row %s left queued", campaign_id, row_index
                )
                return

            # Nobody wants a collections call at four in the morning, and in India nobody
            # is allowed to place one. A row caught outside the window is booked for the
            # next opening rather than dialled or dropped.
            conf = await db.get_app_settings()
            if not _within_calling_hours(conf):
                start, end = _calling_window(conf)
                logger.warning(
                    "Campaign %s: row %s held, outside calling hours %02d:00-%02d:00",
                    campaign_id, row_index, start, end,
                )
                await db.update_datasheet_row(
                    datasheet_id, row_index, status="waiting",
                    next_attempt_at=_next_window_open(conf),
                )
                return

            # Building the handler used to sit outside the try below. Anything it raised
            # escaped to the gather that started this row, which logs and moves on, so the
            # counters stayed on "queued" and the run reported completed having dialled
            # nobody - with nothing on the record to say why.
            session_id = None
            try:
                # A fresh handler per call keeps session/audio state isolated; the Mongo
                # client is shared so concurrency does not multiply connections.
                handler = CallHandler(db=db)
                handler.llm.set_provider(llm_provider)
                handler.llm.set_model(llm_model)

                await db.update_datasheet_row(datasheet_id, row_index, status="calling")
                await db.shift_campaign_stat(campaign_id, "queued", "calling")

                cfg = resolve_template_config(
                    template, row_data, language=campaign_language, use_case=campaign_use_case
                )
                # The scoring prompt belongs to the variant this row resolved to, which is
                # only known once the config is resolved. It used to be assigned above from
                # a name that did not exist in this scope, so every row raised NameError
                # before it dialled and the run finished having called nobody.
                handler.analysis_prompt = cfg["analysis_prompt"]
                transformed_data = apply_format_value_transforms(template, row_data)
                handler.tts.set_voice(cfg["tts_voice_id"], cfg["tts_model_id"], cfg["tts_language"])
                handler.stt.set_language(cfg["stt_language"])

                try:
                    result = await handler.handle_outbound_call(
                        to_number=phone,
                        from_number=from_number,
                        system_prompt=cfg["system_prompt"],
                        format_values=transformed_data,
                        dynamic_fields=template.get("dynamic_fields", {}),
                        greeting_text=cfg["greeting_text"],
                        execution_id=execution_id,
                        provider=provider,
                    )
                except Exception as exc:
                    logger.warning("Campaign %s: call to %s failed: %s", campaign_id, phone, exc)
                    await db.update_datasheet_row(
                        datasheet_id, row_index, status="failed", disposition_code="ERROR"
                    )
                    await db.shift_campaign_stat(campaign_id, "calling", "failed")
                    return

                session_id = result.get("session_id")
                await db.update_datasheet_row(
                    datasheet_id,
                    row_index,
                    session_id=session_id,
                    language=cfg.get("language"),
                    use_case=cfg.get("use_case"),
                    agent_name=agent_name,
                )
                if session_id:
                    await call_registry.register_call(session_id, handler)
                    await db.mark_session_state(
                        session_id,
                        "active",
                        campaign_id=campaign_id,
                        datasheet_id=datasheet_id,
                        row_index=row_index,
                        language=cfg.get("language"),
                        use_case=cfg.get("use_case"),
                        agent_id=agent_id,
                        agent_name=agent_name,
                    )

                telephony_ok = result.get("mode") == "offline" or (
                    result.get("mode") == "telephony"
                    and result.get("telephony_response", {}).get("status") == "success"
                )

                if telephony_ok and result.get("mode") == "telephony":
                    await _wait_for_session_end(db, session_id, timeout=max_call_seconds)
                    # Enforce the duration cap: a call still live at the cap is hung up.
                    session = await db.get_session(session_id) if session_id else None
                    if session and session.get("active"):
                        logger.info(
                            "Campaign %s row %s hit the %ss duration cap; ending call",
                            campaign_id,
                            row_index,
                            max_call_seconds,
                        )
                        try:
                            await handler.hangup_for_duration_cap()
                        except Exception as exc:
                            logger.warning("Duration-cap hangup failed for %s: %s", session_id, exc)
                elif not telephony_ok:
                    await handler.finalize_call(session_id, status="failed", reason="telephony_rejected")

                await _finalize_row_from_session(
                    handler, datasheet_id, row_index, session_id if telephony_ok else None, cfg["analysis_prompt"]
                )

                if update_columns_mapping:
                    session_doc = await db.get_session(session_id) if session_id else None
                    mapped_updates = apply_update_columns_mapping(session_doc, update_columns_mapping)
                    if mapped_updates:
                        await db.update_datasheet_row(datasheet_id, row_index, **mapped_updates)

                refreshed_row = await db.get_datasheet_row(datasheet_id, row_index)
                final_status = (refreshed_row or {}).get("status") or "failed"
                await db.shift_campaign_stat(campaign_id, "calling", final_status)
                await _schedule_retry(db, datasheet_id, row_index, refreshed_row)
            finally:
                if session_id:
                    await call_registry.unregister_call(session_id)


async def run_campaign(
    shared_handler, campaign_id: str, retries_only: bool = False,
) -> None:
    set_control_state(campaign_id, RUNNING)
    if campaign_id in _running_campaigns:
        return
    _running_campaigns.add(campaign_id)
    db = shared_handler.db
    handler = shared_handler
    try:
        campaign = await db.get_campaign(campaign_id)
        if not campaign:
            return
        datasheet = await db.get_datasheet(campaign["datasheet_id"])
        template = await db.get_template(campaign["prompt_template_id"])
        if not datasheet or not template:
            await db.update_campaign(campaign_id, status="failed")
            return

        datasheet_template = await db.get_datasheet_template(datasheet.get("datasheet_template_id", ""))
        update_columns_mapping = (datasheet_template or {}).get("update_columns_mapping") or {}

        execution_id = campaign.get("execution_id")
        if not execution_id:
            execution_id = await db.create_execution(f"{campaign.get('name', 'campaign')} ({campaign_id})")
            if execution_id:
                await db.update_campaign(campaign_id, execution_id=execution_id)

        datasheet_id = datasheet["_id"]
        rows = datasheet.get("rows", [])
        if retries_only:
            # A sweep dials only what is due, so a campaign that finished days ago does not
            # start again from the top because one row came round for a second attempt.
            now = datetime.utcnow()
            rows = [
                r for r in rows
                if r.get("next_attempt_at") and r["next_attempt_at"] <= now
            ]
            if not rows:
                return
            logger.warning(
                "RETRY campaign %s: %s row(s) due for another attempt", campaign_id, len(rows)
            )
        limit = len(rows) if retries_only else (1 if campaign.get("mode") == "test" else len(rows))
        phone_column = template.get("phone_column")
        # A concrete language pins the whole run; "auto" lets each row pick its own via
        # the template's language column.
        campaign_use_case = campaign.get("use_case")
        campaign_language = campaign.get("language") or campaign.get("template_variant") or "auto"

        # Telephony/from-number now live in global settings rather than per template.
        app_settings = await db.get_app_settings()
        provider = app_settings.get("telephony_provider") or template.get("telephony_provider") or "twilio"
        from_number = app_settings.get("from_number") or template.get("from_number") or None

        # Agents are the worker pools. A campaign may be worked by several of them, so a
        # large daily datasheet is split across all available capacity instead of being
        # limited to a single pool.
        all_agents = await db.list_agents()
        requested_ids = campaign.get("agent_ids") or (
            [campaign["agent_id"]] if campaign.get("agent_id") else []
        )
        agents = [a for a in all_agents if str(a["_id"]) in {str(i) for i in requested_ids}]
        if not agents:
            agents = all_agents  # unassigned campaigns use every agent
        if not agents:
            # No agents configured at all: fall back to one default pool.
            agents = [
                {
                    "_id": "default",
                    "name": "default",
                    "max_concurrent_calls": call_registry.DEFAULT_AGENT_CAPACITY,
                    "max_call_seconds": app_settings.get("max_call_seconds") or CALL_END_TIMEOUT,
                }
            ]

        is_test = campaign.get("mode") == "test"
        if is_test:
            # A test run is a single probe call, so never fan out across pools.
            agents = agents[:1]

        # Build a slot ring weighted by capacity so a bigger pool receives
        # proportionally more rows, then hand rows out round-robin from it.
        ring: list[dict] = []
        for agent in agents:
            weight = 1 if is_test else max(1, int(agent.get("max_concurrent_calls") or 1))
            ring.extend([agent] * weight)

        total_capacity = 1 if is_test else sum(
            max(1, int(a.get("max_concurrent_calls") or 1)) for a in agents
        )

        semaphores = {}
        for agent in agents:
            cap = 1 if is_test else max(1, int(agent.get("max_concurrent_calls") or 1))
            semaphores[str(agent["_id"])] = call_registry.get_agent_semaphore(str(agent["_id"]), cap)

        await db.update_campaign(
            campaign_id,
            status="running",
            agent_ids=[str(a["_id"]) for a in agents],
            concurrency=total_capacity,
        )
        logger.info(
            "Campaign %s dialling %s rows across %s agent(s) [%s] total concurrency=%s",
            campaign_id,
            min(limit, len(rows)),
            len(agents),
            ", ".join(str(a.get("name")) for a in agents),
            total_capacity,
        )

        tasks = []
        for idx, row in enumerate(rows[:limit]):
            agent = ring[idx % len(ring)]
            agent_key = str(agent["_id"])
            tasks.append(
                _run_one_row(
                    db=db,
                    shared_handler=handler,
                    campaign_id=campaign_id,
                    datasheet_id=datasheet_id,
                    row=row,
                    template=template,
                    phone_column=phone_column,
                    campaign_language=campaign_language,
                    campaign_use_case=campaign_use_case,
                    provider=provider,
                    from_number=from_number,
                    execution_id=execution_id,
                    update_columns_mapping=update_columns_mapping,
                    llm_provider=app_settings.get("llm_provider"),
                    llm_model=app_settings.get("llm_model"),
                    max_call_seconds=int(
                        agent.get("max_call_seconds")
                        or app_settings.get("max_call_seconds")
                        or CALL_END_TIMEOUT
                    ),
                    semaphore=semaphores[agent_key],
                    agent_id=agent_key,
                    agent_name=str(agent.get("name") or agent_key),
                )
            )
        # return_exceptions keeps one bad row from cancelling the rest of the campaign.
        results = await asyncio.gather(*tasks, return_exceptions=True)
        failures: list[str] = []
        for row, outcome in zip(rows[:limit], results):
            if isinstance(outcome, Exception):
                logger.exception(
                    "Campaign %s row %s raised", campaign_id, row.get("row_index"), exc_info=outcome
                )
                failures.append(f"row {row.get('row_index')}: {type(outcome).__name__}: {outcome}")

        if retries_only:
            return
        stopped = control_state(campaign_id) == STOPPED
        # A run that dialled nobody used to finish saying "completed" with no hint that
        # anything had gone wrong - the reason existed only in a log nobody reads. Put the
        # first failures on the record so the run itself can say what happened.
        update: Dict[str, Any] = {"status": "stopped" if stopped else "completed"}
        update["last_error"] = "; ".join(failures[:3]) if failures else None
        update["failed_rows"] = len(failures)
        await db.update_campaign(campaign_id, **update)
        if failures:
            logger.warning(
                "Campaign %s finished with %s row(s) that never dialled: %s",
                campaign_id, len(failures), failures[0],
            )
    finally:
        _running_campaigns.discard(campaign_id)
        _campaign_control.pop(campaign_id, None)
