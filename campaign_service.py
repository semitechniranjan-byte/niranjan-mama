import asyncio
import json
import logging
from datetime import datetime
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


async def _run_post_call_analysis(handler, session_id: str, analysis_prompt: Optional[str]) -> Dict[str, Any]:
    if not analysis_prompt or not handler.llm.ready:
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
        response = await handler.llm.client.chat.completions.create(
            model=getattr(handler.llm, "model", None) or _groq_model(),
            messages=[{"role": "user", "content": filled_prompt}],
            temperature=0.1,
            max_tokens=1200,
        )
        content = response.choices[0].message.content or "{}"
        content = content.strip()
        if content.startswith("```"):
            content = content.strip("`")
            if content.lower().startswith("json"):
                content = content[4:]
        return _enforce_disposition_rules(json.loads(content), session_id)
    except Exception as exc:
        logger.warning("Post-call analysis failed for session %s: %s", session_id, exc)
        return {}


# Day windows the business rules define for a payment commitment.
PTP_MAX_DAYS = 2      # 0-2 days  -> PTP
FPTP_MAX_DAYS = 7     # 3-7 days  -> FPTP; beyond that the promise counts as a refusal


def _enforce_disposition_rules(result: Dict[str, Any], session_id: str) -> Dict[str, Any]:
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

    if days > FPTP_MAX_DAYS:
        expected = "RTP"
    elif days > PTP_MAX_DAYS:
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

    async with semaphore:
        # A fresh handler per call keeps session/audio state isolated; the Mongo client is
        # shared so concurrency does not multiply connections.
        handler = CallHandler(db=db)
        handler.llm.set_provider(llm_provider)
        handler.llm.set_model(llm_model)
        session_id = None
        try:
            await db.update_datasheet_row(datasheet_id, row_index, status="calling")
            await db.shift_campaign_stat(campaign_id, "queued", "calling")

            cfg = resolve_template_config(
                template, row_data, language=campaign_language, use_case=campaign_use_case
            )
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
        finally:
            if session_id:
                await call_registry.unregister_call(session_id)


async def run_campaign(shared_handler, campaign_id: str) -> None:
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
        limit = 1 if campaign.get("mode") == "test" else len(rows)
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
        for row, outcome in zip(rows[:limit], results):
            if isinstance(outcome, Exception):
                logger.exception(
                    "Campaign %s row %s raised", campaign_id, row.get("row_index"), exc_info=outcome
                )

        await db.update_campaign(campaign_id, status="completed")
    finally:
        _running_campaigns.discard(campaign_id)
