import re
from datetime import datetime
import pytz


def get_ist_timestamp() -> str:
    """Get current timestamp in Indian Standard Time."""
    ist = pytz.timezone("Asia/Kolkata")
    now = datetime.now(ist)
    return now.strftime("%Y-%m-%d %H:%M:%S")


def normalize_phone_number(phone: str, target_length: int = 10) -> str:
    """Normalize phone numbers between 10-digit and 12-digit formats."""
    try:
        phone_str = str(phone).strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
        if "." in phone_str:
            phone_str = phone_str.split(".")[0]
        phone_str = re.sub(r"[^\d+]", "", phone_str)
        if phone_str.startswith("+"):
            phone_str = phone_str[1:]
        if len(phone_str) == 12 and phone_str.startswith("91"):
            return phone_str[2:] if target_length == 10 else phone_str
        if len(phone_str) == 10:
            return phone_str if target_length == 10 else f"91{phone_str}"
        if len(phone_str) == 11 and phone_str.startswith("0"):
            clean_number = phone_str[1:]
            return clean_number if target_length == 10 else f"91{clean_number}"
        return phone_str
    except Exception as exc:
        print(f"Error normalizing phone number {phone}: {exc}")
        return str(phone)


def get_last_4_digits(account_no: str) -> str:
    """Extract last 4 digits of an account number."""
    try:
        clean_account = re.sub(r"\D", "", str(account_no))
        return clean_account[-4:] if len(clean_account) >= 4 else clean_account
    except Exception:
        return str(account_no)


def validate_template_replacement(message: str) -> bool:
    """Check whether unreplaced template tokens remain."""
    try:
        if not message or not message.strip():
            return False
        return "{#var#}" not in message
    except Exception:
        return False


def safe_extract_string(data: dict, key: str, default: str = "") -> str:
    try:
        value = data.get(key, default)
        if value is None:
            return default
        return str(value).strip()
    except Exception:
        return default


def safe_extract_number(data: dict, key: str, default: str = "") -> str:
    try:
        value = data.get(key, default)
        if value is None:
            return default
        if isinstance(value, dict) and "$numberLong" in value:
            return str(value["$numberLong"]).strip()
        if isinstance(value, dict) and "$numberDouble" in value:
            return str(value["$numberDouble"]).strip()
        if isinstance(value, float):
            return str(int(value)) if value.is_integer() else str(value)
        return str(value).strip()
    except Exception:
        return default


def safe_extract_mobile(data: dict, key: str = "MOBILE_NO", default: str = "") -> str:
    try:
        value = data.get(key, default)
        if value is None:
            return default
        if isinstance(value, dict) and "$numberLong" in value:
            value = value["$numberLong"]
        if isinstance(value, dict) and "$numberDouble" in value:
            value = value["$numberDouble"]
        if isinstance(value, float):
            value = int(value)
        mobile_str = str(value).strip()
        if "." in mobile_str:
            mobile_str = mobile_str.split(".")[0]
        return mobile_str
    except Exception:
        return default


def is_message_valid(message: str) -> bool:
    try:
        return bool(message and message.strip() and "{#var#}" not in message)
    except Exception:
        return False


def normalize_campaign_flag(campaign_flag: str) -> str:
    try:
        if not campaign_flag:
            return ""
        return str(campaign_flag).upper().replace(" ", "")
    except Exception:
        return ""


def get_sms_unit_value(campaign_flag: str, sms_type: str) -> int:
    campaign_normalized = normalize_campaign_flag(campaign_flag)
    if sms_type == "BOD":
        if campaign_normalized in {"BKT1", "BKT1&2", "BKT2"}:
            return 3
        return 2
    if sms_type == "EOD":
        return 1
    if sms_type == "PTP":
        return 1
    if sms_type == "PAID":
        return 1
    if sms_type == "PAYNOW":
        return 1
    return 1


def parse_date_range(start_date: str = None, end_date: str = None) -> tuple:
    if not start_date and not end_date:
        return (None, None)
    if end_date and not start_date:
        start_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(day=1)
        return (start_dt.strftime("%Y-%m-%d"), end_date)
    if start_date and not end_date:
        end_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_date = end_dt.replace(day=28)
        return (start_date, end_date.strftime("%Y-%m-%d"))
    return (start_date, end_date)


def calculate_pricing_tier(total_units: int) -> dict:
    rate_per_unit = 0.128
    tier_name = "> 500,000 units"
    if total_units <= 100000:
        rate_per_unit = 0.192
        tier_name = "<= 100,000 units"
    elif total_units <= 200000:
        rate_per_unit = 0.175
        tier_name = "<= 200,000 units"
    elif total_units <= 300000:
        rate_per_unit = 0.150
        tier_name = "<= 300,000 units"
    elif total_units <= 400000:
        rate_per_unit = 0.141
        tier_name = "<= 400,000 units"
    elif total_units <= 500000:
        rate_per_unit = 0.128
        tier_name = "<= 500,000 units"
    total_cost = round(total_units * rate_per_unit, 2)
    return {"units": total_units, "rate_per_unit": rate_per_unit, "tier": tier_name, "total_cost": total_cost}
