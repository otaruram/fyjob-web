"""
Shared Email Service
Sends transactional emails via Azure Communication Services Email.
"""
import os
import logging
from typing import Optional

def _get_acs_client():
    """Lazily import + build ACS EmailClient."""
    conn_str = os.environ.get("ACS_EMAIL_CONNECTION_STRING")
    if not conn_str:
        logging.warning("ACS_EMAIL_CONNECTION_STRING not set — emails will be skipped")
        return None, None
    try:
        from azure.communication.email import EmailClient
        return EmailClient.from_connection_string(conn_str), None
    except Exception as e:
        logging.error(f"ACS EmailClient init failed: {e}")
        return None, str(e)


SENDER = os.environ.get("ACS_EMAIL_SENDER", "DoNotReply@fyjob.app")


def send_email(to: str, subject: str, html_body: str, plain_body: Optional[str] = None) -> bool:
    """
    Send a single email. Returns True on success, False on failure.
    Never raises — caller should not crash on email failure.
    """
    client, err = _get_acs_client()
    if not client:
        logging.info(f"[email skip] to={to} subject={subject} reason={err or 'not configured'}")
        return False

    message = {
        "senderAddress": SENDER,
        "recipients": {"to": [{"address": to}]},
        "content": {
            "subject": subject,
            "html": html_body,
            "plainText": plain_body or _strip_html(html_body),
        },
    }
    try:
        poller = client.begin_send(message)
        result = poller.result()
        logging.info(f"Email sent to {to}: id={result.get('id')}")
        return True
    except Exception as e:
        logging.error(f"Failed to send email to {to}: {e}")
        return False


def _strip_html(html: str) -> str:
    import re
    return re.sub(r"<[^>]+>", "", html).strip()


# ── Templated helpers ─────────────────────────────────────────────────────────

def send_security_alert(to: str, event: str, ip: str = "", user_agent: str = "") -> bool:
    subject = "FYJob Security Alert — New sign-in detected"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#e74c3c">Security Alert</h2>
      <p>A new sign-in to your FYJob account was detected.</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#888">Event</td><td>{event}</td></tr>
        <tr><td style="padding:6px 0;color:#888">IP</td><td>{ip or 'Unknown'}</td></tr>
        <tr><td style="padding:6px 0;color:#888">Device</td><td>{user_agent[:80] if user_agent else 'Unknown'}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px">
        If this was you, you can ignore this message. If not, please change your password immediately.
      </p>
    </div>"""
    return send_email(to, subject, html)


def send_weekly_summary(to: str, name: str, total_analyses: int, avg_score: int, top_gap: str) -> bool:
    subject = "Your FYJob Weekly Summary"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2>Weekly Summary for {name}</h2>
      <p>Here's what happened this week on FYJob:</p>
      <ul>
        <li>CV analyses run: <strong>{total_analyses}</strong></li>
        <li>Average match score: <strong>{avg_score}%</strong></li>
        <li>Top skill gap: <strong>{top_gap or 'None'}</strong></li>
      </ul>
      <p><a href="https://fyjob.app/dashboard" style="color:#6366f1">Open Dashboard →</a></p>
    </div>"""
    return send_email(to, subject, html)
