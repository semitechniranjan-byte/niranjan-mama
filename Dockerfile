# ---- Stage 1: build the React frontend -------------------------------------
FROM node:20-alpine AS frontend

WORKDIR /ui

# Copy manifests first so npm install is cached unless dependencies actually change.
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install

COPY frontend/ ./
RUN npm run build


# ---- Stage 2: Python API that also serves the built UI ----------------------
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code. .dockerignore keeps .env, .venv and node_modules out of the image —
# secrets come from the host's environment variables, never from a baked-in file.
COPY *.py ./

# api.py serves this directory when it exists, so the UI and API share one origin.
COPY --from=frontend /ui/dist ./frontend/dist

# Render (and most PaaS hosts) inject the port to listen on. Default to 8000 for local
# `docker run`. Exec-form CMD can't expand ${PORT}, hence the shell form.
ENV PORT=8000
EXPOSE 8000

# One worker on purpose: call_registry keeps live calls in memory, so a second worker
# would not see the sessions the first one is handling.
CMD uvicorn api:app --host 0.0.0.0 --port ${PORT} --workers 1 --timeout-keep-alive 75
