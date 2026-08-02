"""Plivo voice provider: outbound calls plus the PlivoXML that opens a bidirectional
AudioStream back to this server.

Plivo differs from Twilio and Exotel in three ways that matter here:

* The create-call response returns a `request_uuid`, not the `call_uuid`. The real
  call_uuid only arrives on the answer/hangup callback, so hanging up early has to wait
  for that callback to land (see CallHandler.call_sid).
* Outbound audio is sent as a `playAudio` event, not a `media` event.
* Buffered audio is dropped with `clearAudio`, not `clear`.
"""

import logging
from typing import Dict, Optional
from urllib.parse import quote
from xml.sax.saxutils import escape as xml_escape

import aiohttp

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings

logger = logging.getLogger(__name__)

PLIVO_API_BASE = "https://api.plivo.com/v1/Account"


class PlivoVoiceService:
    def __init__(self) -> None:
        self.auth_id = settings.PLIVO_AUTH_ID
        self.auth_token = settings.PLIVO_AUTH_TOKEN
        self.phone_number = settings.PLIVO_PHONE_NUMBER
        # Falls back to the shared tunnel so a single ngrok URL serves every provider.
        self.webhook_url = (
            settings.PLIVO_WEBHOOK_BASE_URL or settings.TWILIO_WEBHOOK_BASE_URL or ""
        )
        self.content_type = settings.PLIVO_STREAM_CONTENT_TYPE

    def _validate(self) -> None:
        if not self.auth_id or not self.auth_token:
            raise RuntimeError("Plivo credentials are not configured")

    @property
    def ready(self) -> bool:
        return bool(self.auth_id and self.auth_token)

    def _auth(self) -> aiohttp.BasicAuth:
        return aiohttp.BasicAuth(self.auth_id, self.auth_token)

    async def make_call(
        self, from_number: str, to_number: str, session_id: str, time_limit: int = 150
    ) -> Dict[str, object]:
        if not session_id:
            error_msg = "Session ID is required for outbound calls"
            logger.error(error_msg)
            return {"status": "error", "message": error_msg, "call_uuid": None, "session_id": session_id}

        try:
            self._validate()
            caller_id = from_number or self.phone_number
            if not caller_id:
                return {
                    "status": "error",
                    "message": "No Plivo caller id configured (set PLIVO_PHONE_NUMBER)",
                    "call_uuid": None,
                    "session_id": session_id,
                }

            # Session ids start with "+" (the phone number); unencoded it decodes back as
            # a space and the callback never matches its session.
            sid_q = quote(session_id, safe="")
            payload = {
                "from": caller_id.lstrip("+"),
                "to": to_number.lstrip("+"),
                "answer_url": f"{self.webhook_url}/webhooks/plivo/answer?session_id={sid_q}",
                "answer_method": "POST",
                "hangup_url": f"{self.webhook_url}/webhooks/plivo/hangup?session_id={sid_q}",
                "hangup_method": "POST",
                "time_limit": time_limit,
                "ring_timeout": 30,
            }

            async with aiohttp.ClientSession() as session:
                url = f"{PLIVO_API_BASE}/{self.auth_id}/Call/"
                async with session.post(url, json=payload, auth=self._auth()) as response:
                    response_text = await response.text()
                    try:
                        response_data = await response.json()
                    except aiohttp.ContentTypeError:
                        logger.warning("Plivo response not in JSON format: %s", response_text)
                        response_data = {"error": f"Invalid response: {response_text}"}

                    if response.status in (200, 201, 202):
                        # Plivo hands back a request_uuid now; the call_uuid follows on the
                        # answer callback, so it is recorded there instead.
                        request_uuid = response_data.get("request_uuid")
                        logger.info(
                            "Plivo call initiated: %s -> %s, request_uuid: %s",
                            caller_id, to_number, request_uuid,
                        )
                        return {
                            "status": "success",
                            "message": "Call initiated",
                            "call_uuid": request_uuid,
                            "session_id": session_id,
                        }

                    logger.error("Plivo call initiation failed: %s", response_data)
                    return {
                        "status": "error",
                        "message": f"Call failed: {response_data}",
                        "call_uuid": None,
                        "session_id": session_id,
                    }
        except Exception as exc:
            logger.error("Plivo call initiation error: %s", exc)
            return {"status": "error", "message": str(exc), "call_uuid": None, "session_id": session_id}

    async def hangup_call(self, call_uuid: str) -> bool:
        if not call_uuid:
            return False
        try:
            self._validate()
            async with aiohttp.ClientSession() as session:
                url = f"{PLIVO_API_BASE}/{self.auth_id}/Call/{call_uuid}/"
                async with session.delete(url, auth=self._auth()) as response:
                    if response.status in (200, 202, 204):
                        return True
                    logger.warning(
                        "Plivo hangup failed for %s: HTTP %s %s",
                        call_uuid, response.status, (await response.text())[:200],
                    )
                    return False
        except Exception as exc:
            logger.warning("Plivo hangup error for %s: %s", call_uuid, exc)
            return False

    def build_stream_response(self, session_id: str) -> str:
        """PlivoXML that opens a bidirectional AudioStream to /plivo-stream.

        `keepCallAlive` stops Plivo from hanging up the moment the XML is exhausted, which
        is what keeps the call open for the length of the conversation.
        """
        ws_base = (
            (self.webhook_url or "")
            .rstrip("/")
            .replace("https://", "wss://")
            .replace("http://", "ws://")
        )
        stream_url = xml_escape(f"{ws_base}/plivo-stream?session_id={quote(session_id, safe='')}")
        content_type = xml_escape(self.content_type)
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<Response>\n"
            f'  <Stream bidirectional="true" keepCallAlive="true" '
            f'contentType="{content_type}" '
            f'audioTrack="inbound" statusCallbackMethod="POST">{stream_url}</Stream>\n'
            "</Response>"
        )

    def build_speak_response(self, text: str) -> str:
        """Plain <Speak> fallback, used only when the stream cannot be opened."""
        return (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<Response>\n"
            f"  <Speak>{xml_escape(text)}</Speak>\n"
            "</Response>"
        )
