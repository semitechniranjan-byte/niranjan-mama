import logging
from typing import Dict, Optional

from urllib.parse import quote

import aiohttp

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings

logger = logging.getLogger(__name__)


class ExotelTelephonyService:
    def __init__(
        self,
        account_sid: Optional[str] = None,
        api_key: Optional[str] = None,
        api_token: Optional[str] = None,
        subdomain: Optional[str] = None,
        app_id: Optional[str] = None,
        webhook_url: Optional[str] = None,
    ) -> None:
        self.account_sid = account_sid or settings.EXOTEL_ACCOUNT_SID
        self.api_key = api_key or settings.EXOTEL_API_KEY
        self.api_token = api_token or settings.EXOTEL_API_TOKEN
        self.subdomain = subdomain or settings.EXOTEL_SUBDOMAIN
        self.app_id = app_id or settings.EXOTEL_APP_ID
        self.webhook_url = (webhook_url or settings.EXOTEL_WEBHOOK_BASE_URL).rstrip("/")

    def _validate(self) -> None:
        if not self.account_sid or not self.api_key or not self.api_token:
            raise RuntimeError("Exotel credentials are not configured")
        if not self.app_id:
            raise RuntimeError(
                "EXOTEL_APP_ID is not configured. Create a Flow (App Bazaar) in the Exotel "
                "dashboard with a Voicebot/Greeting applet, publish it, and set its App ID as "
                "EXOTEL_APP_ID in .env."
            )

    async def make_call(
        self, from_number: str, to_number: str, session_id: str, time_limit: int = 150
    ) -> Dict[str, object]:
        if not session_id:
            error_msg = "Session ID is required for outbound calls"
            logger.error(error_msg)
            return {"status": "error", "message": error_msg, "call_uuid": None, "session_id": session_id}

        try:
            self._validate()
            exophone = from_number or settings.EXOTEL_EXOPHONE
            payload = {
                "From": to_number,
                "CallerId": exophone,
                "Url": f"http://my.exotel.com/{self.account_sid}/exoml/start_voice/{self.app_id}",
                "CallType": "trans",
                "TimeLimit": str(time_limit),
                "TimeOut": "30",
                "CustomField": session_id,
                # Session ids start with "+" (the phone number). Unencoded, a "+" in a
                # query string decodes back as a space, so the callback never matched the
                # session and the recording URL was dropped.
                "StatusCallback": (
                    f"{self.webhook_url}/webhooks/exotel/status"
                    f"?session_id={quote(session_id, safe='')}"
                ),
                "Record": "true",
            }
            async with aiohttp.ClientSession() as session:
                url = f"https://{self.subdomain}/v1/Accounts/{self.account_sid}/Calls/connect.json"
                auth = aiohttp.BasicAuth(self.api_key, self.api_token)
                async with session.post(url, data=payload, auth=auth) as response:
                    response_text = await response.text()
                    try:
                        response_data = await response.json()
                    except aiohttp.ContentTypeError:
                        logger.warning("Exotel response not in JSON format: %s", response_text)
                        response_data = {"error": f"Invalid response: {response_text}"}

                    if response.status in (200, 201):
                        call_sid = (response_data.get("Call") or {}).get("Sid")
                        logger.info("Exotel call initiated: %s -> %s, SID: %s", exophone, to_number, call_sid)
                        return {
                            "status": "success",
                            "message": "Call initiated",
                            "call_uuid": call_sid,
                            "session_id": session_id,
                        }

                    logger.error("Exotel call initiation failed: %s", response_data)
                    return {
                        "status": "error",
                        "message": f"Call failed: {response_data}",
                        "call_uuid": None,
                        "session_id": session_id,
                    }
        except aiohttp.ClientError as exc:
            logger.error("HTTP error making Exotel call to %s: %s", to_number, exc)
            return {"status": "error", "message": f"HTTP error: {exc}", "call_uuid": None, "session_id": session_id}
        except Exception as exc:
            logger.error("Error making Exotel call to %s: %s", to_number, exc)
            return {"status": "error", "message": str(exc), "call_uuid": None, "session_id": session_id}

    async def hangup_call(self, call_sid: str) -> Dict[str, object]:
        try:
            self._validate()
            async with aiohttp.ClientSession() as session:
                url = f"https://{self.subdomain}/v1/Accounts/{self.account_sid}/Calls/{call_sid}.json"
                auth = aiohttp.BasicAuth(self.api_key, self.api_token)
                async with session.post(url, data={"Status": "completed"}, auth=auth) as response:
                    if response.status not in (200, 201):
                        text = await response.text()
                        raise RuntimeError(f"Exotel hangup failed: {text}")
                    logger.info("Exotel call %s terminated", call_sid)
                    return {"status": "success", "message": "Call terminated"}
        except Exception as exc:
            logger.error("Error hanging up Exotel call: %s", exc)
            return {"status": "error", "message": str(exc)}
