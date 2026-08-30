import asyncio
import base64
import logging
import re
import time
from typing import Any, Dict, List, Optional
from fastapi import HTTPException

try:
    from .db_service import DatabaseService
    from .stt_service import DeepgramSTTService
    from .stt_stream_service import DeepgramStreamingSTT
    from .llm_service import GroqLLMService
    from .tts_service import CartesiaTTSService
    from .twilio_service import TwilioVoiceService
    from .telephony_service import TwilioTelephonyService
    from .exotel_service import ExotelTelephonyService
    from .plivo_service import PlivoVoiceService
    from .vobiz_service import VobizVoiceService
    from .config import settings
    from .helper_utils import format_prompt_with_placeholders
    from .audio_utils import mulaw_to_linear16, rms
except ImportError:  # pragma: no cover
    from db_service import DatabaseService
    from stt_service import DeepgramSTTService
    from stt_stream_service import DeepgramStreamingSTT
    from llm_service import GroqLLMService
    from tts_service import CartesiaTTSService
    from twilio_service import TwilioVoiceService
    from telephony_service import TwilioTelephonyService
    from exotel_service import ExotelTelephonyService
    from plivo_service import PlivoVoiceService
    from vobiz_service import VobizVoiceService
    from config import settings
    from helper_utils import format_prompt_with_placeholders
    from audio_utils import mulaw_to_linear16, rms

logger = logging.getLogger(__name__)

# Twilio Media Streams send 8kHz mu-law audio in ~20ms frames (160 bytes each).
VAD_SILENCE_RMS_THRESHOLD = 400
VAD_SILENCE_FRAMES_TO_END = 15  # ~300ms of silence ends an utterance. 25 (500ms) was
# half a second of dead air on every single turn before the bot even started thinking.
VAD_MIN_SPEECH_FRAMES = 3
# Deepgram returned an empty transcript for every utterance under roughly half a
# second in live calls, so those round trips cost latency and quota for nothing.
# Expressed as seconds and converted per stream, since the rate varies by provider.
VAD_MIN_UTTERANCE_SECONDS = 0.4
# Sustained speech required to talk over the bot. 3 frames (60ms) fired on line noise and
# chopped the bot mid-sentence; ~160ms is a real word.
VAD_BARGEIN_SPEECH_FRAMES = 8
# The caller's last word, and the echo of our own audio, keep arriving for a moment
# after the bot starts replying. Without a grace window that tail counted as an
# interruption and cut the reply off after ~160ms - the caller heard the bot start,
# stop, and then silence.
BARGEIN_GRACE_SECONDS = 0.8
# After the bot is cut off, the caller's words still have to survive transcription and
# the noise filter. When they do not - a cough, a half word, a lorry going past - the
# bot has already stopped talking and nothing restarts it, so the line just dies until
# the silence timer fires twelve seconds later. This is how long to wait before
# inviting them to continue.
INTERRUPTION_RECOVERY_SECONDS = 2.5
INTERRUPTION_RECOVERY_LINE = "Ji, boliye?"

# ---- Background-noise defences -------------------------------------------------------
# Indian mobile calls are frequently made from traffic, shops and rooms with a TV on. A
# fixed threshold either ignores a softly-spoken caller or lets ambient noise through as
# "speech", so the floor is measured per call and the threshold rides above it.
NOISE_CALIBRATION_FRAMES = 40          # ~800ms of ambient audio sampled at call start
NOISE_FLOOR_MULTIPLIER = 3.0           # speech must be this much louder than the ambience
VAD_MIN_THRESHOLD = 400                # never drop below the original fixed threshold
VAD_MAX_THRESHOLD = 4000               # never get so strict that a quiet caller is ignored

# A transcript is only believed if Deepgram is reasonably sure of it. Noise typically
# comes back as confident-looking short filler, so length and content are checked too.
STT_MIN_CONFIDENCE = 0.55
STT_MIN_CHARS = 2

# Things Deepgram commonly emits for noise, breathing or music. On their own they carry no
# intent, so they are dropped rather than sent to the LLM as a user turn.
NOISE_TRANSCRIPTS = {
    "you", "thank you", "thanks", "bye", "okay", "ok", "uh", "um", "hmm", "mm", "mmm",
    "ah", "oh", "eh", "huh", "yeah", "yes", "no", ".", "..", "...", "?", "!",
    "thank you.", "you.", "bye.", "so", "the", "a", "i", "hi",
    "धन्यवाद", "शुक्रिया", "हम्म", "अच्छा", "हाँ", "हां", "नहीं", "ओह", "अरे",
}

# Network announcements the carrier plays into the call. They transcribe cleanly and at
# high confidence, so nothing else catches them, and the agent then answers the operator
# instead of the customer. Matched as substrings because the wording varies by circle.
CARRIER_ANNOUNCEMENTS = (
    "hold पर रखा", "line पर बने", "कृपया line",
    "call को hold", "व्यक्ति से बात कर रहे हैं",
    "is now being recorded", "call is being recorded",
    "switched off", "out of coverage", "not reachable",
    "स्विच ऑफ", "नेटवर्क कवरेज",
)

# A single turn must never leave the caller in silence. Well above the ~1s a healthy
# reply takes, but far below the 27s seen when the free LLM tier throttles.
# Two shots at a reply rather than one long wait. The free model tier throttles in
# short bursts, so a second attempt - on a different provider - usually lands where
# waiting longer on the first would not have.
# Waiting out the primary before even starting the backup put the whole timeout on the
# caller's ear: a throttled turn cost 4.8s where a healthy one cost 0.76s. The backup is
# now started while the primary is still running, and the first usable answer wins.
#
# The window sits above the primary's normal spread, not below it. Measured on the real
# 2992-character prompt: 941/988/1032/1053/1121/1142/1201/1211/1400/1479ms. At 0.8s the
# hedge fired on every single turn, doubling the model calls to arrive at the same moment,
# because a ~1.1s answer is this model working normally rather than stalling. At 1.5s it
# fires on roughly the slowest tenth, which is what a hedge is for.
LLM_HEDGE_AFTER_SECONDS = 1.5
LLM_TOTAL_DEADLINE_SECONDS = 4.0
LLM_TURN_TIMEOUT_SECONDS = 7.0  # kept for the silence path

# Said only when both providers fail. Deliberately does not advance the script: an
# earlier version asked for a payment date, which skipped the introduction entirely
# and left the customer wondering who was calling.
LLM_STALL_LINE = "Ek second, line thodi slow hai."

# Spoken when the line goes quiet. Both were English, which is jarring on a Hindi
# call, and the nudge defaulted to the greeting so the bot re-asked the caller's name.
SILENCE_NUDGE = "Hello, aap sun rahe hain?"
SILENCE_GOODBYE = "Koi jawab nahi mila. Hum aapko baad mein call karenge, aapka din shubh rahe, bye!"

# The script always signs off with "aapka din shubh rahe, bye!". Matching the phrase
# rather than the bare word "bye" avoids ending the call when it appears mid-sentence.
CLOSING_MARKERS = ("din shubh rahe", "bye!", "shubh rahe, bye")

# One 20ms frame of outbound audio: 160 samples of 16-bit 8kHz PCM.
OUT_FRAME_BYTES = 320


