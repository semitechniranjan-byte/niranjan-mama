import logging
import aiohttp

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings

logger = logging.getLogger(__name__)


class CartesiaTTSService:
    def __init__(self) -> None:
        self.api_key = settings.CARTESIA_API_KEY
        self.voice_id = settings.CARTESIA_VOICE_ID
        self.model_id = settings.CARTESIA_MODEL_ID
        self.language = settings.CARTESIA_LANGUAGE
        self.session = None
        self.ready = False
        self.tts_in_progress = False
        self._full_text = ""
        self._last_spoken_text = ""

    def _validate(self) -> None:
        if not self.api_key or not self.voice_id:
            raise RuntimeError("Cartesia credentials are not configured")

    def set_voice(self, voice_id: str = None, model_id: str = None, language: str = None) -> None:
        if voice_id:
            self.voice_id = voice_id
        if model_id:
            self.model_id = model_id
        if language:
            self.language = language

    async def initialize(self) -> bool:
        self._validate()
        # Reuse the existing session across calls; recreating it per call leaks the old
        # one ("Unclosed client session" warnings).
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession()
        self.ready = True
        return True

    async def synthesize(self, text: str, callback=None, encoding: str = "pcm_mulaw", sample_rate: int = 8000) -> bytes:
        if not self.ready or self.session is None:
            await self.initialize()
        self._validate()

        self.tts_in_progress = True
        self._full_text = text
        self._last_spoken_text = ""

        payload = {
            "model_id": self.model_id,
            "transcript": text,
            "voice": {"mode": "id", "id": self.voice_id},
            "output_format": {"container": "raw", "encoding": encoding, "sample_rate": sample_rate},
            "language": self.language,
        }
        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
            "Cartesia-Version": "2026-03-01",
        }
        chunks = []
        async with self.session.post("https://api.cartesia.ai/tts/bytes", json=payload, headers=headers) as response:
            if response.status != 200:
                raise RuntimeError(await response.text())
            async for chunk in response.content.iter_any():
                if chunk:
                    if not self.tts_in_progress:
                        break
                    chunks.append(chunk)
                    if callback is not None:
                        await callback(chunk)
        self._last_spoken_text = text
        self.tts_in_progress = False
        return b"".join(chunks)

    async def stop(self) -> None:
        self.tts_in_progress = False
        self._last_spoken_text = self._full_text

    def get_last_spoken_text(self) -> str:
        return self._last_spoken_text

    async def close(self) -> None:
        if self.session:
            await self.session.close()
            self.session = None
        self.ready = False
        self.tts_in_progress = False
