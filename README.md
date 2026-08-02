# Minimal Voice Clone

This folder contains a simplified, separate clone of the voice-calling backend that keeps the essential building blocks:

- Deepgram for STT
- Groq for LLM responses
- Cartesia for TTS
- Twilio for inbound/outbound telephony
- MongoDB-backed session storage

## Structure

- `config.py` – environment-based configuration
- `db_service.py` – minimal MongoDB session/message storage
- `stt_service.py` – Deepgram wrapper
- `llm_service.py` – Groq wrapper
- `tts_service.py` – Cartesia TTS wrapper
- `twilio_service.py` – Twilio TwiML response helper
- `telephony_service.py` – Twilio call creation/hangup
- `main.py` – FastAPI app with webhook and assistant routes

## Quick start (backend)

1. Create a virtual environment and install dependencies:
   ```bash
   python -m venv .venv
   .venv/Scripts/python.exe -m pip install -r requirements.txt
   ```
2. Copy `.env.example` to `.env` and fill in your credentials (at minimum `MONGO_URI`; everything
   else can stay blank — the backend runs in offline mode with fallback LLM responses until you
   add Deepgram/Groq/Cartesia/Twilio keys).
3. Run the app (note: run this from inside the project folder, not as a package, since the folder
   name contains a space):
   ```bash
   .venv/Scripts/python.exe -m uvicorn api:app --reload --host 0.0.0.0 --port 8000
   ```
4. Check `GET http://localhost:8000/health`.

## Admin frontend

A React/Vite admin console lives in `frontend/` — dashboard, session/transcript browser, call
triggering, queue management, analytics jobs, and live config/log viewing.

```bash
cd frontend
npm install   # first time only
npm run dev
```

Open `http://localhost:5173`, connect with API URL `http://localhost:8000` and the `API_KEY`
value from `.env` (defaults to `dev-key`).

## Key endpoints

- `GET /health`
- `POST /webhooks/twilio/inbound`
- `POST /webhooks/twilio/status`
- `POST /calls/outbound`
- `POST /calls/queue`
- `POST /calls/queue/process`
- `POST /sessions/{session_id}/end`
- `POST /assistant/voice`

## Runtime behavior

- Queue-based calls are stored in MongoDB and can be processed by the queue worker endpoint.
- When Twilio credentials are not available, the clone runs in offline mode and still creates a session and queue entry.
- LLM responses use prompt templates, placeholder formatting, and dynamic fields when configured.
