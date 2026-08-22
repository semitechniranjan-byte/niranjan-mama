import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Settings:
    APP_NAME: str = "minimal-voice-clone"
    MONGO_URI: str = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    MONGO_DB: str = os.getenv("MONGO_DB", "voice_clone")

    DEEPGRAM_API_KEY: str = os.getenv("DEEPGRAM_API_KEY", "")
    DEEPGRAM_MODEL: str = os.getenv("DEEPGRAM_MODEL", "nova-2")
    DEEPGRAM_LANGUAGE: str = os.getenv("DEEPGRAM_LANGUAGE", "hi")

    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    CEREBRAS_API_KEY: str = os.getenv("CEREBRAS_API_KEY", "")
    CEREBRAS_MODEL: str = os.getenv("CEREBRAS_MODEL", "llama-3.3-70b")

    CARTESIA_API_KEY: str = os.getenv("CARTESIA_API_KEY", "")
    CARTESIA_VOICE_ID: str = os.getenv("CARTESIA_VOICE_ID", "")
    CARTESIA_MODEL_ID: str = os.getenv("CARTESIA_MODEL_ID", "sonic-3")
    CARTESIA_LANGUAGE: str = os.getenv("CARTESIA_LANGUAGE", "en")

    TWILIO_ACCOUNT_SID: str = os.getenv("TWILIO_ACCOUNT_SID", "")
    TWILIO_AUTH_TOKEN: str = os.getenv("TWILIO_AUTH_TOKEN", "")
    TWILIO_PHONE_NUMBER: str = os.getenv("TWILIO_PHONE_NUMBER", "")
    TWILIO_WEBHOOK_BASE_URL: str = os.getenv("TWILIO_WEBHOOK_BASE_URL", "http://localhost:8000")

    EXOTEL_ACCOUNT_SID: str = os.getenv("EXOTEL_ACCOUNT_SID", "")
    EXOTEL_API_KEY: str = os.getenv("EXOTEL_API_KEY", "")
    EXOTEL_API_TOKEN: str = os.getenv("EXOTEL_API_TOKEN", "")
    EXOTEL_SUBDOMAIN: str = os.getenv("EXOTEL_SUBDOMAIN", "api.exotel.com")
    EXOTEL_EXOPHONE: str = os.getenv("EXOTEL_EXOPHONE", "")
    EXOTEL_APP_ID: str = os.getenv("EXOTEL_APP_ID", "")
    EXOTEL_WEBHOOK_BASE_URL: str = os.getenv("EXOTEL_WEBHOOK_BASE_URL", "")

    PLIVO_AUTH_ID: str = os.getenv("PLIVO_AUTH_ID", "")
    PLIVO_AUTH_TOKEN: str = os.getenv("PLIVO_AUTH_TOKEN", "")
    PLIVO_PHONE_NUMBER: str = os.getenv("PLIVO_PHONE_NUMBER", "")
    PLIVO_WEBHOOK_BASE_URL: str = os.getenv("PLIVO_WEBHOOK_BASE_URL", "")
    # Plivo streams either L16 or mu-law; L16 matches what Deepgram wants without a
    # conversion step, so it is the default here the same way it is for Exotel.
    PLIVO_STREAM_CONTENT_TYPE: str = os.getenv("PLIVO_STREAM_CONTENT_TYPE", "audio/x-l16;rate=8000")

    VOBIZ_AUTH_ID: str = os.getenv("VOBIZ_AUTH_ID", "")
    VOBIZ_AUTH_TOKEN: str = os.getenv("VOBIZ_AUTH_TOKEN", "")
    VOBIZ_PHONE_NUMBER: str = os.getenv("VOBIZ_PHONE_NUMBER", "")
    VOBIZ_WEBHOOK_BASE_URL: str = os.getenv("VOBIZ_WEBHOOK_BASE_URL", "")
    VOBIZ_API_BASE: str = os.getenv("VOBIZ_API_BASE", "https://api.vobiz.ai/api/v1")
    # Vobiz accepts L16 at 8/16/24 kHz or mu-law at 8 kHz. L16 8 kHz matches what Deepgram
    # is fed elsewhere, so no resampling or codec conversion is needed.
    VOBIZ_STREAM_CONTENT_TYPE: str = os.getenv("VOBIZ_STREAM_CONTENT_TYPE", "audio/x-l16;rate=8000")

    API_KEY: str = os.getenv("API_KEY", "dev-key")


settings = Settings()
