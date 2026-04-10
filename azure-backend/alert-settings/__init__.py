"""
Azure Function: Alert Settings
GET  /api/alert-settings  — fetch current alert prefs for the user
POST /api/alert-settings  — save alert prefs for the user
"""
import azure.functions as func
import logging
import json
from shared.auth import authenticate, error_response, success_response, CORS_HEADERS
from shared.cosmos_client import get_container


DEFAULT_PREFS = {
    "email_weekly_summary": True,
    "email_new_quiz": True,
    "email_security_warnings": True,
    "threshold_low_score": 60,
    "daily_reminder_time": "20:00",
}


def _get_or_create_prefs(user_id: str, email: str) -> dict:
    container = get_container("Users")
    try:
        item = container.read_item(item=user_id, partition_key=user_id)
        return item.get("alert_prefs", DEFAULT_PREFS.copy())
    except Exception:
        return DEFAULT_PREFS.copy()


def _save_prefs(user_id: str, prefs: dict):
    container = get_container("Users")
    try:
        item = container.read_item(item=user_id, partition_key=user_id)
    except Exception:
        logging.error(f"User {user_id} not found when saving alert prefs")
        raise

    item["alert_prefs"] = prefs
    container.upsert_item(item)


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Alert Settings function triggered")

    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=200, headers=CORS_HEADERS)

    user_id, email, err = authenticate(req)
    if err:
        return err

    # ── GET: return current prefs ────────────────────────────────────────────
    if req.method == "GET":
        prefs = _get_or_create_prefs(user_id, email)
        return success_response({"alert_prefs": prefs})

    # ── POST: save prefs ─────────────────────────────────────────────────────
    if req.method == "POST":
        try:
            body = req.get_json()
        except Exception:
            return error_response("Invalid JSON body", 400)

        # Validate / whitelist fields
        prefs = _get_or_create_prefs(user_id, email)
        bool_fields = ["email_weekly_summary", "email_new_quiz", "email_security_warnings"]
        for field in bool_fields:
            if field in body:
                prefs[field] = bool(body[field])

        if "threshold_low_score" in body:
            val = int(body["threshold_low_score"])
            prefs["threshold_low_score"] = max(0, min(100, val))

        if "daily_reminder_time" in body:
            import re
            t = str(body["daily_reminder_time"])
            if re.match(r"^\d{2}:\d{2}$", t):
                prefs["daily_reminder_time"] = t

        _save_prefs(user_id, prefs)
        return success_response({"alert_prefs": prefs, "message": "Alert settings saved"})

    return error_response("Method not allowed", 405)
