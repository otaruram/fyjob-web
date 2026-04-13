"""
Azure Function: Admin Center
GET  /api/admin-center?action=overview|users|activity
POST /api/admin-center with action:
  - ban-user
  - add-credits
"""
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List

import azure.functions as func

from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import (
    get_container,
    log_admin_audit,
    get_effective_plan,
    get_plan_credit_cap,
    ALLOWED_ADMIN_EMAIL,
)


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower().replace(" ", "")


def is_allowed_admin_email(email: str) -> bool:
    return bool(ALLOWED_ADMIN_EMAIL) and _normalize_email(email) == ALLOWED_ADMIN_EMAIL


def _get_requester(user_id: str) -> Dict[str, Any]:
    users = get_container("Users")
    return users.read_item(item=user_id, partition_key=user_id)


def _ensure_admin(user_id: str):
    try:
        user = _get_requester(user_id)
    except Exception:
        return None, error_response("Requester not found", 404)

    user_email = _normalize_email(str(user.get("email") or ""))
    if not is_allowed_admin_email(user_email):
        return None, error_response("Admin access required", 403)

    if user.get("role") != "admin":
        user["role"] = "admin"
        user["credits_remaining"] = 999999
        try:
            users = get_container("Users")
            users.upsert_item(user)
        except Exception:
            pass

    return user, None


def _count_users() -> Dict[str, int]:
    users = get_container("Users")
    total = list(users.query_items(
        query="SELECT VALUE COUNT(1) FROM c",
        enable_cross_partition_query=True,
    ))
    banned = list(users.query_items(
        query="SELECT VALUE COUNT(1) FROM c WHERE c.is_banned = true",
        enable_cross_partition_query=True,
    ))
    return {
        "total_users": int(total[0]) if total else 0,
        "banned_users": int(banned[0]) if banned else 0,
    }


def _set_user_plan(admin_user_id: str, target_user_id: str, plan: str, trial_days: int = 30):
    """Assign a concrete plan (free/basic/pro) to a specific user."""
    normalized = (plan or "").strip().lower()
    if normalized not in {"free", "basic", "pro"}:
        raise ValueError("plan must be one of: free, basic, pro")

    users = get_container("Users")
    target = users.read_item(item=target_user_id, partition_key=target_user_id)

    if target.get("role") == "admin":
        raise ValueError("Cannot change plan of an admin user")

    expires_at = None
    if normalized in {"basic", "pro"}:
        from datetime import datetime, timedelta, timezone
        expires_at = (datetime.now(timezone.utc) + timedelta(days=max(1, int(trial_days)))).isoformat()

    target["plan"] = normalized
    target["plan_expires_at"] = expires_at
    target["testing_plan_override"] = None  # clear any override
    target["credits_remaining"] = get_plan_credit_cap(normalized)
    users.upsert_item(target)

    log_admin_audit(
        action="set-user-plan",
        admin_user_id=admin_user_id,
        payload={
            "target_user_id": target_user_id,
            "plan": normalized,
            "plan_expires_at": expires_at,
        },
    )

    return {
        "target_user_id": target_user_id,
        "plan": normalized,
        "plan_expires_at": expires_at,
        "credits_remaining": target["credits_remaining"],
    }


def _set_testing_plan(admin_user_id: str, target_user_id: str, testing_plan: str):
    users = get_container("Users")
    target = users.read_item(item=target_user_id, partition_key=target_user_id)
    normalized = (testing_plan or "").strip().lower()
    if normalized not in {"free", "basic", "pro", "admin", "off", ""}:
        raise ValueError("testingPlan must be one of: free, basic, pro, admin, off")

    target["testing_plan_override"] = None if normalized in {"off", ""} else normalized
    effective_plan = get_effective_plan(target)
    if effective_plan == "admin":
        target["credits_remaining"] = 999999
    else:
        target["credits_remaining"] = min(int(target.get("credits_remaining", 0)), get_plan_credit_cap(effective_plan))
    users.upsert_item(target)

    log_admin_audit(
        action="set-testing-plan",
        admin_user_id=admin_user_id,
        payload={
            "target_user_id": target_user_id,
            "testing_plan_override": target.get("testing_plan_override"),
            "effective_plan": effective_plan,
        },
    )

    return {
        "target_user_id": target_user_id,
        "testing_plan_override": target.get("testing_plan_override"),
        "effective_plan": effective_plan,
        "credits_remaining": target.get("credits_remaining"),
    }


def _feature_usage_summary() -> Dict[str, Any]:
    history = get_container("AnalysisHistory")
    interviews = get_container("InterviewSessions")

    analysis_count = list(history.query_items(
        query="SELECT VALUE COUNT(1) FROM c",
        enable_cross_partition_query=True,
    ))
    interview_count = list(interviews.query_items(
        query="SELECT VALUE COUNT(1) FROM c",
        enable_cross_partition_query=True,
    ))

    users = get_container("Users")
    quiz_count = list(users.query_items(
        query="SELECT VALUE COUNT(1) FROM c WHERE IS_DEFINED(c.total_quiz_submissions) AND c.total_quiz_submissions > 0",
        enable_cross_partition_query=True,
    ))

    usage = [
        {"feature": "job_analysis", "count": int(analysis_count[0]) if analysis_count else 0},
        {"feature": "interview_lite", "count": int(interview_count[0]) if interview_count else 0},
        {"feature": "quiz_submit", "count": int(quiz_count[0]) if quiz_count else 0},
    ]

    usage_sorted = sorted(usage, key=lambda x: x["count"], reverse=True)
    return {
        "usage": usage_sorted,
        "most_used": usage_sorted[0] if usage_sorted else None,
        "least_used": usage_sorted[-1] if usage_sorted else None,
    }


