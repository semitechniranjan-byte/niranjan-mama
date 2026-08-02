import logging
from urllib.parse import quote
from xml.sax.saxutils import escape as xml_escape

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings

logger = logging.getLogger(__name__)


class TwilioVoiceService:
    def __init__(self) -> None:
        self.account_sid = settings.TWILIO_ACCOUNT_SID
        self.auth_token = settings.TWILIO_AUTH_TOKEN
        self.phone_number = settings.TWILIO_PHONE_NUMBER
        self.webhook_url = settings.TWILIO_WEBHOOK_BASE_URL

    def _validate(self) -> None:
        if not self.account_sid or not self.auth_token:
            raise RuntimeError("Twilio credentials are not configured")

    def build_inbound_response(self, text: str) -> str:
        escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Response>
  <Say>{escaped}</Say>
</Response>"""

    def build_stream_response(self, session_id: str) -> str:
        """Opens a bidirectional Media Stream to /stream so the bot can speak with
        real Deepgram/Cartesia audio instead of Twilio's own <Say> voice."""
        ws_base = (self.webhook_url or "").rstrip("/").replace("https://", "wss://").replace("http://", "ws://")
        # Session ids start with "+" (the phone number). Unencoded, a "+" in a query
        # string decodes back as a space, so the stream never matched its session in the
        # call registry and fell through to the fallback handler. Same bug that broke the
        # Exotel status callback.
        stream_url = xml_escape(f"{ws_base}/stream?session_id={quote(session_id, safe='')}")
        return f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Response>
  <Connect>
    <Stream url=\"{stream_url}\" />
  </Connect>
</Response>"""
