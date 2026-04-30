"""
Shared Cosmos DB Client -> Migrated to Supabase Postgres
Centralized database initialization and common operations for all Azure Functions.
"""
import os
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from azure.storage.blob import BlobServiceClient, ContentSettings
from supabase import create_client, Client

class _Exceptions:
    class CosmosResourceNotFoundError(Exception):
        pass
exceptions = _Exceptions()

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
    if name in _secrets_cache:
        return _secrets_cache[name]
    try:
        if _kv_client:
            secret = _kv_client.get_secret(name)
            _secrets_cache[name] = secret.value
            return secret.value
    except Exception:
        pass
    val = os.environ.get(name) or os.environ.get(name.upper().replace("-", "_"))
    if val:
        _secrets_cache[name] = val
    return val

# ─── Supabase DB Setup ───
_supabase_client = None
DATABASE_NAME = "FypodDB"
ADMIN_DATABASE_NAME = os.environ.get("COSMOS_ADMIN_DATABASE_NAME", "FypodAdminDB")
ALLOWED_ADMIN_EMAIL = (os.environ.get("ALLOWED_ADMIN_EMAIL") or "okitr52@gmail.com").strip().lower()
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

def _get_supabase() -> Client:
    global _supabase_client
    if _supabase_client:
        return _supabase_client
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or get_secret("SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        _supabase_client = create_client(url, key)
    return _supabase_client

class ContainerProxy:
    def __init__(self, table_name: str):
        mapping = {
            "Users": "users",
            "AnalysisHistory": "analysis_history",
            "UjangChats": "ujang_chats",
            "UserActivity": "user_activity",
            "InterviewSessions": "interview_sessions",
            "AdminAuditLogs": "admin_audit_logs"
        }
        self.table_name = mapping.get(table_name, table_name.lower())

    def read_item(self, item: str, partition_key: str):
        client = _get_supabase()
        res = client.table(self.table_name).select("*").eq("id", item).execute()
        if not res.data:
            raise exceptions.CosmosResourceNotFoundError(f"Item {item} not found")
        return res.data[0].get("data", {})

    def upsert_item(self, doc: dict):
        client = _get_supabase()
        doc_id = doc.get("id")
        if not doc_id:
            raise ValueError("Document must have an 'id'")
        row = {"id": doc_id, "data": doc}
        client.table(self.table_name).upsert(row).execute()

    def create_item(self, doc: dict):
        client = _get_supabase()
        doc_id = doc.get("id")
        if not doc_id:
            raise ValueError("Document must have an 'id'")
        row = {"id": doc_id, "data": doc}
        client.table(self.table_name).insert(row).execute()

    def delete_item(self, item: str, partition_key: str):
        client = _get_supabase()
        client.table(self.table_name).delete().eq("id", item).execute()

    def patch_item(self, item: str, partition_key: str, patch_operations: list):
        client = _get_supabase()
        res = client.table(self.table_name).select("*").eq("id", item).execute()
        if not res.data:
            raise exceptions.CosmosResourceNotFoundError()
        doc = res.data[0].get("data", {})
        for op in patch_operations:
            if op.get("op") == "add" or op.get("op") == "replace":
                path = op.get("path", "").lstrip("/")
                doc[path] = op.get("value")
        self.upsert_item(doc)

    def query_items(self, query: str, parameters: list = None, **kwargs):
        client = _get_supabase()
        q = query.strip()
        params = {p["name"]: p["value"] for p in (parameters or [])}

        if q == "SELECT VALUE COUNT(1) FROM c":
            res = client.table(self.table_name).select("id", count="exact").execute()
            count = res.count if hasattr(res, 'count') and res.count is not None else len(res.data)
            return [count]

        if "SELECT VALUE COUNT(1) FROM c WHERE c.is_banned = true" in q:
            res = client.table(self.table_name).select("data").execute()
            return [sum(1 for row in res.data if row.get("data", {}).get("is_banned") is True)]

        if "SELECT VALUE COUNT(1) FROM c WHERE IS_DEFINED(c.total_quiz_submissions) AND c.total_quiz_submissions > 0" in q:
            res = client.table(self.table_name).select("data").execute()
            return [sum(1 for row in res.data if row.get("data", {}).get("total_quiz_submissions", 0) > 0)]

        if "SELECT VALUE COUNT(1) FROM c WHERE IS_DEFINED(c.last_activity_at) AND c.last_activity_at >=" in q:
            cutoff = params.get("@cutoff")
            res = client.table(self.table_name).select("data").execute()
            return [sum(1 for row in res.data if row.get("data", {}).get("last_activity_at", "") >= cutoff)]

        if "SELECT VALUE COUNT(1) FROM c WHERE c.userId =" in q and "started_at >=" in q:
            uid = params.get("@uid")
            cutoff = params.get("@window_start")
            res = client.table(self.table_name).select("data").eq("data->>userId", uid).execute()
            return [sum(1 for row in res.data if row.get("data", {}).get("started_at", "") >= cutoff)]

        if "JOIN m IN c.messages" in q:
            uid = params.get("@uid")
            cutoff = params.get("@window_start")
            res = client.table(self.table_name).select("data").eq("data->>userId", uid).execute()
            count = 0
            for row in res.data:
                msgs = row.get("data", {}).get("messages", [])
                count += sum(1 for m in msgs if m.get("role") == "user" and m.get("ts", "") >= cutoff)
            return [count]

        if "SELECT TOP 1 c.testing_plan_override, c.email, c.role FROM c WHERE LOWER(c.email) =" in q:
            email = params.get("@email")
            res = client.table(self.table_name).select("data").execute()
            for row in res.data:
                d = row.get("data", {})
                if str(d.get("email", "")).lower() == email:
                    return [d]
            return []

        if "SELECT c.id FROM c WHERE IS_DEFINED(c.email) AND LOWER(c.email) =" in q:
            email = params.get("@email")
            res = client.table(self.table_name).select("data").execute()
            for row in res.data:
                d = row.get("data", {})
                if str(d.get("email", "")).lower() == email:
                    return [d]
            return []

        if "SELECT TOP 1 c.is_banned, c.banned_reason FROM c WHERE IS_DEFINED(c.email) AND LOWER(c.email) =" in q:
            email = params.get("@email")
            res = client.table(self.table_name).select("data").execute()
            for row in res.data:
                d = row.get("data", {})
                if str(d.get("email", "")).lower() == email and d.get("is_banned") is True:
                    return [d]
            return []

        if "SELECT * FROM c WHERE c.userId = @uid AND c.analysis_plan = @plan" in q:
            uid = params.get("@uid")
            plan = params.get("@plan")
            url = params.get("@url")
            job = params.get("@job")
            res = client.table(self.table_name).select("data").eq("data->>userId", uid).execute()
            matched = []
            for row in res.data:
                d = row.get("data", {})
                if d.get("analysis_plan") == plan and (d.get("url") == url or d.get("jobTitle") == job):
                    matched.append(d)
            matched.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            return matched

        if "SELECT c.id FROM c WHERE c.userId = @uid AND c.analysisId = @aid" in q:
            uid = params.get("@uid")
            aid = params.get("@aid")
            res = client.table(self.table_name).select("data").eq("data->>userId", uid).execute()
            return [row["data"] for row in res.data if row.get("data", {}).get("analysisId") == aid]

        if "SELECT c.id FROM c WHERE c.userId = @uid AND (c.analysisId = @aid OR" in q:
            uid = params.get("@uid")
            aid = params.get("@aid")
            res = client.table(self.table_name).select("data").eq("data->>userId", uid).execute()
            matched = []
            for row in res.data:
                d = row.get("data", {})
                if d.get("analysisId") == aid or d.get("metadata", {}).get("analysisId") == aid:
                    matched.append(d)
            return matched

        if "SELECT c.id, c.jobTitle" in q and "OFFSET" in q:
            uid = params.get("@uid")
            res = client.table(self.table_name).select("data").eq("data->>userId", uid).execute()
            docs = [row["data"] for row in res.data]
            docs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            try:
                offset_str = q.split("OFFSET")[1].split("LIMIT")[0].strip()
                limit_str = q.split("LIMIT")[1].strip()
                offset = int(offset_str)
                limit = int(limit_str)
                return docs[offset:offset+limit]
            except Exception:
                return docs

        if "SELECT TOP 1 c.latest_assistant_message" in q:
            uid = params.get("@uid")
            pkey = params.get("@pkey")
            cutoff = params.get("@cutoff")
            res = client.table(self.table_name).select("data").eq("data->>userId", uid).execute()
            docs = [row["data"] for row in res.data if row.get("data", {}).get("prompt_key") == pkey and row.get("data", {}).get("created_at", "") >= cutoff]
            docs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            return docs[:1]

        if "SELECT TOP" in q and "CONTAINS(LOWER(c.email)" in q:
            search = params.get("@search", "").lower()
            res = client.table(self.table_name).select("data").execute()
            docs = [row["data"] for row in res.data if search in str(row.get("data", {}).get("email", "")).lower()]
            docs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            return docs

        if "SELECT c.id FROM c WHERE c.role !=" in q:
            admin_role = params.get("@admin_role")
            res = client.table(self.table_name).select("data").execute()
            return [row["data"] for row in res.data if row.get("data", {}).get("role") != admin_role]

        if "SELECT * FROM c WHERE c.userId = @uid ORDER BY c.created_at DESC" in q or "SELECT * FROM c WHERE c.userId = @uid" in q:
            uid = params.get("@uid")
            res = client.table(self.table_name).select("data").eq("data->>userId", uid).execute()
            docs = [row["data"] for row in res.data]
            docs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            return docs

        if "SELECT * FROM c ORDER BY c.created_at DESC" in q:
            res = client.table(self.table_name).select("data").execute()
            docs = [row["data"] for row in res.data]
            docs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            return docs

        res = client.table(self.table_name).select("data").execute()
        return [row["data"] for row in res.data]

def get_container(container_name: str):
    return ContainerProxy(container_name)

def get_admin_container(container_name: str):
    return ContainerProxy(container_name)

def log_admin_audit(action: str, admin_user_id: str, payload: Dict[str, Any]):
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
    global _blob_service_client
    if _blob_service_client:
        return _blob_service_client
    conn_str = os.environ.get("AZURE_STORAGE_CONNECTION_STRING") or get_secret("azure-storage-connection-string")
    if conn_str:
        _blob_service_client = BlobServiceClient.from_connection_string(conn_str)
    return _blob_service_client

def upload_blob(blob_name: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    service = _get_blob_service()
    if not service:
        raise RuntimeError("Azure Blob Storage not configured. Set AZURE_STORAGE_CONNECTION_STRING.")
    container_client = service.get_container_client(BLOB_CONTAINER_NAME)
    blob_client = container_client.get_blob_client(blob_name)
    blob_client.upload_blob(
        data,
        overwrite=True,
        content_settings=ContentSettings(content_type=content_type, content_disposition="inline"),
    )
    return blob_client.url

def delete_blob(blob_name: str):
    try:
        service = _get_blob_service()
        if not service:
            return
        container_client = service.get_container_client(BLOB_CONTAINER_NAME)
        container_client.delete_blob(blob_name)
    except Exception as e:
        logging.warning(f"delete_blob failed for {blob_name}: {e}")

def delete_user_blobs(user_id: str):
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
    try:
        return ZoneInfo(timezone_str or "Asia/Jakarta")
    except Exception:
        return ZoneInfo("Asia/Jakarta")

def _parse_stored_datetime(value: str, user_tz: ZoneInfo) -> datetime:
    raw = str(value or "").strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
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
                exp_text = str(exp_raw).strip()
                if exp_text.endswith("Z"):
                    exp_text = exp_text[:-1] + "+00:00"
                expires = datetime.fromisoformat(exp_text)
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
def get_or_create_user(user_id: str, email: str = "", timezone_str: str = "") -> Dict[str, Any]:
    container = get_container("Users")
    try:
        user = container.read_item(item=user_id, partition_key=user_id)
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

        if timezone_str and user.get("timezone") != timezone_str:
            user["timezone"] = timezone_str
            changed = True

        if expected_role != "admin" and normalized_email and user.get("is_trial") and not user.get("welcome_email_sent_at"):
            try:
                from shared.email_service import send_trial_welcome_email
                send_trial_welcome_email(normalized_email, normalized_email)
                user["welcome_email_sent_at"] = datetime.utcnow().isoformat()
                changed = True
                logging.info(f"Retry welcome email sent to {normalized_email}")
            except Exception as exc:
                logging.warning(f"Retry trial welcome email failed: {exc}")

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
            "timezone": timezone_str or "Asia/Jakarta",
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
                container.patch_item(
                    item=user_id,
                    partition_key=user_id,
                    patch_operations=[{
                        "op": "add",
                        "path": "/welcome_email_sent_at",
                        "value": datetime.utcnow().isoformat()
                    }]
                )
            except Exception as exc:
                logging.warning(f"Trial welcome email failed: {exc}")
        return doc

def check_and_regen_credits(user_id: str, email: str = "") -> Dict[str, Any]:
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

    if effective_plan == "free" and str(user.get("plan") or "").lower() in ("basic", "pro"):
        user["plan"] = "free"
        user["plan_expires_at"] = None
        changed = True

    if days_passed > 0:
        current_credits = user.get("credits_remaining", 0)
        new_credits = min(credit_cap, current_credits + (days_passed * daily_regen))
        user["credits_remaining"] = new_credits
        user["last_regen_date"] = local_now.isoformat()
        changed = True

    if int(user.get("credits_remaining", 0)) > credit_cap:
        user["credits_remaining"] = credit_cap
        changed = True

    if changed:
        container = get_container("Users")
        container.upsert_item(user)

    return user

def deduct_credit(user_id: str) -> int:
    container = get_container("Users")
    user = container.read_item(item=user_id, partition_key=user_id)
    if user.get("role") == "admin":
        return 999999
    user["credits_remaining"] = max(0, user.get("credits_remaining", 0) - 1)
    container.upsert_item(user)
    return user["credits_remaining"]

def deduct_credits(user_id: str, amount: int) -> int:
    container = get_container("Users")
    user = container.read_item(item=user_id, partition_key=user_id)
    if user.get("role") == "admin":
        return 999999
    amount = max(0, int(amount or 0))
    user["credits_remaining"] = max(0, user.get("credits_remaining", 0) - amount)
    container.upsert_item(user)
    return user["credits_remaining"]

def get_next_regen_time(user: Dict[str, Any]) -> str:
    user_tz = _get_user_tz(user.get("timezone", "Asia/Jakarta"))
    local_now = datetime.now(user_tz)
    tomorrow = local_now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return tomorrow.isoformat()

# ─── CV Operations ───
def save_user_cv(user_id: str, cv_text: str, filename: str, blob_url: str = "", page_images: List[str] = None) -> Dict[str, Any]:
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