def _active_last_7_days() -> int:
    users = get_container("Users")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    rows = list(users.query_items(
        query=(
            "SELECT VALUE COUNT(1) FROM c "
            "WHERE IS_DEFINED(c.last_activity_at) AND c.last_activity_at >= @cutoff"
        ),
        parameters=[{"name": "@cutoff", "value": cutoff}],
        enable_cross_partition_query=True,
    ))
    return int(rows[0]) if rows else 0


def _get_users(search: str = "", limit: int = 30) -> List[Dict[str, Any]]:
    users = get_container("Users")
    safe_limit = max(1, min(100, int(limit or 30)))

    query = (
        f"SELECT TOP {safe_limit} c.id, c.email, c.role, c.plan, c.testing_plan_override, c.plan_expires_at, c.credits_remaining, "
        "c.is_banned, c.banned_reason, c.created_at, c.last_activity_at "
        "FROM c "
    )
    params = []

    if search:
        query += "WHERE CONTAINS(LOWER(c.email), @search) "
        params.append({"name": "@search", "value": str(search).lower()})

    query += "ORDER BY c.created_at DESC"

    rows = list(users.query_items(
        query=query,
        parameters=params,
        enable_cross_partition_query=True,
    ))
    return rows


def _set_ban(admin_user_id: str, target_user_id: str, banned: bool, reason: str):
    users = get_container("Users")
    target = users.read_item(item=target_user_id, partition_key=target_user_id)
    target["is_banned"] = bool(banned)
    target["banned_reason"] = reason if banned else ""
    target["banned_at"] = datetime.utcnow().isoformat() if banned else None
    users.upsert_item(target)

    log_admin_audit(
        action="ban-user",
        admin_user_id=admin_user_id,
        payload={
            "target_user_id": target_user_id,
            "banned": bool(banned),
            "reason": reason,
        },
    )


def _add_credits(admin_user_id: str, target_user_id: str, amount: int):
    users = get_container("Users")
    target = users.read_item(item=target_user_id, partition_key=target_user_id)
    role = target.get("role")

    if role == "admin":
        return {
            "target_user_id": target_user_id,
            "credits_remaining": target.get("credits_remaining", 999999),
            "skipped": True,
            "reason": "Target is admin",
        }

    safe_amount = max(0, int(amount or 0))
    current = int(target.get("credits_remaining", 0))
    target["credits_remaining"] = current + safe_amount
    users.upsert_item(target)

    log_admin_audit(
        action="add-credits",
        admin_user_id=admin_user_id,
        payload={
            "target_user_id": target_user_id,
            "amount": safe_amount,
            "result_credits": target["credits_remaining"],
        },
    )

    return {
        "target_user_id": target_user_id,
        "credits_remaining": target["credits_remaining"],
        "added": safe_amount,
    }


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Admin Center function triggered")

    user_id, _email, err = authenticate(req)
    if err:
        return err

    _admin_user, admin_err = _ensure_admin(user_id)
    if admin_err:
        return admin_err

    try:
        if req.method == "GET":
            action = (req.params.get("action") or "overview").strip().lower()

            if action == "overview":
                counts = _count_users()
                feature = _feature_usage_summary()
                return success_response({
                    **counts,
                    "active_last_7_days": _active_last_7_days(),
                    "most_used_feature": feature.get("most_used"),
                    "least_used_feature": feature.get("least_used"),
                    "testing_plan_override": _admin_user.get("testing_plan_override"),
                    "effective_plan": get_effective_plan(_admin_user),
                })

            if action == "users":
                search = (req.params.get("search") or "").strip().lower()
                limit = req.params.get("limit") or "30"
                return success_response({"users": _get_users(search, int(limit))})

            if action == "activity":
                return success_response(_feature_usage_summary())

            return error_response("Unknown action", 400)

        if req.method == "POST":
            try:
                body = req.get_json()
            except Exception:
                return error_response("Invalid JSON body", 400)

            action = str(body.get("action") or "").strip().lower()

            if action == "ban-user":
                target_user_id = str(body.get("targetUserId") or "").strip()
                if not target_user_id:
                    return error_response("targetUserId is required", 400)
                if target_user_id == user_id:
                    return error_response("Admin cannot ban self", 400)

                banned = bool(body.get("banned", True))
                reason = str(body.get("reason") or "Policy violation").strip()[:200]
                _set_ban(user_id, target_user_id, banned, reason)
                return success_response({"ok": True, "targetUserId": target_user_id, "banned": banned})

            if action == "add-credits":
                target_user_id = str(body.get("targetUserId") or "").strip()
                amount = int(body.get("amount") or 0)
                if not target_user_id:
                    return error_response("targetUserId is required", 400)
                if amount <= 0:
                    return error_response("amount must be > 0", 400)

                return success_response(_add_credits(user_id, target_user_id, amount))

            if action == "set-testing-plan":
                target_user_id = str(body.get("targetUserId") or user_id).strip()
                testing_plan = str(body.get("testingPlan") or "off").strip().lower()
                return success_response(_set_testing_plan(user_id, target_user_id, testing_plan))

            if action == "set-user-plan":
                target_user_id = str(body.get("targetUserId") or "").strip()
                plan = str(body.get("plan") or "").strip().lower()
                trial_days = int(body.get("trialDays") or 30)
                if not target_user_id:
                    return error_response("targetUserId is required", 400)
                if not plan:
                    return error_response("plan is required (free, basic, pro)", 400)
                return success_response(_set_user_plan(user_id, target_user_id, plan, trial_days))

            return error_response("Unknown action", 400)

        return error_response("Method not allowed", 405)

    except Exception as e:
        logging.error(f"Admin Center error: {e}")
        return error_response(str(e))
