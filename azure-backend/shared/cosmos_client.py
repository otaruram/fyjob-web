"""
Shared Cosmos DB Client
Centralized database initialization and common operations for all Azure Functions.

Credit System:
- Max 5 credits per user
- At local midnight (user's timezone), +1 credit is added (not reset)
- Cap at 5 maximum
- Admin users have unlimited credits
"""
import os
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from azure.cosmos import CosmosClient, exceptions

# ─── Key Vault Setup ───
_kv_client = None
_secrets_cache = {}

try:
    credential = DefaultAzureCredential()
    key_vault_url = os.environ.get("KEY_VAULT_URL")
    if key_vault_url:
        _kv_client = SecretClient(vault_url=key_vault_url, credential=credential)
except Exception as e:
    logging.warning(f"Key Vault init failed (will use env vars): {e}")


def get_secret(name: str) -> Optional[str]:
    """Get secret from Key Vault with caching, fallback to env vars."""
    if name in _secrets_cache:
        return _secrets_cache[name]
    try:
        if _kv_client:
            secret = _kv_client.get_secret(name)
            _secrets_cache[name] = secret.value
            return secret.value
    except Exception:
        pass
    # Fallback: try env var with both naming conventions
    # Key Vault uses "jwt-supabase", App Settings uses "JWT_SUPABASE"
    val = os.environ.get(name) or os.environ.get(name.upper().replace("-", "_"))
    if val:
        _secrets_cache[name] = val
    return val


# ─── Cosmos DB Setup ───
_cosmos_client = None
DATABASE_NAME = "FypodDB"
MAX_CREDITS = 5
CREDIT_REGEN_PER_DAY = 1


def _get_cosmos():
    global _cosmos_client
    if _cosmos_client:
        return _cosmos_client
    endpoint = os.environ.get("COSMOS_ENDPOINT")
    key = os.environ.get("COSMOS_KEY") or get_secret("cosmos-key")
    if endpoint and key:
        _cosmos_client = CosmosClient(endpoint, key)
    return _cosmos_client


def get_container(container_name: str):
    """Get a Cosmos DB container client."""
    client = _get_cosmos()
    if not client:
        raise RuntimeError("Cosmos DB not configured")
    db = client.get_database_client(DATABASE_NAME)
    return db.get_container_client(container_name)


# ─── Timezone Helper ───
def _get_local_date(timezone_str: str) -> datetime:
    """Get current date in user's local timezone using UTC offset mapping."""
    tz_offsets = {
        "Asia/Jakarta": 7, "Asia/Makassar": 8, "Asia/Jayapura": 9,
        "Asia/Tokyo": 9, "Asia/Seoul": 9, "Asia/Shanghai": 8,
        "Asia/Singapore": 8, "Asia/Kolkata": 5.5, "Asia/Dubai": 4,
        "Europe/London": 0, "Europe/Berlin": 1, "Europe/Moscow": 3,
        "America/New_York": -5, "America/Chicago": -6,
        "America/Denver": -7, "America/Los_Angeles": -8,
        "Australia/Sydney": 11, "Pacific/Auckland": 13,
    }
    offset_hours = tz_offsets.get(timezone_str, 7)  # Default: WIB (UTC+7)
    return datetime.utcnow() + timedelta(hours=offset_hours)


# ─── User Operations ───
def get_or_create_user(user_id: str, email: str = "", timezone: str = "") -> Dict[str, Any]:
    """Get user from Users container, create if not exists."""
    container = get_container("Users")
    try:
        user = container.read_item(item=user_id, partition_key=user_id)
        # Update timezone if provided and different
        if timezone and user.get("timezone") != timezone:
            user["timezone"] = timezone
            container.upsert_item(user)
        return user
    except exceptions.CosmosResourceNotFoundError:
        is_admin = email == "okitr52@gmail.com"
        doc = {
            "id": user_id,
            "email": email,
            "role": "admin" if is_admin else "user",
            "credits_remaining": 999999 if is_admin else MAX_CREDITS,
            "last_regen_date": datetime.utcnow().isoformat(),
            "timezone": timezone or "Asia/Jakarta",
            "raw_cv_text": "",
            "cv_filename": "",
            "created_at": datetime.utcnow().isoformat()
        }
        container.create_item(doc)
        return doc


def check_and_regen_credits(user_id: str, email: str = "") -> Dict[str, Any]:
    """
    Credit regeneration logic:
    - At local midnight, add +1 credit (not full reset)
    - Cap at MAX_CREDITS (5)
    - Calculate how many days passed and add accordingly
    """
    user = get_or_create_user(user_id, email)
    if user.get("role") == "admin":
        return user

    user_tz = user.get("timezone", "Asia/Jakarta")
    local_now = _get_local_date(user_tz)
    today_local = local_now.date()

    last_regen_str = user.get("last_regen_date", user.get("last_reset", "2000-01-01"))
    try:
        last_regen = datetime.fromisoformat(last_regen_str).date()
    except (ValueError, TypeError):
        last_regen = datetime(2000, 1, 1).date()

    days_passed = (today_local - last_regen).days

    if days_passed > 0:
        current_credits = user.get("credits_remaining", 0)
        # Add +1 per day that passed, capped at MAX_CREDITS
        new_credits = min(MAX_CREDITS, current_credits + (days_passed * CREDIT_REGEN_PER_DAY))
        user["credits_remaining"] = new_credits
        user["last_regen_date"] = local_now.isoformat()

        container = get_container("Users")
        container.upsert_item(user)

    return user


def deduct_credit(user_id: str) -> int:
    """Deduct 1 credit, return remaining."""
    container = get_container("Users")
    user = container.read_item(item=user_id, partition_key=user_id)
    if user.get("role") == "admin":
        return 999999
    user["credits_remaining"] = max(0, user.get("credits_remaining", 0) - 1)
    container.upsert_item(user)
    return user["credits_remaining"]


def get_next_regen_time(user: Dict[str, Any]) -> str:
    """Calculate when user's next credit regenerates (local midnight)."""
    user_tz = user.get("timezone", "Asia/Jakarta")
    local_now = _get_local_date(user_tz)
    # Next midnight in user's timezone
    tomorrow = local_now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return tomorrow.isoformat()


# ─── CV Operations ───
def save_user_cv(user_id: str, cv_text: str, filename: str) -> Dict[str, Any]:
    """Save/replace user CV. Only 1 CV allowed — old one is overwritten."""
    container = get_container("Users")
    user = container.read_item(item=user_id, partition_key=user_id)
    user["raw_cv_text"] = cv_text
    user["cv_filename"] = filename
    user["cv_uploaded_at"] = datetime.utcnow().isoformat()
    container.upsert_item(user)
    return user


def delete_user_cv(user_id: str) -> Dict[str, Any]:
    """Delete user's CV data."""
    container = get_container("Users")
    user = container.read_item(item=user_id, partition_key=user_id)
    user["raw_cv_text"] = ""
    user["cv_filename"] = ""
    user.pop("cv_uploaded_at", None)
    container.upsert_item(user)
    return user
