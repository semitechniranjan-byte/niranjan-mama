"""Catalogue of the speech / language / telephony providers the platform can use.

The admin UI renders itself from this registry, so supporting a new vendor is a matter of
adding an entry here (plus its service class) — no frontend change is needed. Each entry
declares which env vars it needs, which lets the API report whether it is actually usable
rather than just listed.
"""

from typing import Any, Dict, List

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings


# capability -> providers. `implemented` marks whether the backend can actually drive it
# today; anything False is shown in the UI as coming soon rather than silently failing.
PROVIDER_REGISTRY: Dict[str, List[Dict[str, Any]]] = {
    "stt": [
        {
            "key": "deepgram",
            "label": "Deepgram",
            "implemented": True,
            "requires": ["DEEPGRAM_API_KEY"],
            "models": ["nova-3", "nova-2", "enhanced", "base"],
            "default_model": "nova-2",
        },
        {
            "key": "azure",
            "label": "Azure Speech",
            "implemented": False,
            "requires": ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"],
            "models": ["latest"],
            "default_model": "latest",
        },
        {
            "key": "google",
            "label": "Google Speech-to-Text",
            "implemented": False,
            "requires": ["GOOGLE_APPLICATION_CREDENTIALS"],
            "models": ["latest_long", "telephony"],
            "default_model": "telephony",
        },
        {
            "key": "sarvam",
            "label": "Sarvam AI (Indic)",
            "implemented": False,
            "requires": ["SARVAM_API_KEY"],
            "models": ["saarika:v2"],
            "default_model": "saarika:v2",
        },
    ],
    "llm": [
        {
            "key": "groq",
            "label": "Groq",
            "implemented": True,
            "requires": ["GROQ_API_KEY"],
            "models": [
                "llama-3.3-70b-versatile",
                "llama-3.1-8b-instant",
                "openai/gpt-oss-120b",
            ],
            "default_model": "llama-3.3-70b-versatile",
        },
        {
            "key": "openai",
            "label": "OpenAI",
            "implemented": False,
            "requires": ["OPENAI_API_KEY"],
            "models": ["gpt-4o-mini", "gpt-4o"],
            "default_model": "gpt-4o-mini",
        },
        {
            "key": "anthropic",
            "label": "Anthropic",
            "implemented": False,
            "requires": ["ANTHROPIC_API_KEY"],
            "models": ["claude-sonnet-4-5", "claude-haiku-4-5"],
            "default_model": "claude-sonnet-4-5",
        },
        {
            "key": "gemini",
            "label": "Google Gemini",
            "implemented": True,
            "requires": ["GEMINI_API_KEY"],
            "models": [
                "gemini-3.5-flash-lite",
                "gemini-3.1-flash-lite",
                "gemini-3.5-flash",
                "gemini-3.6-flash",
            ],
            "default_model": "gemini-3.5-flash-lite",
        },
        {
            "key": "cerebras",
            "label": "Cerebras",
            "implemented": True,
            "requires": ["CEREBRAS_API_KEY"],
            # Real model ids returned by the Cerebras API for this account.
            "models": ["gpt-oss-120b", "zai-glm-4.7", "gemma-4-31b"],
            "default_model": "gpt-oss-120b",
        },
    ],
    "tts": [
        {
            "key": "cartesia",
            "label": "Cartesia",
            "implemented": True,
            "requires": ["CARTESIA_API_KEY"],
            "models": ["sonic-3", "sonic-2", "sonic-turbo"],
            "default_model": "sonic-3",
        },
        {
            "key": "elevenlabs",
            "label": "ElevenLabs",
            "implemented": False,
            "requires": ["ELEVENLABS_API_KEY"],
            "models": ["eleven_turbo_v2_5", "eleven_multilingual_v2"],
            "default_model": "eleven_turbo_v2_5",
        },
        {
            "key": "smallest",
            "label": "Smallest AI (Indic)",
            "implemented": False,
            "requires": ["SMALLEST_API_KEY"],
            "models": ["lightning"],
            "default_model": "lightning",
        },
        {
            "key": "azure",
            "label": "Azure Neural TTS",
            "implemented": False,
            "requires": ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"],
            "models": ["neural"],
            "default_model": "neural",
        },
    ],
    "telephony": [
        {
            "key": "exotel",
            "label": "Exotel (India)",
            "implemented": True,
            "requires": ["EXOTEL_API_KEY", "EXOTEL_API_TOKEN", "EXOTEL_ACCOUNT_SID"],
            "models": [],
            "default_model": "",
        },
        {
            "key": "twilio",
            "label": "Twilio (International)",
            "implemented": True,
            "requires": ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
            "models": [],
            "default_model": "",
        },
        {
            "key": "vobiz",
            "label": "Vobiz (India / Global)",
            "implemented": True,
            "requires": ["VOBIZ_AUTH_ID", "VOBIZ_AUTH_TOKEN", "VOBIZ_PHONE_NUMBER"],
            "models": [],
            "default_model": "",
        },
        {
            "key": "plivo",
            "label": "Plivo (International)",
            "implemented": True,
            "requires": ["PLIVO_AUTH_ID", "PLIVO_AUTH_TOKEN", "PLIVO_PHONE_NUMBER"],
            "models": [],
            "default_model": "",
        },
    ],
}

CAPABILITY_LABELS = {
    "stt": "Speech recognition",
    "llm": "Conversation engine",
    "tts": "Voice synthesis",
    "telephony": "Telephony",
}


def _has_credentials(requires: List[str]) -> bool:
    return all(bool(getattr(settings, name, "")) for name in requires)


def describe_providers() -> Dict[str, Any]:
    """Registry annotated with whether each provider is usable right now."""
    out: Dict[str, Any] = {}
    for capability, providers in PROVIDER_REGISTRY.items():
        described = []
        for provider in providers:
            configured = _has_credentials(provider["requires"])
            described.append(
                {
                    **{k: v for k, v in provider.items() if k != "requires"},
                    "configured": configured,
                    # Selectable only when the code path exists AND keys are present.
                    "available": bool(provider["implemented"] and configured),
                    "missing_env": [] if configured else provider["requires"],
                }
            )
        out[capability] = {"label": CAPABILITY_LABELS.get(capability, capability), "providers": described}
    return out
