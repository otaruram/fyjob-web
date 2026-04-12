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
import io
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from azure.cosmos import CosmosClient, exceptions
from azure.storage.blob import BlobServiceClient, ContentSettings

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
ADMIN_DATABASE_NAME = os.environ.get("COSMOS_ADMIN_DATABASE_NAME", "FypodAdminDB")
ALLOWED_ADMIN_EMAIL = "okitr52@gmail.com"
MAX_CREDITS = 5
PLAN_CREDIT_CAPS = {
    "free": 5,
    "basic": 10,
    "pro": 20,
    "admin": 999999,
}
PLAN_DAILY_REGEN = {
    "free": 1,
    "basic": 2,
    "pro": 3,
    "admin": 0,
}
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


def get_admin_container(container_name: str):
    """Get a Cosmos DB container client from admin-specific database."""
    client = _get_cosmos()
    if not client:
        raise RuntimeError("Cosmos DB not configured")
    db = client.get_database_client(ADMIN_DATABASE_NAME)
    return db.get_container_client(container_name)


def log_admin_audit(action: str, admin_user_id: str, payload: Dict[str, Any]):
    """Write admin action audit trail into admin database."""
    try:
        container = get_admin_container("AdminAuditLogs")
        doc = {
            "id": f"{datetime.utcnow().timestamp()}-{admin_user_id}-{action}",
            "adminUserId": admin_user_id,
            "action": action,
            "payload": payload or {},
            "created_at": datetime.utcnow().isoformat(),
        }
        container.create_item(doc)
    except Exception as e:
        logging.warning(f"Failed to write admin audit log: {e}")


# ─── Azure Blob Storage Setup ───
BLOB_CONTAINER_NAME = "cv-files"
_blob_service_client = None


def _get_blob_service():
    """Get or create a cached BlobServiceClient."""
    global _blob_service_client
    if _blob_service_client:
        return _blob_service_client
    conn_str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING") or get_secret("azure-storage-connection-string")
    if conn_str:
        _blob_service_client = BlobServiceClient.from_connection_string(conn_str)
    return _blob_service_client


