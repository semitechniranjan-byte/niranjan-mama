import logging
from typing import Dict, Optional
from urllib.parse import quote

import aiohttp

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings

logger = logging.getLogger(__name__)


class TwilioTelephonyService:
    def __init__(
        self,
        account_sid: Optional[str] = None,
        auth_token: Optional[str] = None,
        webhook_url: Optional[str] = None,
    ):
        self.account_sid = account_sid or settings.TWILIO_ACCOUNT_SID
        self.auth_token = auth_token or settings.TWILIO_AUTH_TOKEN
        self.webhook_url = (webhook_url or settings.TWILIO_WEBHOOK_BASE_URL).rstrip("/")

    def _validate(self) -> None:
        if not self.account_sid or not self.auth_token:
            raise RuntimeError("Twilio credentials are not configured")

    async def make_call(
        self, from_number: str, to_number: str, session_id: str, time_limit: int = 150
    ) -> Dict[str, object]:
        if not session_id:
            error_msg = "Session ID is required for outbound calls"
            logger.error(error_msg)
            return {"status": "error", "message": error_msg, "call_uuid": None, "session_id": session_id}

        try:
            self._validate()
            # Session ids start with "+" (the phone number). Unencoded, a "+" in a query
            # string decodes back as a space, so none of these callbacks matched their
            # session. Same bug that silently dropped every Exotel recording.
            sid_q = quote(session_id, safe="")
            # Fall back to the configured Twilio number the way ExotelService falls back to
            # its ExoPhone. Without this, a blank from_number sent an empty "From" — and a
            # from_number left over from the other provider was sent verbatim and rejected.
            caller_id = from_number or self.phone_number
            payload = {
                "From": caller_id,
                "To": to_number,
                "Url": f"{self.webhook_url}/webhook?session_id={sid_q}",
                "Method": "POST",
                "StatusCallback": f"{self.webhook_url}/hangup-callback?session_id={sid_q}",
                "StatusCallbackMethod": "POST",
                "TimeLimit": time_limit,
                "Record": "true",
                "RecordingStatusCallback": f"{self.webhook_url}/recording?session_id={sid_q}",
                "RecordingStatusCallbackMethod": "POST",
            }
            async with aiohttp.ClientSession() as session:
                url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Calls.json"
                auth = aiohttp.BasicAuth(self.account_sid, self.auth_token)
                async with session.post(url, data=payload, auth=auth) as response:
                    response_text = await response.text()
                    try:
                        response_data = await response.json()
                    except aiohttp.ContentTypeError:
                        logger.warning("Response not in JSON format: %s", response_text)
                        response_data = {"error": f"Invalid response: {response_text}"}

                    if response.status in (200, 201):
                        call_sid = response_data.get("sid")
                        logger.info("Call initiated: %s -> %s, SID: %s", caller_id, to_number, call_sid)
                        return {
                            "status": "success",
                            "message": "Call initiated",
                            "call_uuid": call_sid,
                            "session_id": session_id,
                        }

                    logger.error("Call initiation failed: %s", response_data)
                    return {
                        "status": "error",
                        "message": f"Call failed: {response_data.get('message', response_data.get('error', 'Unknown error'))}",
                        "call_uuid": None,
                        "session_id": session_id,
                    }
        except aiohttp.ClientError as exc:
            logger.error("HTTP error making call to %s: %s", to_number, exc)
            return {"status": "error", "message": f"HTTP error: {exc}", "call_uuid": None, "session_id": session_id}
        except Exception as exc:
            logger.error("Error making call to %s: %s", to_number, exc)
            return {"status": "error", "message": str(exc), "call_uuid": None, "session_id": session_id}

    async def hangup_call(self, call_sid: str) -> Dict[str, object]:
        try:
            self._validate()
            async with aiohttp.ClientSession() as session:
                url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Calls/{call_sid}.json"
                auth = aiohttp.BasicAuth(self.account_sid, self.auth_token)
                async with session.post(url, data={"Status": "completed"}, auth=auth) as response:
                    if response.status not in (200, 201):
                        text = await response.text()
                        raise RuntimeError(f"Twilio hangup failed: {text}")
                    logger.info("Call %s terminated", call_sid)
                    return {"status": "success", "message": "Call terminated"}
        except Exception as exc:
            logger.error("Error hanging up call: %s", exc)
            return {"status": "error", "message": str(exc)}
