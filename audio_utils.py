"""Pure-Python G.711 mu-law <-> PCM16 helpers.

Python 3.13+ removed the stdlib `audioop` module (PEP 594), so real-time
Twilio Media Stream audio (8kHz mu-law) is decoded here without it.
"""
import struct

_BIAS = 0x84


def _build_ulaw_decode_table() -> list:
    table = []
    for i in range(256):
        u = ~i & 0xFF
        sign = u & 0x80
        exponent = (u >> 4) & 0x07
        mantissa = u & 0x0F
        sample = ((mantissa << 3) + _BIAS) << exponent
        sample -= _BIAS
        table.append(-sample if sign else sample)
    return table


_ULAW_DECODE_TABLE = _build_ulaw_decode_table()


def mulaw_to_linear16(mulaw_bytes: bytes) -> bytes:
    samples = [_ULAW_DECODE_TABLE[b] for b in mulaw_bytes]
    return struct.pack(f"<{len(samples)}h", *samples)


# audioop is C and roughly two orders of magnitude faster than summing squares in
# Python. It was removed from the stdlib in 3.13 (PEP 594) but the deployed image runs
# 3.12, so use it when present and keep the pure-Python version as the fallback.
try:  # pragma: no cover - depends on the interpreter version
    import audioop as _audioop
except ImportError:  # pragma: no cover
    _audioop = None


def _rms_python(pcm16_bytes: bytes) -> float:
    count = len(pcm16_bytes) // 2
    if count == 0:
        return 0.0
    samples = struct.unpack(f"<{count}h", pcm16_bytes[: count * 2])
    return (sum(s * s for s in samples) / count) ** 0.5


def rms(pcm16_bytes: bytes) -> float:
    """Root-mean-square level of a 16-bit PCM frame.

    Called 50 times a second per call, so on a CPU-limited host this sits directly in
    front of the event loop: a slow implementation here delays every LLM and TTS
    response waiting to be processed.
    """
    if not pcm16_bytes:
        return 0.0
    if _audioop is not None:
        return float(_audioop.rms(pcm16_bytes, 2))
    return _rms_python(pcm16_bytes)