class CallHandler:
    """Drives one phone call end to end.

    Historically a single instance served every call, which forced calls to run one at a
    time. Instances are now created per call (see call_registry) so a campaign can dial
    concurrently; the MongoDB client is injected so all of them share one connection pool.
    """

    def __init__(self, db: Optional[DatabaseService] = None) -> None:
        self.db = db or DatabaseService()
        self.llm = GroqLLMService()
        self.stt = DeepgramSTTService()
        self.tts = CartesiaTTSService()
        self.telephony_xml = TwilioVoiceService()
        self.telephony = TwilioTelephonyService()
        self.telephony_exotel = ExotelTelephonyService()
        self.telephony_plivo = PlivoVoiceService()
        self.telephony_vobiz = VobizVoiceService()
        self.initialized = False
        self.session_id: Optional[str] = None
        self.greeting_text = "Hello, I am your voice assistant. How can I help you today?"
        self.system_prompt_template: Optional[str] = None
        self.format_values: Dict[str, Any] = {}
        self.dynamic_fields: Dict[str, Dict[str, Any]] = {}
        self.greeting_in_progress = False
        self.initial_greeting_sent = False
        self.is_processing = False
        self.transcript_buffer = ""
        self.late_buffer = []
        self.has_user_input = False
        self.should_end_call = False
        self.call_ending = False
        self.silence_timer = None
        self.silence_prompt_given = False
        self.first_silence_msg = None
        self._caller_speaking = False
        # Bytes of audio queued for the most recent reply, used to wait out the sign-off.
        self._spoken_bytes = 0
        self._first_audio_ms: Optional[int] = None
        self._speak_started = 0.0
        self.first_silence_time = 12
        self.second_silence_time = 12
        self.call_end_delay = 2
        self.interrupted_mid_speech = False
        self._last_spoken_text = ""
        self.call_sid: Optional[str] = None
        self.call_provider: str = "twilio"
        self.ws = None
        self.stream_sid: Optional[str] = None
        self.stream_provider: str = "twilio"
        # Vobiz reports its stream rate in the start event (8k/16k/24k) and expects
        # outbound audio at the same rate; the others are always 8kHz.
        self.stream_sample_rate: int = 8000
        self._audio_buffer = bytearray()
        self._out_buffer = bytearray()
        self._out_sequence = 0
        self._speech_frames = 0
        self._silence_frames = 0
        self._speech_started = False
        self._in_frames = 0
        self._level_peak = 0.0
        self.interruption_count = 0
        # Per-call ambient-noise calibration and noise-rejection state.
        self._noise_samples = 0
        self._noise_sum = 0.0
        self._speech_threshold = float(VAD_SILENCE_RMS_THRESHOLD)
        self._last_transcript = ""
        self._repeat_count = 0
        # Authoritative turn history for this call. Persisting to MongoDB is async so the
        # caller never waits on it, which means the database can lag a turn behind; reading
        # history back from it raced, the LLM saw an empty conversation, and the bot
        # restarted its script - repeating the intro the caller had already heard.
        self.conversation: List[Dict[str, str]] = []
        # Live transcription socket. When it is up, Deepgram decides where sentences
        # end and the local silence timer is not used for turn-taking at all.
        self.stt_stream: Optional[DeepgramStreamingSTT] = None
        # What the bot was part-way through saying when it was cut off, so the next
        # reply can carry on instead of repeating it.
        self._interrupted_text = ""
        self._recovery_timer = None
        # Set alongside the system prompt when a call is configured, so the same
        # scoring runs whether the call came from a campaign or the Test Call page.
        self.analysis_prompt: Optional[str] = None
        self._backup: Optional[GroqLLMService] = None

    async def apply_prompt_config(
        self,
        system_prompt: Optional[str] = None,
        format_values: Optional[Dict[str, Any]] = None,
        dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> None:
        if system_prompt is not None:
            self.system_prompt_template = system_prompt
        if format_values is not None:
            self.format_values = format_values or {}
        if dynamic_fields is not None:
            self.dynamic_fields = dynamic_fields or {}

        self.llm.set_system_prompt(self.system_prompt_template)
        self.llm.set_format_values(self.format_values)
        self.llm.set_dynamic_fields(self.dynamic_fields)

        if self.session_id and self.db.ready:
            await self.db.update_session(
                self.session_id,
                system_prompt=self.system_prompt_template,
                format_values=self.format_values,
                dynamic_fields=self.dynamic_fields,
            )

    async def initialize(
        self, session_id: Optional[str] = None, greeting_text: Optional[str] = None, start_greeting: bool = True
    ) -> bool:
        self.initialized = await self.db.initialize()
        self.llm.set_db_service(self.db, session_id)
        try:
            await self.tts.initialize()
        except Exception as exc:
            logger.warning("Cartesia TTS not ready: %s", exc)
        try:
            await self.stt.initialize()
        except Exception as exc:
            logger.warning("Azure STT not ready: %s", exc)

        if session_id:
            self.session_id = session_id
        elif not self.session_id:
            session = await self.db.create_session("unknown", direction="inbound")
            self.session_id = session["session_id"]
            self.llm.set_db_service(self.db, self.session_id)

        session_doc = await self.db.get_session(self.session_id) if self.session_id else None
        if session_doc:
            await self.apply_prompt_config(
                session_doc.get("system_prompt"),
                session_doc.get("format_values", {}),
                session_doc.get("dynamic_fields", {}),
            )

        # A blank or space-padded name reached the caller as "kya main  se baat kar rahi
        # hoon?", which sounds broken. Tidy the values before they are substituted, and
        # fall back to a neutral form when the name is missing entirely.
        self.format_values = {
            k: (v.strip() if isinstance(v, str) else v) for k, v in (self.format_values or {}).items()
        }
        if not str(self.format_values.get("CUSTOMER_NAME") or "").strip():
            self.format_values["CUSTOMER_NAME"] = "aap"
        self.greeting_text = format_prompt_with_placeholders(
            greeting_text or self.greeting_text, self.format_values, logger
        )
        # Collapse any run of spaces the substitution may have left behind.
        self.greeting_text = re.sub(r"\s{2,}", " ", self.greeting_text).strip()
        # Never the greeting: re-asking "kya main <name> se baat kar rahi hoon?" after
        # the caller already answered sounds like the bot lost the thread.
        self.first_silence_msg = self.first_silence_msg or SILENCE_NUDGE
        if self.session_id:
            await self.db.mark_session_state(self.session_id, "active", greeting_text=self.greeting_text)
        # Reset per-call state: one shared CallHandler serves sequential calls, so a
        # previous call ending (e.g. via silence timeout) would otherwise leave
        # call_ending/should_end_call set and silently suppress this call's greeting.
        self.initial_greeting_sent = False
        self.call_ending = False
        self.should_end_call = False
        self.silence_prompt_given = False
        self.interrupted_mid_speech = False
        self.interruption_count = 0
        self.is_processing = False
        self.has_user_input = False
        self.transcript_buffer = ""
        self.late_buffer = []
        # Re-measure the noise floor for each call; the next caller may be somewhere else.
        self._noise_samples = 0
        self._noise_sum = 0.0
        self._speech_threshold = float(VAD_SILENCE_RMS_THRESHOLD)
        self._last_transcript = ""
        self._repeat_count = 0
        self.conversation = []
        self._interrupted_text = ""
        self._cancel_interruption_recovery()
        if start_greeting:
            asyncio.create_task(self.initial_greeting(self.greeting_text))
        return self.initialized or self.llm.ready

    async def initial_greeting(self, greeting_text: str) -> None:
        if self.call_ending or self.should_end_call:
            return
        self.greeting_in_progress = True
        self.initial_greeting_sent = True
        t0 = time.monotonic()
        logger.warning("GREETING [%s] starting: %r", self.session_id, (greeting_text or "")[:60])
        try:
            await self._speak(greeting_text)
            logger.warning(
                "GREETING [%s] first audio %sms, %sms total",
                self.session_id,
                self._first_audio_ms,
                int((time.monotonic() - t0) * 1000),
            )
            # Record it: without this the LLM starts its first turn with an empty history,
            # does not know it has already greeted, and repeats the identity question the
            # caller just answered.
            if greeting_text:
                self._last_spoken_text = greeting_text
                self.conversation.append({"role": "assistant", "content": greeting_text})
                if self.session_id:
                    asyncio.create_task(
                        self.db.add_conversation_message(self.session_id, "assistant", greeting_text)
                    )
        except Exception as exc:
            logger.warning("Greeting TTS failed: %s", exc)
        finally:
            self.greeting_in_progress = False
            # Anything the caller said while the greeting was playing was parked in
            # late_buffer; replay it now, otherwise an early reply is lost for good.
            if self.late_buffer:
                pending = " ".join(self.late_buffer).strip()
                self.late_buffer = []
                logger.warning("AUDIO-IN [%s] replaying speech from greeting: %r", self.session_id, pending)
                if pending:
                    self.transcript_buffer = f"{self.transcript_buffer} {pending}".strip()
                    if not self.is_processing:
                        await self.process_buffer()
            self._start_silence_timer()

    async def attach_stream(self, websocket, stream_sid: str, provider: str = "twilio") -> None:
        """Called once the telephony provider's Media Stream WebSocket sends its `start` event."""
        self.ws = websocket
        self.stream_sid = stream_sid
        self.stream_provider = provider
        self._audio_buffer = bytearray()
        self._out_buffer = bytearray()
        self._out_sequence = 0
        self._speech_frames = 0
        self._silence_frames = 0
        self._speech_started = False
        # Greet first. Opening the Deepgram socket is a TLS handshake worth hundreds of
        # milliseconds, and awaiting it here held the greeting back - the caller answered
        # and heard silence. Nothing can be transcribed until they have been greeted
        # anyway, so the two happen concurrently.
        if not self.initial_greeting_sent:
            asyncio.create_task(self.initial_greeting(self.greeting_text))

        # Pay the LLM's connection setup while the greeting is playing rather than on the
        # caller's first question.
        asyncio.create_task(self.llm.warm_up())

        if settings.STT_STREAMING:
            # Per call, so it carries this stream's negotiated sample rate.
            self.stt_stream = DeepgramStreamingSTT(
                sample_rate=self.stream_sample_rate,
                encoding="linear16",
                language=self.stt.language,
            )
            asyncio.create_task(self._connect_stt_stream())

    async def _connect_stt_stream(self) -> None:
        """Bring up live transcription in the background; fall back to batch if it fails."""
        stream = self.stt_stream
        if stream is None:
            return
        t0 = time.monotonic()
        ok = await stream.connect(self._on_stream_transcript)
        logger.warning(
            "STT-STREAM [%s] connect %s in %sms",
            self.session_id, "ok" if ok else "FAILED (batch path)",
            int((time.monotonic() - t0) * 1000),
        )
        if not ok and self.stt_stream is stream:
            self.stt_stream = None

    async def detach_stream(self) -> None:
        self.ws = None
        self.stream_sid = None
        if self.stt_stream is not None:
            await self.stt_stream.close()
            self.stt_stream = None

    def _stream_audio_encoding(self) -> tuple[str, int]:
        """(Cartesia output encoding, sample rate) for the currently attached stream provider."""
        if self.stream_provider == "vobiz":
            return "pcm_s16le", self.stream_sample_rate
        if self.stream_provider in ("exotel", "plivo"):
            return "pcm_s16le", 8000
        return "pcm_mulaw", 8000

    async def _speak(self, text: str) -> None:
        encoding, sample_rate = self._stream_audio_encoding()
        self._out_buffer = bytearray()
        self._spoken_bytes = 0
        # Audio is streamed to the caller as Cartesia produces it, so what they actually
        # wait for is the first chunk - not the whole reply being generated. Reporting only
        # the total made TTS look far worse than it sounds on the line.
        self._first_audio_ms = None
        self._speak_started = time.monotonic()
        # Any speech frames counted while the caller was finishing must not carry over
        # into the reply and trip barge-in immediately.
        self._speech_frames = 0
        await self.tts.synthesize(text, callback=self._send_audio_chunk, encoding=encoding, sample_rate=sample_rate)
        await self._flush_output_audio()

    async def _send_audio_chunk(self, chunk: bytes) -> None:
        """Buffer synthesized audio and emit it as exact 20ms frames.

        Cartesia streams arbitrarily sized chunks, but Exotel expects the same frame
        size it sends us (320 bytes = 160 samples of 16-bit 8kHz audio); ragged frames
        are dropped rather than played.
        """
        if not self.ws:
            return
        if self._first_audio_ms is None:
            self._first_audio_ms = int((time.monotonic() - self._speak_started) * 1000)
        self._out_buffer.extend(chunk)
        self._spoken_bytes += len(chunk)
        while len(self._out_buffer) >= OUT_FRAME_BYTES:
            frame = bytes(self._out_buffer[:OUT_FRAME_BYTES])
            del self._out_buffer[:OUT_FRAME_BYTES]
            await self._send_media_frame(frame)

    async def _flush_output_audio(self) -> None:
        # After a barge-in the buffer is intentionally empty; never replay its tail.
        if self._out_buffer and self.ws and self.tts.tts_in_progress is False and self.interrupted_mid_speech:
            self._out_buffer = bytearray()
            return
        if self._out_buffer and self.ws:
            frame = bytes(self._out_buffer).ljust(OUT_FRAME_BYTES, b"\x00")
            self._out_buffer = bytearray()
            await self._send_media_frame(frame)

    async def _send_media_frame(self, frame: bytes) -> None:
        if not self.ws or not self.stream_sid:
            return
        payload = base64.b64encode(frame).decode("ascii")
        try:
            if self.stream_provider == "vobiz":
                # Vobiz routes outbound audio by streamId and keys messages on "event".
                # Sending "type", or omitting streamId, is accepted silently and never
                # played - the caller just hears nothing.
                await self.ws.send_json(
                    {
                        "event": "playAudio",
                        "streamId": self.stream_sid,
                        "media": {
                            "contentType": "audio/x-l16",
                            "sampleRate": self.stream_sample_rate,
                            "payload": payload,
                        },
                    }
                )
            elif self.stream_provider == "plivo":
                # Plivo does not accept a "media" event for outbound audio the way Twilio
                # and Exotel do — it expects playAudio with the codec spelled out.
                await self.ws.send_json(
                    {
                        "event": "playAudio",
                        "media": {
                            "contentType": "audio/x-l16",
                            "sampleRate": 8000,
                            "payload": payload,
                        },
                    }
                )
            elif self.stream_provider == "exotel":
                self._out_sequence += 1
                await self.ws.send_json(
                    {
                        "event": "media",
                        # Exotel routes outbound audio by stream_sid (snake_case); without
                        # it the frames are accepted but never played into the call.
                        "stream_sid": self.stream_sid,
                        "sequence_number": str(self._out_sequence),
                        "media": {"payload": payload},
                    }
                )
            else:
                await self.ws.send_json(
                    {
                        "event": "media",
                        "streamSid": self.stream_sid,
                        "media": {"payload": payload},
                    }
                )
        except Exception as exc:
            # The peer is gone. Drop the socket so the rest of this reply is discarded
            # instead of logging one failure per 20ms frame for the whole utterance.
            logger.warning(
                "%s stream closed mid-reply, dropping remaining audio: %s",
                self.stream_provider, exc,
            )
            self.ws = None
            self._out_buffer = bytearray()

    async def _clear_output_audio(self) -> None:
        self._out_buffer = bytearray()
        if not self.ws or not self.stream_sid:
            return
        try:
            if self.stream_provider == "vobiz":
                # Barge-in: drop buffered-but-unplayed audio.
                await self.ws.send_json({"event": "clearAudio", "streamId": self.stream_sid})
            elif self.stream_provider == "plivo":
                # Plivo's barge-in equivalent: drops whatever it has buffered but not played.
                await self.ws.send_json({"event": "clearAudio", "streamId": self.stream_sid})
            elif self.stream_provider == "exotel":
                await self.ws.send_json({"event": "clear", "stream_sid": self.stream_sid})
            else:
                await self.ws.send_json({"event": "clear", "streamSid": self.stream_sid})
        except Exception as exc:
            logger.warning("Failed to clear %s stream audio: %s", self.stream_provider, exc)

    async def handle_incoming_audio(self, raw_chunk: bytes) -> None:
        """Feeds one ~20ms audio frame from the telephony provider's Media Stream into a
        simple energy-based VAD, buffering speech until enough trailing silence is seen,
        then sends the buffered utterance to Deepgram for transcription."""
        if self.call_ending or self.should_end_call:
            self._in_frames += 1
            if self._in_frames % 100 == 0:
                logger.warning(
                    "AUDIO-IN [%s] dropping frames: call_ending=%s should_end_call=%s",
                    self.session_id, self.call_ending, self.should_end_call,
                )
            return
        try:
            linear16_chunk = raw_chunk if self.stream_provider in ("exotel", "plivo", "vobiz") else mulaw_to_linear16(raw_chunk)
            level = rms(linear16_chunk)
        except Exception as exc:
            logger.warning("AUDIO-IN [%s] decode failed: %s", self.session_id, exc)
            return
        self._in_frames += 1
        self._level_peak = max(self._level_peak, level)

        # Learn this call's ambient level from its opening moments, then require speech to
        # sit clearly above it. A caller in a noisy market needs a higher bar than one in
        # a quiet room, and a single fixed number cannot serve both.
        if self._noise_samples < NOISE_CALIBRATION_FRAMES:
            self._noise_samples += 1
            self._noise_sum += level
            if self._noise_samples == NOISE_CALIBRATION_FRAMES:
                floor = self._noise_sum / max(1, self._noise_samples)
                self._speech_threshold = max(
                    VAD_MIN_THRESHOLD, min(VAD_MAX_THRESHOLD, floor * NOISE_FLOOR_MULTIPLIER)
                )
                logger.warning(
                    "AUDIO-IN [%s] noise floor %.0f -> speech threshold %.0f",
                    self.session_id, floor, self._speech_threshold,
                )
            # Do not treat the calibration window itself as speech.
            return

        is_speech = level > self._speech_threshold

        if self._in_frames % 100 == 0:
            logger.warning(
                "AUDIO-IN [%s] %s frames | peak RMS %.0f (speech needs >%.0f) | provider=%s",
                self.session_id, self._in_frames, self._level_peak,
                self._speech_threshold, self.stream_provider,
            )
            self._level_peak = 0.0

        # Someone who is mid-sentence is not silent. Previously only a completed turn
        # restarted the clock, so a caller thinking aloud - or any transcript dropped as
        # noise - counted as silence and the call was hung up underneath them.
        if is_speech and not self._caller_speaking:
            self._caller_speaking = True
            self.silence_prompt_given = False
            self._start_silence_timer()
        elif not is_speech:
            self._caller_speaking = False

        streaming = self.stt_stream is not None and self.stt_stream.connected
        if streaming:
            # Deepgram sees the audio as it arrives and reports sentence boundaries itself,
            # so the buffer-and-upload path below is skipped entirely. Local VAD still runs,
            # but only to detect the caller talking over the bot.
            # Our own speech echoes back on the line. Feeding it to Deepgram makes it hear
            # continuous audio, so endpointing never fires and the caller's reply is not
            # finalised until long after they finished - a 16 second wait in one call.
            # Barge-in is detected locally, so nothing is lost by staying quiet here.
            if not self.tts.tts_in_progress:
                await self.stt_stream.send_audio(linear16_chunk)
            speaking_for = time.monotonic() - self._speak_started
            if (
                is_speech
                and self.tts.tts_in_progress
                and not self.greeting_in_progress
                and speaking_for > BARGEIN_GRACE_SECONDS
            ):
                self._speech_frames += 1
                if self._speech_frames == VAD_BARGEIN_SPEECH_FRAMES:
                    await self._interrupt_playback()
            elif not is_speech:
                self._speech_frames = 0
            return

        if is_speech:
            self._audio_buffer.extend(raw_chunk)
            self._speech_frames += 1
            self._silence_frames = 0
            self._speech_started = True
            # Barge-in only on sustained speech while the bot is actually talking.
            # A short blip is usually line noise or an echo of our own audio, and cutting
            # the bot off for that made it stutter mid-sentence.
            if (
                self._speech_frames == VAD_BARGEIN_SPEECH_FRAMES
                and self.tts.tts_in_progress
                and not self.greeting_in_progress
                and (time.monotonic() - self._speak_started) > BARGEIN_GRACE_SECONDS
            ):
                await self._interrupt_playback()
        elif self._speech_started:
            self._audio_buffer.extend(raw_chunk)
            self._silence_frames += 1
            if self._silence_frames >= VAD_SILENCE_FRAMES_TO_END:
                await self._finalize_utterance()

    def _is_closing_line(self, text: str) -> bool:
        """True when the reply is the script's sign-off.

        The prompt tells the agent to end the call after saying goodbye, but nothing acted
        on it: the bot said "bye" and then sat waiting for the silence timer, leaving the
        caller on a dead line for another 24 seconds.
        """
        if not text:
            return False
        low = text.lower()
        return any(marker in low for marker in CLOSING_MARKERS)

    async def _on_stream_transcript(self, transcript: str, confidence: float) -> None:
        """A completed sentence from the live socket. Same filtering as the batch path."""
        logger.warning(
            "STT-STREAM [%s] transcript=%r confidence=%.2f",
            self.session_id, transcript, confidence,
        )
        if self.call_ending or self.should_end_call:
            return
        if self._is_noise_transcript(transcript, confidence):
            return
        if transcript:
            await self.buffer_transcript(transcript)

    async def _finalize_utterance(self) -> None:
        audio_bytes = bytes(self._audio_buffer)
        self._audio_buffer = bytearray()
        self._speech_frames = 0
        self._silence_frames = 0
        self._speech_started = False
        # 16-bit samples, so two bytes per sample.
        min_bytes = int(VAD_MIN_UTTERANCE_SECONDS * self.stream_sample_rate * 2)
        if len(audio_bytes) < min_bytes:
            logger.warning(
                "AUDIO-IN [%s] utterance too short (%.2fs < %.2fs), skipping STT",
                self.session_id,
                len(audio_bytes) / 2 / max(1, self.stream_sample_rate),
                VAD_MIN_UTTERANCE_SECONDS,
            )
            return
        try:
            stt_encoding = "linear16" if self.stream_provider in ("exotel", "plivo", "vobiz") else "mulaw"
            logger.warning(
                "STT [%s] sending %s bytes (%s)", self.session_id, len(audio_bytes), stt_encoding
            )
            t_stt = time.monotonic()
            transcript = await self.stt.transcribe_audio_bytes_raw(
                audio_bytes, encoding=stt_encoding, sample_rate=self.stream_sample_rate
            )
            logger.warning(
                "STT [%s] took %sms for %.1fs of audio",
                self.session_id,
                int((time.monotonic() - t_stt) * 1000),
                len(audio_bytes) / 2 / max(1, self.stream_sample_rate),
            )
        except Exception as exc:
            logger.warning("STT [%s] FAILED: %s", self.session_id, exc)
            return
        confidence = getattr(self.stt, "last_confidence", 0.0)
        logger.warning(
            "STT [%s] transcript=%r confidence=%.2f", self.session_id, transcript, confidence
        )
        if self._is_noise_transcript(transcript, confidence):
            return
        if transcript:
            await self.buffer_transcript(transcript)

    def _is_noise_transcript(self, transcript: str, confidence: float) -> bool:
        low = (transcript or "").lower()
        for phrase in CARRIER_ANNOUNCEMENTS:
            if phrase.lower() in low:
                logger.warning(
                    "NOISE [%s] dropped (carrier announcement): %r",
                    self.session_id, transcript[:70],
                )
                return True
        """Reject transcriptions that are almost certainly background noise.

        Speech recognition returns *something* for traffic, a TV or crosstalk, usually a
        short confident-sounding filler. Feeding those to the LLM makes the bot answer
        questions the caller never asked, so they are dropped before they become a turn.
        """
        text = (transcript or "").strip()
        if not text:
            return True

        if len(text) < STT_MIN_CHARS:
            logger.warning("NOISE [%s] dropped (too short): %r", self.session_id, text)
            return True

        # Punctuation / digits only carries no instruction.
        if not any(ch.isalpha() for ch in text):
            logger.warning("NOISE [%s] dropped (no words): %r", self.session_id, text)
            return True

        if text.lower().strip(" .,!?") in NOISE_TRANSCRIPTS and confidence < 0.9:
            logger.warning(
                "NOISE [%s] dropped (filler, confidence %.2f): %r", self.session_id, confidence, text
            )
            return True

        if confidence and confidence < STT_MIN_CONFIDENCE:
            logger.warning(
                "NOISE [%s] dropped (low confidence %.2f < %s): %r",
                self.session_id, confidence, STT_MIN_CONFIDENCE, text,
            )
            return True

        # The same phrase arriving over and over is a recognition artefact of steady noise
        # (a fan, music, a TV), not someone repeating themselves verbatim.
        if text == self._last_transcript:
            self._repeat_count += 1
            if self._repeat_count >= 2:
                logger.warning(
                    "NOISE [%s] dropped (repeated %sx): %r", self.session_id, self._repeat_count, text
                )
                return True
        else:
            self._last_transcript = text
            self._repeat_count = 0

        return False

    def _should_use_offline_mode(self) -> bool:
        return not (
            settings.TWILIO_ACCOUNT_SID
            and settings.TWILIO_AUTH_TOKEN
            and settings.TWILIO_PHONE_NUMBER
            and settings.TWILIO_WEBHOOK_BASE_URL
        )

    def _should_use_offline_mode_exotel(self) -> bool:
        return not (
            settings.EXOTEL_ACCOUNT_SID
            and settings.EXOTEL_API_KEY
            and settings.EXOTEL_API_TOKEN
            and settings.EXOTEL_EXOPHONE
        )

    def _should_use_offline_mode_plivo(self) -> bool:
        return not (
            settings.PLIVO_AUTH_ID
            and settings.PLIVO_AUTH_TOKEN
            and settings.PLIVO_PHONE_NUMBER
            and (settings.PLIVO_WEBHOOK_BASE_URL or settings.TWILIO_WEBHOOK_BASE_URL)
        )

    def _should_use_offline_mode_vobiz(self) -> bool:
        return not (
            settings.VOBIZ_AUTH_ID
            and settings.VOBIZ_AUTH_TOKEN
            and settings.VOBIZ_PHONE_NUMBER
            and (settings.VOBIZ_WEBHOOK_BASE_URL or settings.TWILIO_WEBHOOK_BASE_URL)
        )

    async def handle_outbound_call(
        self,
        to_number: str,
        from_number: Optional[str] = None,
        system_prompt: Optional[str] = None,
        format_values: Optional[Dict[str, Any]] = None,
        dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None,
        greeting_text: Optional[str] = None,
        execution_id: Optional[str] = None,
        provider: str = "twilio",
    ) -> dict:
        session = await self.db.create_session(to_number, direction="outbound", execution_id=execution_id)
        self.session_id = session["session_id"]
        self.llm.set_db_service(self.db, self.session_id)
        await self.apply_prompt_config(system_prompt, format_values, dynamic_fields)
        await self.db.mark_session_state(
            self.session_id,
            "active",
            phone_number=to_number,
            from_number=from_number or "",
            direction="outbound",
            telephony_provider=provider,
        )

        if provider == "exotel":
            if self._should_use_offline_mode_exotel():
                return {
                    "session_id": session["session_id"],
                    "mode": "offline",
                    "message": "No Exotel credentials configured; the call was created locally for queueing and session tracking.",
                }
            try:
                result = await self.telephony_exotel.make_call(
                    from_number or settings.EXOTEL_EXOPHONE, to_number, session["session_id"]
                )
                if result.get("status") != "success":
                    return {"session_id": session["session_id"], "telephony_response": result, "mode": "telephony"}
            except Exception as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
            self.call_sid = result.get("call_uuid")
            self.call_provider = "exotel"
            # start_greeting=False: the greeting only fires once Exotel's Voicebot
            # applet WebSocket actually connects (see attach_stream), same as Twilio.
            await self.initialize(self.session_id, greeting_text or self.greeting_text, start_greeting=False)
            # Reports "telephony" (not an exotel-specific mode) so callers such as
            # campaign_service treat it like any other live streamed call and wait for
            # the conversation to finish instead of marking it rejected.
            return {"session_id": session["session_id"], "telephony_response": result, "mode": "telephony"}

        if provider == "vobiz":
            if self._should_use_offline_mode_vobiz():
                return {
                    "session_id": session["session_id"],
                    "mode": "offline",
                    "message": "No Vobiz credentials configured; the call was created locally for queueing and session tracking.",
                }
            try:
                result = await self.telephony_vobiz.make_call(
                    from_number or settings.VOBIZ_PHONE_NUMBER, to_number, session["session_id"]
                )
                if result.get("status") != "success":
                    return {"session_id": session["session_id"], "telephony_response": result, "mode": "telephony"}
            except Exception as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
            # request_uuid for now; the answer webhook and the stream's start event both
            # carry the real call_uuid, which is what hangup_call needs.
            self.call_sid = result.get("call_uuid")
            self.call_provider = "vobiz"
            # start_greeting=False: wait for the audio stream, same as the other providers.
            await self.initialize(self.session_id, greeting_text or self.greeting_text, start_greeting=False)
            return {"session_id": session["session_id"], "telephony_response": result, "mode": "telephony"}

        if provider == "plivo":
            if self._should_use_offline_mode_plivo():
                return {
                    "session_id": session["session_id"],
                    "mode": "offline",
                    "message": "No Plivo credentials configured; the call was created locally for queueing and session tracking.",
                }
            try:
                result = await self.telephony_plivo.make_call(
                    from_number or settings.PLIVO_PHONE_NUMBER, to_number, session["session_id"]
                )
                if result.get("status") != "success":
                    return {"session_id": session["session_id"], "telephony_response": result, "mode": "telephony"}
            except Exception as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
            # This is Plivo's request_uuid; the real call_uuid replaces it when the answer
            # callback arrives, which is what hangup_call needs.
            self.call_sid = result.get("call_uuid")
            self.call_provider = "plivo"
            # start_greeting=False: wait for the AudioStream socket, same as the others.
            await self.initialize(self.session_id, greeting_text or self.greeting_text, start_greeting=False)
            return {"session_id": session["session_id"], "telephony_response": result, "mode": "telephony"}

        if self._should_use_offline_mode():
            return {
                "session_id": session["session_id"],
                "mode": "offline",
                "message": "No telephony credentials configured; the call was created locally for queueing and session tracking.",
            }

        try:
            result = await self.telephony.make_call(from_number or settings.TWILIO_PHONE_NUMBER, to_number, session["session_id"])
            if result.get("status") != "success":
                return {"session_id": session["session_id"], "telephony_response": result, "mode": "telephony"}
        except Exception as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        self.call_sid = result.get("call_uuid")
        self.call_provider = "twilio"
        # start_greeting=False: the greeting only fires once Twilio's Media Stream
        # WebSocket actually connects (see attach_stream), so there's somewhere to
        # send the synthesized audio instead of it being generated and discarded.
        await self.initialize(self.session_id, greeting_text or self.greeting_text, start_greeting=False)
        return {"session_id": session["session_id"], "telephony_response": result, "mode": "telephony"}

    async def handle_inbound_webhook(
        self,
        session_id: str,
        system_prompt: Optional[str] = None,
        format_values: Optional[Dict[str, Any]] = None,
        dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> str:
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id missing")
        self.session_id = session_id
        self.llm.set_db_service(self.db, self.session_id)
        await self.apply_prompt_config(system_prompt, format_values, dynamic_fields)
        await self.db.mark_session_state(self.session_id, "active", direction="inbound")
        if self._should_use_offline_mode():
            return self.telephony_xml.build_inbound_response(self.greeting_text)
        await self.initialize(self.session_id, self.greeting_text, start_greeting=False)
        return self.telephony_xml.build_stream_response(self.session_id)

    def _start_silence_timer(self) -> None:
        if self.silence_timer:
            self.silence_timer.cancel()
        delay = self.second_silence_time if self.silence_prompt_given else self.first_silence_time
        self.silence_timer = asyncio.get_running_loop().call_later(delay, lambda: asyncio.create_task(self._handle_silence()))

    def _cancel_silence_timer(self) -> None:
        if self.silence_timer:
            self.silence_timer.cancel()
            self.silence_timer = None

    async def _handle_silence(self) -> None:
        if self.call_ending or self.should_end_call:
            return
        if not self.silence_prompt_given:
            self.silence_prompt_given = True
            logger.info("Silence detected, playing follow-up prompt")
            await self._speak(self.first_silence_msg or SILENCE_NUDGE)
        else:
            self.should_end_call = True
            self.call_ending = True
            logger.info("Silence timeout reached, ending the call")
            await self._speak(SILENCE_GOODBYE)
            await asyncio.sleep(self.call_end_delay)
            await self._hangup_active_call()

    async def hangup_for_duration_cap(self) -> None:
        """End a call that has run past the agent's maximum duration."""
        self.should_end_call = True
        self.call_ending = True
        self._cancel_silence_timer()
        if self.call_provider == "exotel":
            if self.ws:
                try:
                    await self.ws.close()
                except Exception as exc:
                    logger.warning("Failed to close Exotel stream for call %s: %s", self.call_sid, exc)
        elif self.call_provider == "vobiz" and self.call_sid:
            try:
                await self.telephony_vobiz.hangup_call(self.call_sid)
            except Exception as exc:
                logger.warning("Failed to hang up Vobiz call %s: %s", self.call_sid, exc)
        elif self.call_provider == "plivo" and self.call_sid:
            try:
                await self.telephony_plivo.hangup_call(self.call_sid)
            except Exception as exc:
                logger.warning("Failed to hang up Plivo call %s: %s", self.call_sid, exc)
        elif self.call_sid:
            try:
                await self.telephony.hangup_call(self.call_sid)
            except Exception as exc:
                logger.warning("Failed to hang up call %s: %s", self.call_sid, exc)
        await self.finalize_call(self.session_id, status="completed", reason="max_duration_reached")

    async def _hangup_active_call(self, reason: str = "silence_timeout") -> None:
        if self.call_provider == "exotel":
            # Exotel's REST call resource rejects a Twilio-style status update
            # ("403 Method not allowed"). For a Voicebot stream the supported way to end
            # the interaction is to close the websocket, which ends the applet.
            if self.ws:
                try:
                    await self.ws.close()
                except Exception as exc:
                    logger.warning("Failed to close Exotel stream for call %s: %s", self.call_sid, exc)
        elif self.call_provider == "vobiz" and self.call_sid:
            try:
                await self.telephony_vobiz.hangup_call(self.call_sid)
            except Exception as exc:
                logger.warning("Failed to hang up Vobiz call %s: %s", self.call_sid, exc)
        elif self.call_provider == "plivo" and self.call_sid:
            try:
                await self.telephony_plivo.hangup_call(self.call_sid)
            except Exception as exc:
                logger.warning("Failed to hang up Plivo call %s: %s", self.call_sid, exc)
        elif self.call_sid:
            try:
                await self.telephony.hangup_call(self.call_sid)
            except Exception as exc:
                logger.warning("Failed to hang up %s call %s: %s", self.call_provider, self.call_sid, exc)
        await self.finalize_call(self.session_id, status="completed", reason=reason)

    def _should_bargein(self, transcript: str) -> bool:
        if self.greeting_in_progress:
            return False
        clean_text = transcript.lower().strip()
        control_words = ["stop", "wait", "bye", "goodbye", "no", "enough", "halt", "quiet"]
        for word in control_words:
            if word in clean_text.split():
                return True
        filler_words = ["mmm", "hmm", "uh", "um", "ah", "eh", "er", "huh", "mhmm"]
        for filler in filler_words:
            clean_text = re.sub(r"\b" + filler + r"\b", "", clean_text)
        words = [word for word in clean_text.split() if word]
        return len(words) >= 2

    async def _interrupt_playback(self) -> None:
        """Stop the bot mid-sentence because the caller started talking over it.

        Drops the queued audio as well as halting synthesis — otherwise the tail of the
        interrupted sentence still plays after the caller has spoken.
        """
        if not self.tts.tts_in_progress:
            return
        # The grace window has to live here, not only in the audio loop. buffer_transcript
        # also calls this on a transcript, which arrives after the caller has finished
        # speaking - so their last word could still cut off a reply the bot had only just
        # begun. Guarding the single place every caller goes through closes that.
        if (time.monotonic() - self._speak_started) <= BARGEIN_GRACE_SECONDS:
            logger.info(
                "BARGE-IN [%s] ignored inside the %.1fs grace window",
                self.session_id, BARGEIN_GRACE_SECONDS,
            )
            return
        self.interruption_count += 1
        self.interrupted_mid_speech = True
        # Read what we were saying BEFORE stopping: stop() overwrites the tracker, so the
        # previous ordering logged an empty string and told the LLM nothing useful.
        self._interrupted_text = self._last_spoken_text or ""
        delivered = self._first_audio_ms is not None
        await self.tts.stop()
        self._out_buffer = bytearray()
        await self._clear_output_audio()
        logger.warning(
            "BARGE-IN [%s] interrupted (#%s) while saying %r (audio had started: %s)",
            self.session_id, self.interruption_count,
            self._interrupted_text[:70], delivered,
        )
        self._arm_interruption_recovery()

    def _arm_interruption_recovery(self) -> None:
        """Make sure an interruption that produced nothing does not end the conversation."""
        self._cancel_interruption_recovery()
        loop = asyncio.get_running_loop()
        self._recovery_timer = loop.call_later(
            INTERRUPTION_RECOVERY_SECONDS,
            lambda: asyncio.create_task(self._recover_from_interruption()),
        )

    def _cancel_interruption_recovery(self) -> None:
        if self._recovery_timer:
            self._recovery_timer.cancel()
            self._recovery_timer = None

    async def _recover_from_interruption(self) -> None:
        self._recovery_timer = None
        if self.call_ending or self.should_end_call:
            return
        # Something did arrive and is being handled - nothing to rescue.
        if self.is_processing or self.transcript_buffer.strip() or self.tts.tts_in_progress:
            return
        logger.warning(
            "RECOVERY [%s] interruption produced no usable speech; re-inviting the caller",
            self.session_id,
        )
        await self._speak(INTERRUPTION_RECOVERY_LINE)
        self._start_silence_timer()

    async def buffer_transcript(self, transcript: str) -> None:
        if self.call_ending or self.should_end_call:
            return
        if transcript.startswith("__INTERIM__:"):
            interim_text = transcript[len("__INTERIM__:"):]
            if self._should_bargein(interim_text):
                await self._interrupt_playback()
            return
        if transcript == "__FORCE_STOP__":
            await self._interrupt_playback()
            return

        cleaned = transcript.strip()
        if not cleaned:
            return
        self.has_user_input = True
        self._cancel_silence_timer()
        # The caller did say something usable, so the interruption rescue is not needed.
        self._cancel_interruption_recovery()
        if not self.greeting_in_progress and self._should_bargein(cleaned):
            await self._interrupt_playback()

        if self.greeting_in_progress:
            self.late_buffer.append(cleaned)
        else:
            self.transcript_buffer += f" {cleaned}".strip()
            if not self.is_processing:
                # Brief settle so a pause mid-sentence doesn't split one utterance into
                # two LLM turns.
                await asyncio.sleep(0.3)
                await self.process_buffer()

    async def finalize_call(self, session_id: Optional[str] = None, status: str = "completed", reason: Optional[str] = None) -> dict:
        # Record the counter the handler measured. The post-call analysis was being asked
        # to infer interruptions from a transcript, which carries no timing, so it always
        # came back as zero.
        try:
            sid = session_id or self.session_id
            if sid:
                await self.db.update_session(sid, interruption_count=self.interruption_count)
        except Exception as exc:
            logger.debug("Could not persist interruption_count: %s", exc)
        target_session = session_id or self.session_id
        if target_session:
            await self.db.finalize_session(target_session, status=status, reason=reason)
            # Analysis used to run only inside campaign_service, so a single test call was
            # never scored and its outcome stayed "pending" forever - which hid the one
            # thing the product exists to produce. Run it for every call, in the background
            # so hanging up is not delayed by an LLM round trip.
            asyncio.create_task(self._analyse_completed_call(target_session))
        return {"session_id": target_session, "status": status, "reason": reason}

    async def _llm_reply(self, user_input: str) -> Optional[str]:
        """A reply from whichever model answers first.

        The primary starts alone; if it has not answered within the hedge window the
        backup is started alongside it rather than after it, so a throttled primary costs
        the hedge window and not the whole deadline. Returns None only if nothing usable
        arrives in time, which is the caller's cue to stall rather than invent something.
        """
        history = list(self.conversation)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + LLM_TOTAL_DEADLINE_SECONDS

        async def ask(client, label: str):
            reply = await client.generate_response(user_input, conversation_history=history)
            if not (reply and reply.strip()):
                raise RuntimeError("returned nothing")
            return label, reply

        started = loop.time()
        tasks = {asyncio.ensure_future(ask(self.llm, "primary"))}
        hedged = False
        try:
            while tasks:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    break
                window = remaining if hedged else min(remaining, LLM_HEDGE_AFTER_SECONDS)
                done, tasks = await asyncio.wait(
                    tasks, timeout=window, return_when=asyncio.FIRST_COMPLETED,
                )
                for task in done:
                    try:
                        label, reply = task.result()
                    except Exception as exc:
                        logger.warning("LLM [%s] %s failed: %s", self.session_id, task, exc)
                        continue
                    if label == "backup":
                        logger.warning(
                            "LLM [%s] answered from backup provider in %dms",
                            self.session_id, int((loop.time() - started) * 1000),
                        )
                    return reply
                # Either the hedge window expired or every attempt so far has failed; in
                # both cases the primary is not going to be quick, so bring in the backup.
                if not hedged:
                    hedged = True
                    backup = self._backup_llm()
                    if backup is not None:
                        logger.warning(
                            "LLM [%s] primary slow past %.1fs; racing the backup",
                            self.session_id, LLM_HEDGE_AFTER_SECONDS,
                        )
                        tasks = set(tasks) | {asyncio.ensure_future(ask(backup, "backup"))}
        finally:
            for task in tasks:
                task.cancel()
        logger.warning(
            "LLM [%s] no usable reply within %.1fs",
            self.session_id, LLM_TOTAL_DEADLINE_SECONDS,
        )
        return None

    def _backup_llm(self) -> Optional[GroqLLMService]:
        """A second client for the hedge, built once per call and only if one is needed."""
        if self._backup is not None:
            return self._backup
        name = (settings.LLM_BACKUP_PROVIDER or "").strip().lower()
        model = (settings.LLM_BACKUP_MODEL or "").strip()
        if not name:
            return None
        # Same provider is allowed when a model is named. Most tail latency is one request
        # stalling rather than the whole provider being down, so a second request - even to
        # the same model - covers it, and a deployment that wants a single vendor can stay
        # on one without giving up the hedge.
        if name == self.llm.provider and not model:
            return None
        try:
            client = GroqLLMService()
            client.set_provider(name)
            if client.provider != name or not client.ready:
                return None
            if model:
                client.set_model(model)
            client.set_system_prompt(self.system_prompt_template)
            client.set_format_values(self.format_values)
            client.set_dynamic_fields(self.dynamic_fields)
            self._backup = client
            logger.warning(
                "LLM [%s] backup ready: %s/%s", self.session_id, name, client.model,
            )
            return client
        except Exception as exc:
            logger.info("No backup LLM available: %s", exc)
            return None

    async def _analyse_completed_call(self, session_id: str) -> None:
        """Score a finished call and record its disposition on the session."""
        try:
            history = await self.db.get_conversation_history(session_id)
            if not history:
                # Nobody spoke: there is nothing to analyse, but the outcome is still known.
                await self.db.update_session(session_id, disposition_code="NR")
                return

            analysis_prompt = self.analysis_prompt
            if not analysis_prompt or not self.llm.ready:
                logger.info("ANALYSIS [%s] skipped: no prompt or LLM unavailable", session_id)
                return

            try:
                from .campaign_service import _run_post_call_analysis
            except ImportError:  # pragma: no cover
                from campaign_service import _run_post_call_analysis

            result = await _run_post_call_analysis(self, session_id, analysis_prompt)
            if not result:
                return

            code = str(result.get("disposition_code") or "").upper() or None
            await self.db.update_model_data(session_id, result)
            # Also store it at the top level. It was only ever nested inside model_data,
            # so every list view had to dig for it and the session API never exposed it.
            await self.db.update_session(session_id, disposition_code=code)
            logger.warning("ANALYSIS [%s] disposition=%s", session_id, code)
        except Exception as exc:
            logger.warning("ANALYSIS [%s] failed: %s", session_id, exc)

    async def process_buffer(self) -> None:
        if self.call_ending or self.should_end_call or self.greeting_in_progress:
            return
        if self.is_processing:
            return
        self.is_processing = True
        try:
            user_input = self.transcript_buffer.strip()
            self.transcript_buffer = ""
            if not user_input:
                return
            if self.interrupted_mid_speech:
                # "[interrupted]" alone told the model nothing: it could not tell whether
                # the caller had heard the whole point or none of it, so it either repeated
                # itself or silently dropped what it had been about to say.
                if self._interrupted_text:
                    user_input = (
                        f'[You were cut off while saying: "{self._interrupted_text[:140]}". '
                        f"The caller heard only the start of it. Do not repeat it word for "
                        f"word. Reply to what they just said:] {user_input}"
                    )
                else:
                    user_input = f"[The caller interrupted you.] {user_input}"
                self.interrupted_mid_speech = False
                self._interrupted_text = ""
            # Fire-and-forget: the caller should not wait on MongoDB before hearing a
            # reply. Ordering still holds because each write is independent.
            asyncio.create_task(self.db.mark_session_state(self.session_id, "active"))
            asyncio.create_task(
                self.db.add_conversation_message(self.session_id, "user", user_input)
            )
            logger.warning("LLM [%s] user=%r", self.session_id, user_input[:120])

            t_llm = time.monotonic()
            response_text = await self._llm_reply(user_input)
            stalled = response_text is None
            if stalled:
                logger.warning("LLM [%s] both providers failed; stalling", self.session_id)
                response_text = LLM_STALL_LINE
            llm_ms = int((time.monotonic() - t_llm) * 1000)

            asyncio.create_task(
                self.db.add_conversation_message(self.session_id, "assistant", response_text)
            )
            self.conversation.append({"role": "user", "content": user_input})
            self.conversation.append({"role": "assistant", "content": response_text})
            self._last_spoken_text = response_text

            t_tts = time.monotonic()
            await self._speak(response_text)
            tts_ms = int((time.monotonic() - t_tts) * 1000)
            first_audio = self._first_audio_ms if self._first_audio_ms is not None else tts_ms
            logger.warning(
                "TURN [%s] llm=%sms tts_first_audio=%sms | CALLER WAITED %sms "
                "(tts_total=%sms) reply=%r",
                self.session_id, llm_ms, first_audio, llm_ms + first_audio,
                tts_ms, (response_text or "")[:70],
            )

            if self._is_closing_line(response_text):
                # _speak returns once the frames are queued, not once they have played, so
                # hanging up here would cut the goodbye off mid-word. Wait out the audio
                # just sent, measured from its actual length.
                audio_seconds = self._spoken_bytes / 2 / max(1, self.stream_sample_rate)
                logger.warning(
                    "CLOSING [%s] sign-off sent (%.1fs of audio), ending call",
                    self.session_id, audio_seconds,
                )
                self.should_end_call = True
                self.call_ending = True
                self._cancel_silence_timer()
                await asyncio.sleep(audio_seconds + 0.7)
                await self._hangup_active_call(reason="agent_closed_call")
                return

            self._start_silence_timer()
        finally:
            self.is_processing = False

    async def process_voice_turn(
        self,
        session_id: str,
        user_text: str,
        system_prompt: Optional[str] = None,
        format_values: Optional[Dict[str, Any]] = None,
        dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> dict:
        self.session_id = session_id
        self.llm.set_db_service(self.db, self.session_id)
        session = await self.db.get_session(session_id)
        if not session and self.db.ready:
            raise HTTPException(status_code=404, detail="session not found")

        if session:
            await self.apply_prompt_config(
                system_prompt if system_prompt is not None else session.get("system_prompt"),
                format_values if format_values is not None else session.get("format_values", {}),
                dynamic_fields if dynamic_fields is not None else session.get("dynamic_fields", {}),
            )
        else:
            await self.apply_prompt_config(system_prompt, format_values, dynamic_fields)

        await self.db.mark_session_state(session_id, "active")
        await self.db.save_conversation_turn(session_id, "user", user_text)
        response_text = await self.llm.generate_response(user_text)
        await self.db.save_conversation_turn(session_id, "assistant", response_text)

        audio_bytes = await self.tts.synthesize(response_text)
        return {
            "response_text": response_text,
            "audio_bytes": len(audio_bytes),
            "audio_base64": base64.b64encode(audio_bytes).decode("utf-8"),
        }

    async def transcribe_audio(self, audio_base64: str) -> dict:
        audio_bytes = base64.b64decode(audio_base64)
        transcript = await self.stt.transcribe_audio_bytes(audio_bytes)
        return {"transcript": transcript}
