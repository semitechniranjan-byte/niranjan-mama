# Deploying to Render (free tier)

One Docker service serves both the API and the React UI, so there is a single URL to hand
a client and no CORS configuration to maintain.

---

## 1. Prepare MongoDB Atlas

Render's free tier has no static outbound IP, so the database must accept connections from
anywhere.

1. Atlas → **Network Access** → **Add IP Address** → **Allow access from anywhere**
   (`0.0.0.0/0`).
2. Atlas → **Database Access** → confirm the user in your `MONGO_URI` still exists and the
   password matches.

Without step 1 the service starts but every request fails with a connection timeout.

---

## 2. Push to GitHub

The repository is not yet under version control. From the project folder:

```bash
git init
git add .
git commit -m "Voice agent: API + admin UI"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`.gitignore` excludes `.env`, `.venv/`, `node_modules/` and `frontend/dist/`.
**Confirm `.env` is not in the commit before pushing** — it holds live API keys:

```bash
git ls-files | grep -c "^\.env$"
```

That must print `0`. If it prints `1`, run `git rm --cached .env` and commit again.

---

## 3. Create the Render service

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**.
2. Connect the GitHub repo. Render reads `render.yaml` and proposes one web service
   named `voice-agent`.
3. Render prompts for every secret marked `sync: false`. Paste the values from your local
   `.env`:

   | Variable | Where it comes from |
   |---|---|
   | `MONGO_URI` | Atlas connection string |
   | `DEEPGRAM_API_KEY` | Deepgram console |
   | `GROQ_API_KEY` | Groq console |
   | `CEREBRAS_API_KEY` | Cerebras console |
   | `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID` | Cartesia dashboard |
   | `EXOTEL_*` | Exotel dashboard |
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Twilio console |
   | `PLIVO_*` | Plivo console (leave blank if unused) |

   `API_KEY` is generated automatically — copy it from the Render dashboard afterwards,
   it is the password for the admin UI login screen.

4. **Apply**. The first build takes 5–10 minutes (it compiles the frontend, then installs
   the Python dependencies).

---

## 4. Log in

Open `https://voice-agent-<hash>.onrender.com`. The login screen is pre-filled with the
correct API URL (the page's own origin); enter the generated `API_KEY` as the key.

---

## 5. Point telephony webhooks at the new URL

`render.yaml` sets `TWILIO_WEBHOOK_BASE_URL`, `EXOTEL_WEBHOOK_BASE_URL` and
`PLIVO_WEBHOOK_BASE_URL` to the service's own public URL automatically, so outbound calls
generate correct callback URLs with no extra work.

One thing must be changed by hand, because it lives in Exotel's dashboard rather than in
this repo — the **Voicebot applet URL** in App Bazaar flow:

```
wss://voice-agent-<hash>.onrender.com/exotel-stream
```

Twilio and Plivo need no dashboard change; their stream URLs are generated per call.

---

## Known limits of the free tier

These are worth stating plainly before a client demo.

**The service sleeps after 15 minutes of inactivity.** The next request wakes it, taking
roughly 50 seconds. For someone clicking through the UI this means a slow first page load.
For telephony it is more serious: an inbound webhook arriving at a sleeping service will
time out and the call will fail. Open the URL yourself a minute before any demo.

**One small instance, 512 MB RAM.** The 5-agent / 500-concurrent-call design will not run
here. This is a demo and UAT environment, not production capacity.

**Single worker, by design.** `call_registry` tracks live calls in memory, so a second
worker would not see the first one's sessions. Do not raise `--workers`; scaling this app
means one bigger instance, not more instances.

**Disk is ephemeral.** Anything written to the container filesystem — uploaded datasheets,
`exotel_stream_debug.json` — disappears on redeploy and on wake-from-sleep. Everything that
must survive belongs in MongoDB.

### Removing the sleep

Render's Starter plan (currently ~$7/month) keeps the service always on, which is the
minimum needed for telephony webhooks to work reliably. Alternatively Fly.io's free
allowance with `min_machines_running = 1` also stays awake.

---

## Running the production image locally

To reproduce exactly what Render builds:

```bash
docker build -t voice-agent .
docker run --rm -p 8000:8000 --env-file .env voice-agent
```

Then open <http://localhost:8000>.
