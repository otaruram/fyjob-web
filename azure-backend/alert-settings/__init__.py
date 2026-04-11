"""
Azure Function: Alert Settings
GET  /api/alert-settings  — fetch current alert prefs for the user
POST /api/alert-settings  — save alert prefs for the user
"""
import azure.functions as func
import logging
import json
import re
from shared.auth import authenticate, error_response, success_response, CORS_HEADERS
from shared.cosmos_client import get_container
from shared.email_service import send_email


DEFAULT_PREFS = {
    "email_weekly_summary": False,
    "email_new_quiz": False,
    "email_security_warnings": False,
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
        old_prefs = dict(prefs)
        bool_fields = ["email_weekly_summary", "email_new_quiz", "email_security_warnings"]
        for field in bool_fields:
            if field in body:
                prefs[field] = bool(body[field])

        if "threshold_low_score" in body:
            val = int(body["threshold_low_score"])
            prefs["threshold_low_score"] = max(0, min(100, val))

        if "daily_reminder_time" in body:
            t = str(body["daily_reminder_time"])
            if re.match(r"^\d{2}:\d{2}$", t):
                prefs["daily_reminder_time"] = t

        email_test_sent = False
        test_email_to = str(body.get("test_email_to") or "").strip().lower()
        if test_email_to and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", test_email_to):
            return error_response("Invalid test_email_to format", 400)

        target_email = test_email_to or email
        if body.get("send_test_email") is True and target_email:
            email_test_sent = send_email(
                to=target_email,
                subject="FYJOB Reminder Test",
                html_body="""
                <div style='font-family:sans-serif;max-width:480px;margin:auto'>
                  <h2>Pengingat FYJOB Aktif</h2>
                  <p>Ini adalah email test untuk memastikan pengingat karier kamu berjalan normal.</p>
                  <p>Ayo analisis lowongan terbaru hari ini dan lanjutkan latihan interview agar skor kamu naik stabil setiap minggu.</p>
                </div>
                """,
            )

        # Auto-notify when user enables an email alert toggle.
        enabled_now = [
            f for f in bool_fields
            if (not bool(old_prefs.get(f, False))) and bool(prefs.get(f, False))
        ]
        enabled_notifications_sent = []
        if enabled_now and email:
            email_templates = {
                "email_weekly_summary": {
                    "subject": "FYJob Alerts Enabled — Weekly Summary",
                    "html": """
                    <div style='font-family:sans-serif;max-width:480px;margin:auto'>
                      <h2>Weekly Summary Enabled</h2>
                      <p>Your weekly performance summary alert is now active.</p>
                      <p>You'll receive a periodic recap of your FYJob progress.</p>
                    </div>
                    """,
                },
                "email_new_quiz": {
                    "subject": "FYJob Alerts Enabled — New Quiz Availability",
                    "html": """
                    <div style='font-family:sans-serif;max-width:480px;margin:auto'>
                      <h2>New Quiz Alerts Enabled</h2>
                      <p>Your new quiz availability alert is now active.</p>
                      <p>We'll notify you when a new quiz is ready to practice.</p>
                    </div>
                    """,
                },
                "email_security_warnings": {
                    "subject": "FYJob Alerts Enabled — Security Sign-in Warnings",
                    "html": """
                    <div style='font-family:sans-serif;max-width:480px;margin:auto'>
                      <h2>Security Warnings Enabled</h2>
                      <p>Your security sign-in warning alert is now active.</p>
                      <p>You'll receive an email when suspicious login activity is detected.</p>
                    </div>
                    """,
                },
            }

            for field in enabled_now:
                template = email_templates.get(field)
                if not template:
                    continue
                sent = send_email(
                    to=email,
                    subject=template["subject"],
                    html_body=template["html"],
                )
                if sent:
                    enabled_notifications_sent.append(field)

        _save_prefs(user_id, prefs)
        return success_response({
            "alert_prefs": prefs,
            "message": "Alert settings saved",
            "email_test_sent": email_test_sent,
            "enabled_notifications_sent": enabled_notifications_sent,
        })

    return error_response("Method not allowed", 405)
