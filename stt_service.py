import logging
from typing import Optional
import aiohttp

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings

logger = logging.getLogger(__name__)

DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen"


class DeepgramSTTService:
    def __init__(self) -> None:
        self.api_key = settings.DEEPGRAM_API_KEY
        self.model = settings.DEEPGRAM_MODEL
        self.language = settings.DEEPGRAM_LANGUAGE
        self.session: Optional[aiohttp.ClientSession] = None
        self.ready = False
        # Confidence of the most recent transcription (0-1), used to drop background noise
        # that the model transcribes as plausible-looking words.
        self.last_confidence = 0.0

    def _validate(self) -> None:
        if not self.api_key:
            raise RuntimeError("Deepgram credentials are not configured")

    def set_language(self, language: str = None) -> None:
        if language:
            self.language = language

    async def initialize(self) -> bool:
        try:
            self._validate()
            # Reuse the existing session across calls; recreating it per call leaks the
            # old one ("Unclosed client session" warnings).
            if self.session is None or self.session.closed:
                self.session = aiohttp.ClientSession()
            self.ready = True
            logger.info("Deepgram STT initialized")
            return True
        except Exception as exc:
            logger.warning("Deepgram STT initialization failed: %s", exc)
            self.ready = False
            return False

    async def transcribe_audio_bytes(self, audio_bytes: bytes) -> str:
        if not self.ready or self.session is None:
            await self.initialize()
        self._validate()

        params = {"model": self.model, "smart_format": "true"}
        if self.language:
            params["language"] = self.language
        headers = {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": "audio/wav",
        }
        async with self.session.post(
            DEEPGRAM_LISTEN_URL, params=params, headers=headers, data=audio_bytes
        ) as response:
            if response.status != 200:
                raise RuntimeError(await response.text())
            payload = await response.json()

        try:
            transcript = payload["results"]["channels"][0]["alternatives"][0]["transcript"]
        except (KeyError, IndexError) as exc:
            raise RuntimeError(f"Unexpected Deepgram response: {payload}") from exc
        return transcript.strip()

    async def transcribe_audio_bytes_raw(self, audio_bytes: bytes, encoding: str = "mulaw", sample_rate: int = 8000) -> str:
        """Like transcribe_audio_bytes but for headerless raw audio (e.g. Twilio Media Stream mu-law chunks)."""
        if not self.ready or self.session is None:
            await self.initialize()
        self._validate()

        params = {"model": self.model, "smart_format": "true", "encoding": encoding, "sample_rate": str(sample_rate)}
        if self.language:
            params["language"] = self.language
        headers = {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": "audio/mulaw" if encoding == "mulaw" else "application/octet-stream",
        }
        async with self.session.post(
            DEEPGRAM_LISTEN_URL, params=params, headers=headers, data=audio_bytes
        ) as response:
            if response.status != 200:
                raise RuntimeError(await response.text())
            payload = await response.json()

        try:
            alt = payload["results"]["channels"][0]["alternatives"][0]
        except (KeyError, IndexError) as exc:
            raise RuntimeError(f"Unexpected Deepgram response: {payload}") from exc
        # Confidence is the strongest signal for rejecting background noise that the model
        # "hears" as words, so it is returned alongside the text.
        self.last_confidence = float(alt.get("confidence") or 0.0)
        return (alt.get("transcript") or "").strip()

    async def close(self) -> None:
        if self.session:
            await self.session.close()
            self.session = None
        self.ready = False
