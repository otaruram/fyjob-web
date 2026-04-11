"""
Azure Function: User Stats
GET /api/user-stats — Get user statistics, credits, and analysis summary
"""
import azure.functions as func
import logging
import json
from datetime import datetime, timezone
from shared.auth import authenticate, error_response, success_response
from shared.cosmos_client import (
    get_container, check_and_regen_credits, get_next_regen_time, MAX_CREDITS
)
from shared.email_service import send_security_alert


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("User Stats function triggered")

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        # Get user with credit regen check
        user = check_and_regen_credits(user_id, email)
        credits = user.get("credits_remaining", MAX_CREDITS)

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

        is_admin = user.get("role") == "admin"

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
            "credits_remaining": credits,
            "max_credits": "∞" if is_admin else MAX_CREDITS,
            "role": user.get("role", "user"),
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
