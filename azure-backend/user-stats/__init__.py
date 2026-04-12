"""
Azure Function: User Stats
GET /api/user-stats — Get user statistics, credits, and analysis summary
"""
import azure.functions as func
import logging
import json
from datetime import datetime, timezone, timedelta
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import (
    get_container,
    check_and_regen_credits,
    get_next_regen_time,
    log_admin_audit,
    get_effective_plan,
    get_plan_credit_cap,
    get_plan_daily_regen,
)
from shared.plan_access import get_plan_runtime
from shared.email_service import send_security_alert
from shared.email_service import send_plan_expiry_reminder


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower().replace(" ", "")


def _is_admin_user(user_doc: dict) -> bool:
    email = _normalize_email(user_doc.get("email", ""))
    return email == "okitr52@gmail.com"


def _admin_overview():
    users = get_container("Users")
    history = get_container("AnalysisHistory")
    interviews = get_container("InterviewSessions")

    total = list(users.query_items("SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True))
    banned = list(users.query_items("SELECT VALUE COUNT(1) FROM c WHERE c.is_banned = true", enable_cross_partition_query=True))

    analysis_count = list(history.query_items("SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True))
    interview_count = list(interviews.query_items("SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True))
    quiz_count = list(users.query_items(
        "SELECT VALUE COUNT(1) FROM c WHERE IS_DEFINED(c.total_quiz_submissions) AND c.total_quiz_submissions > 0",
        enable_cross_partition_query=True,
    ))

    usage = [
        {"feature": "job_analysis", "count": int(analysis_count[0]) if analysis_count else 0},
        {"feature": "interview_lite", "count": int(interview_count[0]) if interview_count else 0},
        {"feature": "quiz_submit", "count": int(quiz_count[0]) if quiz_count else 0},
    ]
    usage_sorted = sorted(usage, key=lambda x: x["count"], reverse=True)

    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    active_rows = list(users.query_items(
        "SELECT VALUE COUNT(1) FROM c WHERE IS_DEFINED(c.last_activity_at) AND c.last_activity_at >= @cutoff",
        parameters=[{"name": "@cutoff", "value": cutoff}],
        enable_cross_partition_query=True,
    ))

    admin_override_rows = list(users.query_items(
        "SELECT TOP 1 c.testing_plan_override, c.email, c.role FROM c WHERE LOWER(c.email) = @email",
        parameters=[{"name": "@email", "value": "okitr52@gmail.com"}],
        enable_cross_partition_query=True,
    ))
    admin_doc = admin_override_rows[0] if admin_override_rows else {}

    return {
        "total_users": int(total[0]) if total else 0,
        "banned_users": int(banned[0]) if banned else 0,
        "active_last_7_days": int(active_rows[0]) if active_rows else 0,
        "most_used_feature": usage_sorted[0] if usage_sorted else None,
        "least_used_feature": usage_sorted[-1] if usage_sorted else None,
        "testing_plan_override": admin_doc.get("testing_plan_override"),
        "effective_plan": get_effective_plan(admin_doc or {"role": "admin", "email": "okitr52@gmail.com"}),
    }


def _admin_users(search: str = "", limit: int = 40):
    users = get_container("Users")
    safe_limit = max(1, min(100, int(limit or 40)))

    query = (
        f"SELECT TOP {safe_limit} c.id, c.email, c.role, c.plan, c.testing_plan_override, c.plan_expires_at, c.credits_remaining, c.is_banned, "
        "c.banned_reason, c.created_at, c.last_activity_at FROM c "
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
    return {"users": rows}


def _admin_activity():
    history = get_container("AnalysisHistory")
    interviews = get_container("InterviewSessions")
    users = get_container("Users")

    analysis_count = list(history.query_items("SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True))
    interview_count = list(interviews.query_items("SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True))
    quiz_count = list(users.query_items(
        "SELECT VALUE COUNT(1) FROM c WHERE IS_DEFINED(c.total_quiz_submissions) AND c.total_quiz_submissions > 0",
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


def _admin_set_ban(admin_user_id: str, target_user_id: str, banned: bool, reason: str):
    users = get_container("Users")
    target = users.read_item(item=target_user_id, partition_key=target_user_id)
    target["is_banned"] = bool(banned)
    target["banned_reason"] = reason if banned else ""
    target["banned_at"] = datetime.utcnow().isoformat() if banned else None
    users.upsert_item(target)

    log_admin_audit(
        action="ban-user",
        admin_user_id=admin_user_id,
        payload={"target_user_id": target_user_id, "banned": bool(banned), "reason": reason},
    )


def _admin_add_credits(admin_user_id: str, target_user_id: str, amount: int):
    users = get_container("Users")
    target = users.read_item(item=target_user_id, partition_key=target_user_id)
    if target.get("role") == "admin":
        return {
            "target_user_id": target_user_id,
            "credits_remaining": target.get("credits_remaining", 999999),
            "skipped": True,
            "reason": "Target is admin",
        }

    safe_amount = max(0, int(amount or 0))
    target["credits_remaining"] = int(target.get("credits_remaining", 0)) + safe_amount
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


def _admin_reset_non_admin_users(admin_user_id: str, trial_days: int = 7):
    users = get_container("Users")
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(days=max(1, int(trial_days or 7)))).isoformat()
    now_iso = now.isoformat()
    pro_cap = get_plan_credit_cap("pro")

    rows = list(users.query_items(
        "SELECT c.id FROM c WHERE c.role != @admin_role",
        parameters=[{"name": "@admin_role", "value": "admin"}],
        enable_cross_partition_query=True,
    ))

    updated = 0
    for row in rows:
        target_user_id = str(row.get("id") or "").strip()
        if not target_user_id:
            continue
        try:
            user = users.read_item(item=target_user_id, partition_key=target_user_id)
            user["role"] = "user"
            user["plan"] = "pro"
            user["is_trial"] = True
            user["trial_started_at"] = now_iso
            user["plan_expires_at"] = expires_at
            user["plan_activated_at"] = now_iso
            user["credits_remaining"] = pro_cap
            user["last_regen_date"] = now_iso
            user["is_banned"] = False
            user["banned_reason"] = ""
            user["banned_at"] = None
            user["welcome_email_sent_at"] = None
            user["onboarding_welcome_seen_at"] = None
            user["testing_plan_override"] = None
            users.upsert_item(user)
            updated += 1
        except Exception as exc:
            logging.warning(f"Failed reset for user {target_user_id}: {exc}")

    log_admin_audit(
        action="reset-non-admin-users",
        admin_user_id=admin_user_id,
        payload={
            "updated_count": updated,
            "trial_days": max(1, int(trial_days or 7)),
            "plan": "pro",
        },
    )

    return {
        "ok": True,
        "updated_count": updated,
        "trial_days": max(1, int(trial_days or 7)),
        "plan": "pro",
        "expires_at": expires_at,
        "credits_cap": pro_cap,
    }


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("User Stats function triggered")

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        user = check_and_regen_credits(user_id, email)

        # Admin actions fallback endpoint (stable under /api/user-stats)
        if req.method == "GET":
            admin_action = (req.params.get("action") or "").strip().lower()
            if admin_action in {"admin-overview", "admin-users", "admin-activity"}:
                if not _is_admin_user(user):
                    return error_response("Admin access required", 403)

                if admin_action == "admin-overview":
                    return success_response(_admin_overview())
                if admin_action == "admin-users":
                    search = (req.params.get("search") or "").strip().lower()
                    limit = int(req.params.get("limit") or "40")
                    return success_response(_admin_users(search, limit))
                return success_response(_admin_activity())

        if req.method == "POST":
            try:
                body = req.get_json()
            except Exception:
                return error_response("Invalid JSON body", 400)

            action = str(body.get("action") or "").strip().lower()
            if action in {"ban-user", "add-credits"}:
                if not _is_admin_user(user):
                    return error_response("Admin access required", 403)

                if action == "ban-user":
                    target_user_id = str(body.get("targetUserId") or "").strip()
                    if not target_user_id:
                        return error_response("targetUserId is required", 400)
                    if target_user_id == user_id:
                        return error_response("Admin cannot ban self", 400)
                    banned = bool(body.get("banned", True))
                    reason = str(body.get("reason") or "Policy violation").strip()[:200]
                    _admin_set_ban(user_id, target_user_id, banned, reason)
                    return success_response({"ok": True, "targetUserId": target_user_id, "banned": banned})

                target_user_id = str(body.get("targetUserId") or "").strip()
                amount = int(body.get("amount") or 0)
                if not target_user_id:
                    return error_response("targetUserId is required", 400)
                if amount <= 0:
                    return error_response("amount must be > 0", 400)
                return success_response(_admin_add_credits(user_id, target_user_id, amount))

            if action == "reset-non-admin-users":
                if not _is_admin_user(user):
                    return error_response("Admin access required", 403)

                confirm = str(body.get("confirm") or "").strip().upper()
                if confirm != "RESET_NON_ADMIN_USERS":
                    return error_response("confirm must be RESET_NON_ADMIN_USERS", 400)

                trial_days = int(body.get("trialDays") or 7)
                return success_response(_admin_reset_non_admin_users(user_id, trial_days))

        # Get user with credit regen check
        credits = user.get("credits_remaining", get_plan_credit_cap(get_effective_plan(user)))

        # Get analysis history
        try:
            history_container = get_container("AnalysisHistory")
            query = "SELECT * FROM c WHERE c.userId = @uid ORDER BY c.created_at DESC"
            analyses = list(history_container.query_items(
                query=query,
                parameters=[{"name": "@uid", "value": user_id}],
                enable_cross_partition_query=False,
                partition_key=user_id,
            ))
        except Exception as e:
            logging.error(f"Failed to get analyses: {e}")
            analyses = []

        total_analyses = len(analyses)

        # Average match score
        scores = [a.get("matchScore", 0) for a in analyses if a.get("matchScore")]
        avg_match_score = round(sum(scores) / len(scores)) if scores else 0

        # Recent analyses (last 10)
        recent_analyses = []
        for a in analyses[:10]:
            recent_analyses.append({
                "id": a.get("id", ""),
                "jobTitle": a.get("jobTitle", "Unknown"),
                "portal": a.get("portal", "Unknown"),
                "created_at": a.get("created_at", ""),
                "score": a.get("matchScore", 0),
                "has_quiz": bool(a.get("killer_quiz")),
                "has_learning_path": bool(a.get("learning_path"))
            })

        # Top skill gaps (aggregate)
        skill_gaps_map = {}
        for a in analyses:
            for gap in a.get("gaps", []):
                if "Missing:" in gap:
                    skill = gap.split("Missing:")[1].split("→")[0].strip()
                    skill_gaps_map[skill] = skill_gaps_map.get(skill, 0) + 1

        skill_gaps = [
            {"name": s, "frequency": c}
            for s, c in sorted(skill_gaps_map.items(), key=lambda x: x[1], reverse=True)[:5]
        ]

        plan = get_effective_plan(user)
        is_admin = plan == "admin"
        plan_expires_at = user.get("plan_expires_at")
        max_credits = "∞" if is_admin else get_plan_credit_cap(plan)
        daily_regen = 0 if is_admin else get_plan_daily_regen(plan)
        analyze_runtime = get_plan_runtime(user, "analyze")
        chat_runtime = get_plan_runtime(user, "chat")
        quiz_runtime = get_plan_runtime(user, "quiz")
        learning_path_runtime = get_plan_runtime(user, "learning_path")

        plan_expiry_notice = None
        expiry_reminder_key = None
        if plan in ("basic", "pro") and plan_expires_at:
            try:
                exp_dt = datetime.fromisoformat(plan_expires_at)
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                now_dt = datetime.now(timezone.utc)
                if exp_dt > now_dt:
                    delta = exp_dt - now_dt
                    total_hours = int(delta.total_seconds() // 3600)
                    days_left = max(0, total_hours // 24)
                    if delta <= timedelta(days=7):
                        local_exp = exp_dt.astimezone(timezone(timedelta(hours=7)))
                        plan_expiry_notice = (
                            f"Paket {plan.upper()} akan habis dalam {days_left} hari "
                            f"({local_exp.strftime('%d-%m-%Y %H:%M:%S')} WIB)."
                        )
                        if days_left in (7, 2):
                            expiry_reminder_key = f"{plan}:{exp_dt.isoformat()}:{days_left}"
            except Exception:
                plan_expiry_notice = None

        # Email reminder milestones for expiring paid plans (H-7 and H-2)
        if expiry_reminder_key and email:
            try:
                sent_keys = user.get("plan_expiry_email_sent_keys") or []
                if not isinstance(sent_keys, list):
                    sent_keys = []

                if expiry_reminder_key not in sent_keys:
                    days_left_value = int(expiry_reminder_key.rsplit(":", 1)[-1])
                    sent = send_plan_expiry_reminder(
                        to=email,
                        plan=plan,
                        days_left=days_left_value,
                        expires_label=plan_expires_at,
                    )
                    if sent:
                        sent_keys.append(expiry_reminder_key)
                        users_container = get_container("Users")
                        user["plan_expiry_email_sent_keys"] = sent_keys[-12:]
                        users_container.upsert_item(user)
            except Exception as e:
                logging.warning(f"Failed to send plan expiry reminder email: {e}")

        welcome_notice = None
        should_persist_welcome_seen = False
        welcome_seen_at = user.get("onboarding_welcome_seen_at")
        if not welcome_seen_at and not is_admin:
            try:
                created_at_raw = user.get("created_at")
                created_at = datetime.fromisoformat(created_at_raw) if created_at_raw else datetime.now(timezone.utc)
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)
                age = datetime.now(timezone.utc) - created_at.astimezone(timezone.utc)
                if age <= timedelta(days=3):
                    welcome_notice = (
                        "Welcome to FYJOB. Mulai dari scan 1 lowongan, lalu generate quiz dan learning path biar progresmu cepat kebaca."
                    )
                should_persist_welcome_seen = True
            except Exception:
                should_persist_welcome_seen = True

        if should_persist_welcome_seen:
            try:
                users_container = get_container("Users")
                user["onboarding_welcome_seen_at"] = datetime.utcnow().isoformat()
                users_container.upsert_item(user)
            except Exception as e:
                logging.warning(f"Failed to persist onboarding_welcome_seen_at: {e}")

        # ── Security email on first login of the day (if user opted in) ──────
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if (
            user.get("alert_prefs", {}).get("email_security_warnings", False)
            and user.get("last_security_email_date") != today
            and email
        ):
            try:
                ip = req.headers.get("X-Forwarded-For", "").split(",")[0].strip()
                ua = req.headers.get("User-Agent", "")
                send_security_alert(email, "Sign-in", ip, ua)
                # mark so we don't spam more than once/day
                users_container = get_container("Users")
                user["last_security_email_date"] = today
                users_container.upsert_item(user)
            except Exception as e:
                logging.warning(f"Security email skipped: {e}")

        return success_response({
            "email": user.get("email", ""),
            "credits_remaining": credits,
            "max_credits": max_credits,
            "role": user.get("role", "user"),
            "plan": plan,
            "plan_expires_at": plan_expires_at if plan in ("basic", "pro") else None,
            "plan_expiry_notice": plan_expiry_notice,
            "welcome_notice": welcome_notice,
            "interview_access": {
                "enabled": bool(is_admin or plan in ("basic", "pro")),
                "quality": "deep" if (is_admin or plan == "pro") else "lite",
                "speech_enabled": bool(is_admin or plan == "pro"),
            },
            "credit_regen": {
                "daily_add": daily_regen,
                "cap": max_credits,
            },
            "feature_access": {
                "analyze": {
                    "priority_lane": analyze_runtime["lane"],
                    "model": analyze_runtime["model"],
                    "cache_ttl_sec": analyze_runtime["cache_ttl_sec"],
                },
                "ask_ujang": {
                    "priority_lane": chat_runtime["lane"],
                    "model": chat_runtime["model"],
                    "cache_ttl_sec": chat_runtime["cache_ttl_sec"],
                    "rate_limit_max": chat_runtime["rate_limit_max"],
                },
                "killer_quiz": {
                    "priority_lane": quiz_runtime["lane"],
                    "model": quiz_runtime["model"],
                    "cache_ttl_sec": quiz_runtime["cache_ttl_sec"],
                },
                "learning_path": {
                    "priority_lane": learning_path_runtime["lane"],
                    "path_count": learning_path_runtime["path_count"],
                    "resources_per_path": learning_path_runtime["resources_per_path"],
                    "cache_ttl_sec": learning_path_runtime["cache_ttl_sec"],
                },
            },
            "next_regen_time": get_next_regen_time(user),
            "total_analyses": total_analyses,
            "avg_match_score": avg_match_score,
            "recent_analyses": recent_analyses,
            "skill_gaps": skill_gaps,
            "cv_uploaded": bool(user.get("raw_cv_text")),
            "cv_filename": user.get("cv_filename", ""),
            "timezone": user.get("timezone", "Asia/Jakarta")
        })

    except Exception as e:
        logging.error(f"User stats error: {e}")
        return error_response(str(e))
