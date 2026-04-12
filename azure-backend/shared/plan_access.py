import os
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