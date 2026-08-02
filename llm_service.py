import json
import logging
import re
from typing import Any, Dict, List, Optional
from openai import AsyncOpenAI

try:
    from .config import settings
    from .helper_utils import format_prompt_with_placeholders
except ImportError:  # pragma: no cover
    from config import settings
    from helper_utils import format_prompt_with_placeholders

logger = logging.getLogger(__name__)


class _SafeDict(dict):
    def __missing__(self, key):
        return "{" + key + "}"


# OpenAI-compatible chat providers. Adding one here plus an entry in providers.py is all
# that is needed to make it selectable in Settings.
LLM_PROVIDERS = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "api_key_attr": "GROQ_API_KEY",
        "default_model_attr": "GROQ_MODEL",
    },
    "cerebras": {
        "base_url": "https://api.cerebras.ai/v1",
        "api_key_attr": "CEREBRAS_API_KEY",
        "default_model_attr": "CEREBRAS_MODEL",
    },
}

DEFAULT_LLM_PROVIDER = "groq"


class GroqLLMService:
    """Chat completion client for any OpenAI-compatible provider.

    Named for its original provider; it now speaks to whichever provider Settings selects,
    which matters because free tiers differ wildly in daily token allowance.
    """

    def __init__(self, provider: Optional[str] = None) -> None:
        self.client = None
        self.ready = False
        self.provider = DEFAULT_LLM_PROVIDER
        # Overridable per call so the provider/model chosen in Settings is honoured
        # instead of being pinned to the .env default.
        self.model = settings.GROQ_MODEL
        self.db_service = None
        self.session_id = None
        self.system_prompt_template = "You are a helpful voice assistant."
        self.format_values: Optional[Dict[str, Any]] = None
        self.dynamic_fields: Optional[Dict[str, Dict[str, Any]]] = None
        self.set_provider(provider or DEFAULT_LLM_PROVIDER)

    def set_provider(self, provider: Optional[str]) -> None:
        """Point the client at `provider`, keeping the current one if it is unusable."""
        key = (provider or "").strip().lower()
        spec = LLM_PROVIDERS.get(key)
        if not spec:
            if self.client is None:
                spec = LLM_PROVIDERS[DEFAULT_LLM_PROVIDER]
                key = DEFAULT_LLM_PROVIDER
            else:
                return

        api_key = getattr(settings, spec["api_key_attr"], "")
        if not api_key:
            # Leave any working client in place rather than breaking the call.
            if self.client is None:
                self.ready = False
            else:
                logger.warning("LLM provider %s has no API key; staying on %s", key, self.provider)
            return

        self.provider = key
        self.model = getattr(settings, spec["default_model_attr"], "") or self.model
        self.client = AsyncOpenAI(api_key=api_key, base_url=spec["base_url"])
        self.ready = True

    def set_model(self, model: Optional[str]) -> None:
        if model:
            self.model = model

    def set_db_service(self, db_service, session_id: Optional[str] = None) -> None:
        self.db_service = db_service
        self.session_id = session_id

    def set_system_prompt(self, system_prompt: Optional[str]) -> None:
        if system_prompt:
            self.system_prompt_template = system_prompt

    def set_format_values(self, format_values: Optional[Dict[str, Any]]) -> None:
        self.format_values = format_values or {}

    def set_dynamic_fields(self, dynamic_fields: Optional[Dict[str, Dict[str, Any]]]) -> None:
        self.dynamic_fields = dynamic_fields or {}

    def _format_prompt_text(self, text: str, format_values: Optional[Dict[str, Any]] = None) -> str:
        if not text:
            return text or ""
        values = format_values or self.format_values or {}
        return format_prompt_with_placeholders(text, values, logger)

    def _format_system_prompt(self, template: str, format_values: Optional[Dict[str, Any]] = None) -> str:
        if not template:
            template = self.system_prompt_template or "You are a helpful voice assistant."
        template = self._format_prompt_text(template, format_values)
        try:
            return template.format_map(_SafeDict(format_values or self.format_values or {}))
        except Exception as exc:
            logger.warning("Unable to format system prompt: %s", exc)
            return template

    def _extract_response_text(self, content: Optional[str]) -> str:
        if not content:
            return ""
        text = str(content).strip()
        if not text:
            return ""
        try:
            payload = json.loads(text)
            if isinstance(payload, dict):
                if payload.get("response"):
                    return str(payload["response"])
                if payload.get("content"):
                    return str(payload["content"])
                return json.dumps(payload)
        except Exception:
            pass

        match = re.search(r'"response"\s*:\s*"([^"]*)"', text)
        if match:
            return match.group(1)
        return text

    def _build_fallback_response(self, user_input: str, format_values: Optional[Dict[str, Any]] = None) -> str:
        values = format_values or self.format_values or {}
        if self.dynamic_fields:
            field_names = ", ".join(self.dynamic_fields.keys())
            return f"I can help with {field_names}. You asked: {user_input or 'for assistance'}."
        if values:
            name = values.get("customer_name") or values.get("name") or "there"
            return f"Hello {name}, I am ready to assist you."
        return f"I heard: {user_input or 'your request'}."

    def _validate(self) -> None:
        if not self.ready or self.client is None:
            raise RuntimeError("Groq credentials are not configured")

    async def get_conversation_history(self) -> List[Dict[str, str]]:
        if not self.db_service or not self.session_id:
            return []
        try:
            raw_history = await self.db_service.get_conversation_history(self.session_id)
            history = []
            for item in raw_history:
                role = item.get("role", "")
                content = item.get("content", "")
                if role in {"user", "assistant"} and content:
                    history.append({"role": role, "content": content})
            return history
        except Exception as exc:
            logger.warning("Could not load conversation history: %s", exc)
            return []

    async def generate_response(self, user_input: str, format_values: Optional[Dict] = None, conversation_history: Optional[List[Dict]] = None) -> str:
        effective_format_values = format_values or self.format_values or {}
        if conversation_history is None:
            conversation_history = await self.get_conversation_history()

        try:
            self._validate()
        except Exception as exc:
            logger.warning("Groq not available, using fallback response: %s", exc)
            return self._build_fallback_response(user_input, effective_format_values)

        system_prompt = self._format_system_prompt(self.system_prompt_template, effective_format_values)
        if self.dynamic_fields:
            required_fields = list(self.dynamic_fields.keys()) + ["response"]
            system_prompt = (
                f"{system_prompt}\n"
                f"Return a concise JSON object with the following fields: {', '.join(required_fields)}."
            )

        formatted_user_input = self._format_prompt_text(user_input, effective_format_values)
        messages = [{"role": "system", "content": system_prompt}]
        for item in conversation_history:
            role = item.get("role", "")
            content = item.get("content", "")
            if role in {"user", "assistant"} and content:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": formatted_user_input})

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.2,
                max_tokens=250,
            )
            content = response.choices[0].message.content or ""
        except Exception as exc:
            logger.warning("Groq call failed, using fallback response: %s", exc)
            return self._build_fallback_response(user_input, effective_format_values)

        return self._extract_response_text(content)
