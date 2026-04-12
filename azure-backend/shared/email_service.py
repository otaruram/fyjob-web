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
      <p><a href="https://fyjob.my.id/dashboard" style="color:#6366f1">Open Dashboard →</a></p>
    </div>"""
    return send_email(to, subject, html)


def send_trial_welcome_email(to: str, name: str) -> bool:
    from datetime import datetime, timedelta
    trial_end = (datetime.utcnow() + timedelta(days=7)).strftime("%d %B %Y")
    display_name = name.split("@")[0] if "@" in name else name
    subject = "Selamat Datang di FYJob — Trial Pro 7 Hari Kamu Sudah Aktif! 🎉"
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;color:#1e293b">
      <h2 style="color:#6366f1;margin-bottom:4px">Halo, {display_name}! 👋</h2>
      <p style="margin-top:0">Akun FYJob kamu sudah aktif dengan <strong>Trial Pro Plan selama 7 hari</strong> — gratis!</p>
      <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0">
        <p style="margin:0 0 8px 0"><strong>Yang kamu dapat selama trial:</strong></p>
        <ul style="margin:0;padding-left:20px;line-height:1.8">
          <li>✅ Analisis CV tak terbatas dengan AI</li>
          <li>✅ Interview latihan dengan AI (termasuk mode suara)</li>
          <li>✅ Killer Quiz untuk posisi apapun</li>
          <li>✅ Learning Path yang dipersonalisasi</li>
          <li>✅ 20 kredit per hari</li>
        </ul>
      </div>
      <p>Trial berlaku hingga <strong>{trial_end}</strong>. Setelah itu akun otomatis beralih ke Free Plan.</p>
      <p style="margin-top:20px">
        <a href="https://fyjob.my.id/dashboard"
           style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
          Buka Dashboard →
        </a>
      </p>
      <p style="font-size:12px;color:#94a3b8;margin-top:24px">
        Email ini dikirim secara otomatis. Jangan balas email ini.
      </p>
    </div>"""
    return send_email(to, subject, html)


def send_new_quiz_alert(to: str, job_title: str) -> bool:
        subject = "FYJob Alert — New Quiz Is Ready"
        html = f"""
        <div style="font-family:sans-serif;max-width:480px;margin:auto">
            <h2 style="margin-bottom:8px">Your Quiz is Ready</h2>
            <p>We prepared a new killer quiz for this target role:</p>
            <p style="font-size:16px"><strong>{job_title or 'Target Role'}</strong></p>
            <p style="margin-top:16px">
                Open FYJob dashboard to start practicing and improve your match score.
            </p>
            <p><a href="https://fyjob.my.id/dashboard/quiz" style="color:#2563eb">Open Killer Quiz →</a></p>
        </div>"""
        return send_email(to, subject, html)
