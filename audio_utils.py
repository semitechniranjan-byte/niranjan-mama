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


def rms(pcm16_bytes: bytes) -> float:
    count = len(pcm16_bytes) // 2
    if count == 0:
        return 0.0
    samples = struct.unpack(f"<{count}h", pcm16_bytes[: count * 2])
    return (sum(s * s for s in samples) / count) ** 0.5