def upload_blob(blob_name: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """Upload a file to Azure Blob Storage and return its public URL.
    
    The container is set to public-blob access, so we return a direct URL
    instead of generating SAS tokens — simpler and avoids expiry issues at scale.
    """
    service = _get_blob_service()
    if not service:
        raise RuntimeError("Azure Blob Storage not configured. Set AZURE_STORAGE_CONNECTION_STRING.")
    
    container_client = service.get_container_client(BLOB_CONTAINER_NAME)
    blob_client = container_client.get_blob_client(blob_name)
    
    blob_client.upload_blob(
        data,
        overwrite=True,
        content_settings=ContentSettings(
            content_type=content_type,
            content_disposition="inline"
        ),
    )
    
    return blob_client.url


def delete_blob(blob_name: str):
    """Delete a blob from storage. Silently ignores if not found."""
    try:
        service = _get_blob_service()
        if not service:
            return
        container_client = service.get_container_client(BLOB_CONTAINER_NAME)
        container_client.delete_blob(blob_name)
    except Exception as e:
        logging.warning(f"delete_blob failed for {blob_name}: {e}")


def delete_user_blobs(user_id: str):
    """Delete all blobs for a user (PDF + all page PNGs)."""
    try:
        service = _get_blob_service()
        if not service:
            return
        container_client = service.get_container_client(BLOB_CONTAINER_NAME)
        blobs = container_client.list_blobs(name_starts_with=f"{user_id}/")
        for blob in blobs:
            container_client.delete_blob(blob.name)
    except Exception as e:
        logging.warning(f"delete_user_blobs failed for {user_id}: {e}")


# ─── Timezone Helpers ───
def _get_user_tz(timezone_str: str) -> ZoneInfo:
    """Resolve user's timezone, fallback to Asia/Jakarta."""
    try:
        return ZoneInfo(timezone_str or "Asia/Jakarta")
    except Exception:
        return ZoneInfo("Asia/Jakarta")


def _parse_stored_datetime(value: str, user_tz: ZoneInfo) -> datetime:
    """
    Parse stored ISO datetime safely.
    Naive datetimes are treated as UTC for backward compatibility.
    """
    try:
        dt = datetime.fromisoformat(value)
    except Exception:
        return datetime(2000, 1, 1, tzinfo=user_tz)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(user_tz)


def _normalize_email(email: str) -> str:
    return (email or "").strip().replace(" ", "").lower()


def is_allowed_admin_email(email: str) -> bool:
    return _normalize_email(email) == ALLOWED_ADMIN_EMAIL


def get_effective_plan(user: Dict[str, Any]) -> str:
    """Resolve effective plan with admin override and expiry fallback."""
    email = _normalize_email(user.get("email", ""))
    role = str(user.get("role", "")).strip().lower()
    is_admin = role == "admin" or is_allowed_admin_email(email)
    testing_override = str(user.get("testing_plan_override") or "").strip().lower()
    if is_admin and testing_override in {"free", "basic", "pro", "admin"}:
        return testing_override
    if is_admin:
        return "admin"

    plan = str(user.get("plan") or "free").strip().lower()
    if plan in ("basic", "pro"):
        exp_raw = user.get("plan_expires_at")
        if exp_raw:
            try:
                expires = datetime.fromisoformat(exp_raw)
                if expires.tzinfo is None:
                    expires = expires.replace(tzinfo=timezone.utc)
                if expires < datetime.now(timezone.utc):
                    return "free"
            except Exception:
                return "free"

    return plan if plan in ("free", "basic", "pro") else "free"


def get_plan_credit_cap(plan: str) -> int:
    return int(PLAN_CREDIT_CAPS.get((plan or "free").strip().lower(), MAX_CREDITS))


def get_plan_daily_regen(plan: str) -> int:
    normalized = (plan or "free").strip().lower()
    return int(PLAN_DAILY_REGEN.get(normalized, CREDIT_REGEN_PER_DAY))


# ─── User Operations ───
def get_or_create_user(user_id: str, email: str = "", timezone: str = "") -> Dict[str, Any]:
    """Get user from Users container, create if not exists."""
    container = get_container("Users")
    try:
        user = container.read_item(item=user_id, partition_key=user_id)
        # Enforce strict single-admin-email policy for existing users too.
        normalized_email = _normalize_email(email or user.get("email", ""))
        if normalized_email and user.get("email") != normalized_email:
            user["email"] = normalized_email

        expected_role = "admin" if is_allowed_admin_email(normalized_email) else "user"
        changed = False
        if user.get("role") != expected_role:
            user["role"] = expected_role
            if expected_role == "admin":
                user["credits_remaining"] = 999999
            elif user.get("credits_remaining", 0) > get_plan_credit_cap(get_effective_plan(user)):
                user["credits_remaining"] = get_plan_credit_cap(get_effective_plan(user))
            changed = True

        expected_plan = "pro" if expected_role == "admin" else "free"
        if user.get("plan") not in {"free", "basic", "pro"}:
            user["plan"] = expected_plan
            changed = True
        elif expected_role == "admin" and user.get("plan") != "pro":
            user["plan"] = "pro"
            changed = True

        # Update timezone if provided and different
        if timezone and user.get("timezone") != timezone:
            user["timezone"] = timezone
            changed = True

        if changed:
            container.upsert_item(user)
        return user
    except exceptions.CosmosResourceNotFoundError:
        normalized_email = _normalize_email(email)
        is_admin = is_allowed_admin_email(normalized_email)
        now = datetime.utcnow()
        trial_expires = (now + timedelta(days=7)).isoformat() if not is_admin else None
        doc = {
            "id": user_id,
            "email": normalized_email,
            "role": "admin" if is_admin else "user",
            "plan": "pro",
            "plan_expires_at": trial_expires,
            "trial_started_at": now.isoformat() if not is_admin else None,
            "is_trial": not is_admin,
            "credits_remaining": 999999 if is_admin else get_plan_credit_cap("pro"),
            "last_regen_date": now.isoformat(),
            "timezone": timezone or "Asia/Jakarta",
            "raw_cv_text": "",
            "cv_filename": "",
            "cv_blob_url": "",
            "cv_page_images": [],
            "created_at": now.isoformat()
        }
        container.create_item(doc)
        if not is_admin and normalized_email:
            try:
                from shared.email_service import send_trial_welcome_email
                send_trial_welcome_email(normalized_email, normalized_email)
            except Exception as exc:
                logging.warning(f"Trial welcome email failed: {exc}")
        return doc


def check_and_regen_credits(user_id: str, email: str = "") -> Dict[str, Any]:
    """
    Credit regeneration logic:
    - At local midnight, add +1 credit (not full reset)
    - Cap at MAX_CREDITS (5)
    - Calculate how many days passed and add accordingly
    """
    user = get_or_create_user(user_id, email)
    effective_plan = get_effective_plan(user)
    credit_cap = get_plan_credit_cap(effective_plan)
    daily_regen = get_plan_daily_regen(effective_plan)

    if effective_plan == "admin":
        return user

    user_tz = _get_user_tz(user.get("timezone", "Asia/Jakarta"))
    local_now = datetime.now(user_tz)
    today_local = local_now.date()

    last_regen_str = user.get("last_regen_date", user.get("last_reset", "2000-01-01"))
    last_regen = _parse_stored_datetime(last_regen_str, user_tz).date()

    days_passed = (today_local - last_regen).days

    changed = False

    # Keep stored plan in sync when an old paid plan is expired
    if effective_plan == "free" and str(user.get("plan") or "").lower() in ("basic", "pro"):
        user["plan"] = "free"
        user["plan_expires_at"] = None
        changed = True

    if days_passed > 0:
        current_credits = user.get("credits_remaining", 0)
        # Add credits by plan rate per day passed, capped by plan
        new_credits = min(credit_cap, current_credits + (days_passed * daily_regen))
        user["credits_remaining"] = new_credits
        user["last_regen_date"] = local_now.isoformat()
        changed = True

    # Clamp overflow if old data has higher credits than current plan cap
    if int(user.get("credits_remaining", 0)) > credit_cap:
        user["credits_remaining"] = credit_cap
        changed = True

    if changed:
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


def deduct_credits(user_id: str, amount: int) -> int:
    """Deduct multiple credits atomically within one user document update."""
    container = get_container("Users")
    user = container.read_item(item=user_id, partition_key=user_id)
    if user.get("role") == "admin":
        return 999999

    amount = max(0, int(amount or 0))
    user["credits_remaining"] = max(0, user.get("credits_remaining", 0) - amount)
    container.upsert_item(user)
    return user["credits_remaining"]


def get_next_regen_time(user: Dict[str, Any]) -> str:
    """Calculate when user's next credit regenerates (local midnight)."""
    user_tz = _get_user_tz(user.get("timezone", "Asia/Jakarta"))
    local_now = datetime.now(user_tz)
    tomorrow = local_now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return tomorrow.isoformat()


# ─── CV Operations ───
def save_user_cv(user_id: str, cv_text: str, filename: str,
                 blob_url: str = "", page_images: List[str] = None) -> Dict[str, Any]:
    """Save/replace user CV. Only 1 CV allowed — old one is overwritten.
    
    Now also stores blob_url (original PDF) and page_images (PNG URLs)
    for the new visual preview system.
    """
    container = get_container("Users")
    user = container.read_item(item=user_id, partition_key=user_id)
    user["raw_cv_text"] = cv_text
    user["cv_filename"] = filename
    user["cv_uploaded_at"] = datetime.utcnow().isoformat()
    user["cv_blob_url"] = blob_url
    user["cv_page_images"] = page_images or []
    container.upsert_item(user)
    return user


def delete_user_cv(user_id: str) -> Dict[str, Any]:
    """Delete user's CV data and associated blobs."""
    # Delete blobs first
    delete_user_blobs(user_id)
    
    container = get_container("Users")
    user = container.read_item(item=user_id, partition_key=user_id)
    user["raw_cv_text"] = ""
    user["cv_filename"] = ""
    user["cv_blob_url"] = ""
    user["cv_page_images"] = []
    user.pop("cv_uploaded_at", None)
    container.upsert_item(user)
    return user

