import re
from datetime import datetime

try:
    from num2words import num2words
except Exception:  # pragma: no cover
    num2words = None


def format_prompt_with_placeholders(prompt: str, format_values: dict, logger_instance) -> str:
    """Format prompt by replacing placeholders with actual values."""
    if not prompt:
        return prompt

    case_insensitive_values = {}
    if format_values:
        for key, value in format_values.items():
            case_insensitive_values[str(key).lower()] = value

    class SafeDict(dict):
        def __missing__(self, key):
            lowercase_key = str(key).lower()
            if lowercase_key in case_insensitive_values:
                return case_insensitive_values[lowercase_key]
            if logger_instance is not None:
                logger_instance.warning("[Prompt Formatting] Missing placeholder: %s", key)
            return ""

    format_dict = SafeDict(format_values or {})

    try:
        placeholders = re.findall(r"\{(\w+)\}", prompt)
        for placeholder in placeholders:
            value = format_dict.get(placeholder, None)
            if value is None:
                value = case_insensitive_values.get(placeholder.lower(), "")
            if not value or (isinstance(value, str) and value.strip() == ""):
                prompt = prompt.replace(f"{{{placeholder}}}", "")

        prompt = re.sub(r"\s+", " ", prompt)
        prompt = re.sub(r"\s+([.,!?])", r"\1", prompt)
        prompt = prompt.strip()

        def replace_placeholder(match):
            key = match.group(1)
            if key in format_dict:
                return str(format_dict[key])
            lowercase_key = key.lower()
            if lowercase_key in case_insensitive_values:
                return str(case_insensitive_values[lowercase_key])
            return match.group(0)

        prompt = re.sub(r"\{(\w+)\}", replace_placeholder, prompt)
    except Exception as exc:
        if logger_instance is not None:
            logger_instance.error("[Prompt Formatting] Error formatting prompt: %s", exc)
        return prompt

    return prompt


def enrich_format_values(format_values: dict, format_values_mapping_methods: dict, logger_instance) -> dict:
    if not format_values:
        return format_values
    enriched = dict(format_values)
    if format_values_mapping_methods:
        processor_map = {
            "expand_product_abbreviation": expand_product_abbreviation,
            "format_amount_to_english_words": format_amount_to_english_words,
            "format_date_to_words": format_date_to_words,
            "get_last_four_digits_as_words": get_last_four_digits_as_words,
            "convert_digits_to_words": convert_digits_to_words,
            "to_lowercase": to_lowercase,
        }
        for fv_key, method_config in (format_values_mapping_methods or {}).items():
            try:
                raw_val = enriched.get(fv_key, "") or (format_values or {}).get(fv_key, "")
                if raw_val is None or raw_val == "":
                    continue
                method_name = method_config if isinstance(method_config, str) else method_config.get("method")
                processor = processor_map.get(method_name)
                if processor is None:
                    continue
                enriched[fv_key] = processor(raw_val)
            except Exception as exc:
                if logger_instance is not None:
                    logger_instance.warning("[Format Values] Error enriching %s: %s", fv_key, exc)
    return enriched


def digit_to_word(s: str, last_n: int = 4) -> str:
    if not s:
        return ""
    digit_map = {"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine"}
    digits = [d for d in str(s) if d.isdigit()]
    if not digits:
        return ""
    words = " ".join(digit_map[d] for d in digits)
    return " ".join(words.split()[-last_n:])


def to_lowercase(val) -> str:
    if val is None:
        return ""
    try:
        return str(val).lower()
    except Exception:
        return str(val)


def convert_digits_to_words(digits_str, language="english") -> str:
    if not digits_str:
        return ""
    digit_map = {"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine"}
    words = []
    for digit in str(digits_str):
        if digit.isdigit():
            words.append(digit_map[digit])
    return " ".join(words)


def get_last_four_digits_as_words(account_no, language="english") -> str:
    if not account_no:
        return ""
    account_str = str(account_no)
    last_four = account_str[-4:] if len(account_str) >= 4 else account_str
    return convert_digits_to_words(last_four, language)


def expand_product_abbreviation(product_code, product_map_db=None) -> str:
    product_map = {"AL": "Auto Loan", "BL": "Business Loan", "LAP": "Loan Against Property", "MBL": "Micro Business Loan", "PL": "Personal Loan", "TW": "Two-Wheeler Loan", "USED CAR": "Used Car Loan"}
    if product_map_db:
        product_map = product_map_db
    if not product_code:
        return "loan"
    product_upper = str(product_code).upper().strip()
    return product_map.get(product_upper, product_code)


def format_amount_to_english_words(amount_str, language="english") -> str:
    if not amount_str:
        return ""
    numeric_amount = re.sub(r"[^\d.]", "", str(amount_str))
    if not numeric_amount:
        return str(amount_str)
    try:
        amount_int = int(float(numeric_amount))
        if num2words is not None:
            amount_words = num2words(amount_int, lang="en")
            return f"{amount_words} rupees"
        return f"{amount_int} rupees"
    except Exception:
        return str(amount_str)


def format_date_to_words(date_str, language="english") -> str:
    if not date_str:
        return ""
    try:
        if isinstance(date_str, datetime):
            date_obj = date_str
        else:
            date_part = str(date_str).split(" ")[0].strip()
            date_formats = ["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"]
            date_obj = None
            for date_format in date_formats:
                try:
                    date_obj = datetime.strptime(date_part, date_format)
                    break
                except ValueError:
                    continue
            if date_obj is None:
                return str(date_str)
        if num2words is not None:
            day_word = num2words(date_obj.day, to="ordinal")
            month_word = date_obj.strftime("%B")
            year_word = num2words(date_obj.year, lang="en")
            return f"{day_word} of {month_word} {year_word}"
        return date_obj.strftime("%Y-%m-%d")
    except Exception:
        return str(date_str)
