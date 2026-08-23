"""Deepgram streaming speech-to-text over a persistent WebSocket.

The batch path (stt_service.DeepgramSTTService) waits for the caller to stop talking,
then uploads the whole utterance and waits for a reply. Both halves are serial and both
were expensive on live calls: ~300ms of silence detection plus a round trip that measured
anywhere from 337ms to 3858ms.

Streaming removes both. Audio goes to Deepgram while the caller is still speaking, and
Deepgram - not us - decides where the sentence ends, so the transcript is essentially
ready the moment they stop.

The socket is per call. If it cannot be opened or drops mid-call the caller falls back to
the batch path rather than losing the turn, so this can be switched on without risking a
demo (see settings.STT_STREAMING).
"""

import asyncio
import json
import logging
from typing import Awaitable, Callable, Optional
from urllib.parse import urlencode

import websockets

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings

logger = logging.getLogger(__name__)

DEEPGRAM_STREAM_URL = "wss://api.deepgram.com/v1/listen"

# Silence, in ms, after which Deepgram calls the utterance finished. Deepgram applies this
# to audio it has already received, so unlike our local VAD it costs no extra wall time.
ENDPOINTING_MS = 300
# Backstop: Deepgram emits UtteranceEnd if endpointing never fires (e.g. constant
# background noise keeps the channel "active"), so a turn cannot hang forever.
UTTERANCE_END_MS = 1000


class DeepgramStreamingSTT:
    """One live transcription socket for one call."""

    def __init__(self, sample_rate: int = 8000, encoding: str = "linear16", language: Optional[str] = None) -> None:
        self.api_key = settings.DEEPGRAM_API_KEY
        self.model = settings.DEEPGRAM_MODEL
        self.language = language or settings.DEEPGRAM_LANGUAGE
        self.sample_rate = sample_rate
        self.encoding = encoding
        self._ws = None
        self._reader: Optional[asyncio.Task] = None
        self.connected = False
        # Confidence of the most recent final transcript, for the noise filter.
        self.last_confidence = 0.0
        # Stabilised fragments awaiting a sentence boundary.
        self._pending: list[str] = []

    def _url(self) -> str:
        params = {
            "model": self.model,
            "language": self.language,
            "encoding": self.encoding,
            "sample_rate": str(self.sample_rate),
            "channels": "1",
            "smart_format": "true",
            "interim_results": "true",
            "endpointing": str(ENDPOINTING_MS),
            "utterance_end_ms": str(UTTERANCE_END_MS),
            "vad_events": "true",
        }
        return f"{DEEPGRAM_STREAM_URL}?{urlencode(params)}"

    async def connect(self, on_utterance: Callable[[str, float], Awaitable[None]]) -> bool:
        """Open the socket. `on_utterance(transcript, confidence)` fires once per sentence."""
        if not self.api_key:
            logger.warning("STT-STREAM: no Deepgram key, staying on the batch path")
            return False
        try:
            self._ws = await websockets.connect(
                self._url(),
                additional_headers={"Authorization": f"Token {self.api_key}"},
                open_timeout=8,
                ping_interval=5,
                ping_timeout=20,
                max_size=None,
            )
            self.connected = True
            self._reader = asyncio.create_task(self._read_loop(on_utterance))
            logger.warning(
                "STT-STREAM connected: model=%s language=%s %sHz",
                self.model, self.language, self.sample_rate,
            )
            return True
        except Exception as exc:
            logger.warning("STT-STREAM connect failed (%s); using batch path", exc)
            self.connected = False
            return False

    async def send_audio(self, chunk: bytes) -> None:
        """Forward one frame. Never raises: a dead socket must not break the call."""
        if not self.connected or self._ws is None:
            return
        try:
            await self._ws.send(chunk)
        except Exception as exc:
            logger.warning("STT-STREAM send failed, closing: %s", exc)
            self.connected = False

    async def _read_loop(self, on_utterance: Callable[[str, float], Awaitable[None]]) -> None:
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue

                kind = msg.get("type")
                if kind == "Results":
                    alt = (
                        (msg.get("channel") or {}).get("alternatives") or [{}]
                    )[0]
                    transcript = (alt.get("transcript") or "").strip()
                    if not transcript:
                        continue
                    if msg.get("speech_final"):
                        # A completed sentence: emit it and drop anything held back.
                        pending = " ".join(self._pending + [transcript]).strip()
                        self._pending = []
                        self.last_confidence = float(alt.get("confidence") or 0.0)
                        await on_utterance(pending, self.last_confidence)
                    elif msg.get("is_final"):
                        # Stabilised, but Deepgram has not called the sentence finished.
                        # Hold it rather than dropping it - on a noisy line endpointing may
                        # never fire, and discarding these loses the turn entirely.
                        self._pending.append(transcript)
                        self.last_confidence = float(alt.get("confidence") or 0.0)
                elif kind == "UtteranceEnd":
                    # Endpointing did not fire - continuous background noise keeps the
                    # channel "active". This is the backstop: emit whatever was held back
                    # so a caller in a noisy place is not simply ignored.
                    if self._pending:
                        pending = " ".join(self._pending).strip()
                        self._pending = []
                        logger.warning("STT-STREAM utterance end, flushing %r", pending[:60])
                        await on_utterance(pending, self.last_confidence)
        except Exception as exc:
            logger.info("STT-STREAM read loop ended: %s", exc)
        finally:
            self.connected = False

    async def close(self) -> None:
        if self._ws is not None:
            try:
                # Tells Deepgram to flush anything buffered before hanging up.
                await self._ws.send(json.dumps({"type": "CloseStream"}))
            except Exception:
                pass
            try:
                await self._ws.close()
            except Exception:
                pass
        if self._reader is not None:
            self._reader.cancel()
        self._ws = None
        self._reader = None
        self.connected = False
