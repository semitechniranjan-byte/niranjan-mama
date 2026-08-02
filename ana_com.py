import logging
from datetime import datetime

logger = logging.getLogger(__name__)

db_service = None


def init_conversation_analyzer(db_svc):
    global db_service
    db_service = db_svc
    logger.info("Conversation analyzer module initialized for minimal voice clone")


def get_default_metadata(reason="inconclusive") -> dict:
    return {
        "commitment_date": "inconclusive",
        "language_detected": "inconclusive",
        "interruption_pattern": "inconclusive",
        "information_status": "inconclusive",
        "user_cooperation_level": "inconclusive",
        "conversation_stage": "inconclusive",
        "disposition_code": "inconclusive",
        "interruption_count": -1,
        "conversation_strategy": "inconclusive",
        "customer_question_pending": "inconclusive",
        "outcome": "inconclusive",
        "analysis_status": reason,
    }


async def analyze_conversation_for_completed_call(conversation_history, selected: str = "default"):
    if not conversation_history:
        return get_default_metadata("no_history")

    user_turns = [item.get("content", "") for item in conversation_history if item.get("role") == "user"]
    assistant_turns = [item.get("content", "") for item in conversation_history if item.get("role") == "assistant"]
    last_user = " ".join(user_turns[-3:]) if user_turns else ""
    last_assistant = " ".join(assistant_turns[-3:]) if assistant_turns else ""

    outcome = "PTP" if "pay" in last_user.lower() or "pay" in last_assistant.lower() else "CLBK"
    disposition = "PTP" if outcome == "PTP" else "CLBK"

    return {
        "commitment_date": "None",
        "language_detected": "english",
        "interruption_pattern": "none",
        "information_status": "none",
        "user_cooperation_level": "normal",
        "conversation_stage": "information_sharing",
        "disposition_code": disposition,
        "interruption_count": 0,
        "conversation_strategy": "standard",
        "customer_question_pending": "none",
        "outcome": disposition,
        "analysis_status": "completed",
        "selected": selected,
        "message_count": len(conversation_history),
        "summarized_at": datetime.utcnow().isoformat(),
    }
