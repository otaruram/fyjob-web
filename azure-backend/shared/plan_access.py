import os
from datetime import datetime, timezone
from typing import Any, Dict

from .cosmos_client import get_effective_plan
from .llm_service import MODEL_GEMINI_FLASH, MODEL_GEMINI_PRO, MODEL_GEMINI_3_PRO


PLAN_RUNTIMES: Dict[str, Dict[str, Any]] = {
    "free": {
        "lane": "standard",
        "priority": 30,
        "analyze": {
            "model": MODEL_GEMINI_FLASH,
            "max_tokens": 1400,
            "job_desc_limit": 2500,
            "cv_limit": 1200,
            "cache_ttl_sec": 1800,
        },
        "chat": {
            "model": MODEL_GEMINI_FLASH,
            "max_tokens": 450,
            "rate_limit_max": 6,
            "cache_ttl_sec": 300,
        },
        "quiz": {
            "model": MODEL_GEMINI_FLASH,
            "max_tokens": 2600,
            "context_limit": 900,
            "cache_ttl_sec": 1800,
        },
        "learning_path": {
            "path_count": 3,
            "resources_per_path": 3,
            "cache_ttl_sec": 3600,
            "detail_mode": "compact",
        },
    },
    "basic": {
        "lane": "expedited",
        "priority": 20,
        "analyze": {
            "model": MODEL_GEMINI_FLASH,
            "max_tokens": 2100,
            "job_desc_limit": 3800,
            "cv_limit": 2100,
            "cache_ttl_sec": 5400,
        },
        "chat": {
            "model": MODEL_GEMINI_FLASH,
            "max_tokens": 820,
            "rate_limit_max": 12,
            "cache_ttl_sec": 900,
        },
        "quiz": {
            "model": MODEL_GEMINI_FLASH,
            "max_tokens": 3800,
            "context_limit": 1800,
            "cache_ttl_sec": 5400,
        },
        "learning_path": {
            "path_count": 3,
            "resources_per_path": 5,
            "cache_ttl_sec": 10800,
            "detail_mode": "guided",
        },
    },
    "pro": {
        "lane": "priority",
        "priority": 10,
        "analyze": {
            "model": MODEL_GEMINI_PRO,
            "max_tokens": 2900,
            "job_desc_limit": 4600,
            "cv_limit": 3000,
            "cache_ttl_sec": 14400,
        },
        "chat": {
            "model": MODEL_GEMINI_PRO,
            "max_tokens": 1300,
            "rate_limit_max": 20,
            "cache_ttl_sec": 1800,
        },
        "quiz": {
            "model": MODEL_GEMINI_PRO,
            "max_tokens": 5000,
            "context_limit": 3000,
            "cache_ttl_sec": 14400,
        },
        "learning_path": {
            "path_count": 5,
            "resources_per_path": 6,
            "cache_ttl_sec": 21600,
            "detail_mode": "deep",
        },
    },
    "admin": {
        "lane": "admin",
        "priority": 0,
        "analyze": {
            "model": MODEL_GEMINI_3_PRO,
            "max_tokens": 3000,
            "job_desc_limit": 5000,
            "cv_limit": 3200,
            "cache_ttl_sec": 7200,
        },
        "chat": {
            "model": MODEL_GEMINI_3_PRO,
            "max_tokens": 1400,
            "rate_limit_max": 30,
            "cache_ttl_sec": 1200,
        },
        "quiz": {
            "model": MODEL_GEMINI_3_PRO,
            "max_tokens": 5200,
            "context_limit": 3200,
            "cache_ttl_sec": 14400,
        },
        "learning_path": {
            "path_count": 5,
            "resources_per_path": 6,
            "cache_ttl_sec": 14400,
            "detail_mode": "expert",
        },
    },
}

INTERVIEW_DISABLED_MESSAGE = "Interview Lite belum aktif untuk akun ini. Aktifkan plan/event terlebih dahulu."
INTERVIEW_SPEECH_DISABLED_MESSAGE = "Speech mode is available for Pro plan only"


def get_plan_runtime(user: Dict[str, Any], feature: str) -> Dict[str, Any]:
    plan = get_effective_plan(user)
    runtime_root = PLAN_RUNTIMES.get(plan, PLAN_RUNTIMES["free"])
    feature_runtime = runtime_root.get(feature, {})
    return {
        "plan": plan,
        "lane": runtime_root.get("lane", "standard"),
        "priority": runtime_root.get("priority", 50),
        **feature_runtime,
    }


def get_plan_rank(plan: str) -> int:
    order = {"free": 0, "basic": 1, "pro": 2, "admin": 3}
    return order.get((plan or "free").strip().lower(), 0)


def get_feature_lock_ttl(feature: str) -> int:
    defaults = {
        "analyze": int(os.environ.get("ANALYZE_LOCK_TTL_SEC", "20")),
        "chat": int(os.environ.get("CHAT_LOCK_TTL_SEC", "15")),
        "quiz": int(os.environ.get("QUIZ_LOCK_TTL_SEC", "20")),
        "learning_path": int(os.environ.get("LEARNING_PATH_LOCK_TTL_SEC", "15")),
    }
    return defaults.get(feature, 15)


def _has_active_plan_window(user: Dict[str, Any]) -> bool:
    exp_raw = user.get("plan_expires_at")
    if not exp_raw:
        return False

    try:
        exp_text = str(exp_raw).strip()
        if exp_text.endswith("Z"):
            exp_text = exp_text[:-1] + "+00:00"
        expires = datetime.fromisoformat(exp_text)
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return expires > datetime.now(timezone.utc)
    except Exception:
        return False


def get_interview_access(user: Dict[str, Any]) -> Dict[str, Any]:
    """Return interview access state based on effective plan and active event/trial window."""
    plan = get_effective_plan(user)
    is_admin = plan == "admin"
    is_paid_plan = plan in {"basic", "pro"}
    raw_plan = str(user.get("plan") or "").strip().lower()

    # Event/trial users can temporarily unlock interview even when effective plan is free.
    trial_or_event_active = _has_active_plan_window(user) and (
        bool(user.get("is_trial")) or raw_plan == "free"
    )

    enabled = bool(is_admin or is_paid_plan or trial_or_event_active)
    deep_quality = bool(is_admin or plan == "pro")
    speech_enabled = bool(is_admin or plan == "pro")

    return {
        "enabled": enabled,
        "quality": "deep" if deep_quality else "lite",
        "speech_enabled": speech_enabled,
        "event_active": bool(trial_or_event_active and plan == "free"),
    }


def get_interview_lock_message(user: Dict[str, Any], mode: str = "text") -> str:
    access = get_interview_access(user)
    if not bool(access.get("enabled", False)):
        return INTERVIEW_DISABLED_MESSAGE

    requested_mode = (mode or "text").strip().lower()
    if requested_mode == "speech" and not bool(access.get("speech_enabled", False)):
        return INTERVIEW_SPEECH_DISABLED_MESSAGE

    return ""