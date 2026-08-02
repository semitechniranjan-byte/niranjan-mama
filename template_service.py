from typing import Any, Dict, List, Optional

_DIGIT_WORDS = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
}

# Languages the bot supports out of the box, with the STT/TTS codes each provider wants.
SUPPORTED_LANGUAGES: Dict[str, Dict[str, str]] = {
    "english": {"label": "English", "stt": "en", "tts": "en"},
    "hindi": {"label": "हिन्दी Hindi", "stt": "hi", "tts": "hi"},
    "tamil": {"label": "தமிழ் Tamil", "stt": "ta", "tts": "ta"},
    "telugu": {"label": "తెలుగు Telugu", "stt": "te", "tts": "te"},
    "kannada": {"label": "ಕನ್ನಡ Kannada", "stt": "kn", "tts": "kn"},
    "malayalam": {"label": "മലയാളം Malayalam", "stt": "ml", "tts": "ml"},
    "marathi": {"label": "मराठी Marathi", "stt": "mr", "tts": "mr"},
    "gujarati": {"label": "ગુજરાતી Gujarati", "stt": "gu", "tts": "gu"},
    "bengali": {"label": "বাংলা Bengali", "stt": "bn", "tts": "bn"},
    "punjabi": {"label": "ਪੰਜਾਬੀ Punjabi", "stt": "pa", "tts": "pa"},
    "odia": {"label": "ଓଡ଼ିଆ Odia", "stt": "or", "tts": "or"},
    "urdu": {"label": "اردو Urdu", "stt": "ur", "tts": "ur"},
}

AUTO = "auto"


def _to_lowercase(value: Any) -> str:
    return str(value).lower()


def _convert_digits_to_words(value: Any) -> str:
    return " ".join(_DIGIT_WORDS.get(ch, ch) for ch in str(value) if ch.strip())


TRANSFORMS = {
    "to_lowercase": _to_lowercase,
    "convert_digits_to_words": _convert_digits_to_words,
}


def apply_format_value_transforms(template: dict, row_data: Dict[str, Any]) -> Dict[str, Any]:
    methods = template.get("format_values_mapping_methods") or {}
    result = dict(row_data)
    for field, spec in methods.items():
        if field not in result:
            continue
        fn = TRANSFORMS.get((spec or {}).get("method", ""))
        if fn:
            result[field] = fn(result[field])
    return result


# --------------------------------------------------------------------------------------
# Use case × language resolution
#
# A template holds many use cases (EMI collection, sales, survey ...) and each use case
# holds one config per language. A campaign picks the use case, and picks either a single
# language for the whole run or "auto" to read each row's own language column.
# --------------------------------------------------------------------------------------


def list_use_cases(template: dict) -> List[str]:
    return list((template.get("use_cases") or {}).keys())


def list_languages(template: dict, use_case: Optional[str] = None) -> List[str]:
    use_cases = template.get("use_cases") or {}
    key = use_case if use_case in use_cases else next(iter(use_cases), None)
    if not key:
        return []
    return list(((use_cases.get(key) or {}).get("languages") or {}).keys())


def resolve_use_case_key(template: dict, requested: Optional[str] = None) -> str:
    use_cases = template.get("use_cases") or {}
    if requested and requested in use_cases:
        return requested
    default = template.get("default_use_case")
    if default and default in use_cases:
        return default
    return next(iter(use_cases), "default")


def resolve_language_key(
    template: dict,
    row_data: Dict[str, Any],
    requested: Optional[str] = None,
    use_case: Optional[str] = None,
) -> str:
    """Pick the language for one row.

    A concrete `requested` language pins the whole campaign to it. "auto" (or nothing)
    falls back to the row's own language column, then the template default.
    """
    available = list_languages(template, use_case)

    if requested and requested != AUTO:
        return requested

    column = template.get("language_column")
    if column:
        raw = str(row_data.get(column, "")).strip()
        if raw:
            mapping = template.get("language_column_mapping") or {}
            mapped = mapping.get(raw.upper()) or mapping.get(raw)
            if mapped:
                return mapped
            # Fall back to matching the column value directly against a language key.
            if raw.lower() in available:
                return raw.lower()

    default_language = template.get("default_language")
    if default_language:
        return default_language
    return available[0] if available else "default"


def _legacy_config(template: dict, variant: str) -> Dict[str, Any]:
    """Read the older flat per-variant dicts (prompts/greetings/... keyed by variant).

    Kept so templates saved before use cases existed keep working unchanged.
    """
    def pick(field: str, fallback: str = "") -> str:
        values = template.get(field) or {}
        return values.get(variant) or values.get("default") or fallback

    return {
        "system_prompt": pick("prompts"),
        "analysis_prompt": pick("analysis_prompts"),
        "greeting_text": pick("greetings"),
        "stt_language": pick("stt_lan_codes", "en"),
        "tts_language": pick("tts_lan_codes", "en"),
        "tts_voice_id": pick("tts_voice_ids"),
        "tts_model_id": pick("tts_model_ids", "sonic-3"),
    }


def resolve_template_config(
    template: dict,
    row_data: Dict[str, Any],
    language: Optional[str] = None,
    use_case: Optional[str] = None,
) -> Dict[str, Any]:
    """Resolve the prompt/greeting/voice config for one row.

    Falls back: requested language -> template default language -> any language ->
    the legacy flat variant dicts.
    """
    use_cases = template.get("use_cases") or {}

    if not use_cases:
        variant = language if (language and language != AUTO) else "default"
        cfg = _legacy_config(template, variant)
        cfg.update({"use_case": "default", "language": variant})
        return cfg

    use_case_key = resolve_use_case_key(template, use_case)
    language_key = resolve_language_key(template, row_data, language, use_case_key)

    languages = ((use_cases.get(use_case_key) or {}).get("languages") or {})
    entry = languages.get(language_key)
    if not entry:
        fallback_key = template.get("default_language")
        entry = languages.get(fallback_key) if fallback_key else None
    if not entry and languages:
        fallback_key, entry = next(iter(languages.items()))
        language_key = fallback_key

    entry = entry or {}
    lang_defaults = SUPPORTED_LANGUAGES.get(language_key, {})

    return {
        "use_case": use_case_key,
        "language": language_key,
        "system_prompt": entry.get("prompt") or "",
        "analysis_prompt": entry.get("analysis_prompt") or "",
        "greeting_text": entry.get("greeting") or "",
        "stt_language": entry.get("stt_lan_code") or lang_defaults.get("stt") or "en",
        "tts_language": entry.get("tts_lan_code") or lang_defaults.get("tts") or "en",
        "tts_voice_id": entry.get("tts_voice_id") or "",
        "tts_model_id": entry.get("tts_model_id") or "sonic-3",
    }


def resolve_path(doc: Optional[dict], path: str) -> Any:
    if not doc or not path:
        return None
    current: Any = doc
    for part in path.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def resolve_path_with_fallbacks(doc: Optional[dict], path_spec: str) -> Any:
    for path in path_spec.split("|"):
        value = resolve_path(doc, path.strip())
        if value is not None:
            return value
    return None


def apply_update_columns_mapping(session_doc: Optional[dict], mapping: Dict[str, str]) -> Dict[str, Any]:
    return {
        f"data.{output_col}": resolve_path_with_fallbacks(session_doc, path_spec)
        for output_col, path_spec in (mapping or {}).items()
    }
