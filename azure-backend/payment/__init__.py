"""
Azure Function: Payment
GET  /api/payment                 — Get current plan & available plans
POST /api/payment action=create   — Create a Louvin.dev transaction → returns redirect URL
POST /api/payment action=webhook  — Receive Louvin.dev payment webhook (no auth required)
"""
import azure.functions as func
import logging
import json
import hmac
import hashlib
import os
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from shared.auth import authenticate, error_response, success_response, CORS_HEADERS
from shared.cosmos_client import get_container, get_secret, ALLOWED_ADMIN_EMAIL

# ─── Louvin.dev config ───
LOUVIN_BASE_URL = "https://api.louvin.dev"
LOUVIN_SLUG = "fyjob"

PLAN_PRICES = {
    "basic": {"amount": 29000, "currency": "IDR", "label": "Basic Plan – Rp29.000/bulan"},
    "pro":   {"amount": 79000, "currency": "IDR", "label": "Pro Plan – Rp79.000/bulan"},
}

PLAN_DURATION_DAYS = {
    "basic": 30,
    "pro": 30,
}


def _get_louvin_key() -> str:
    return get_secret("LOUVIN_API_KEY") or os.environ.get("LOUVIN_API_KEY", "")


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower().replace(" ", "")


def _is_admin(email: str) -> bool:
    return _normalize_email(email) == _normalize_email(ALLOWED_ADMIN_EMAIL)


def _get_user_plan(user_doc: dict) -> str:
    """Derive effective plan. Admin always gets 'admin', otherwise use stored plan or 'free'."""
    email = user_doc.get("email", "")
    if _is_admin(email):
        return "admin"
    plan = user_doc.get("plan", "free")
    # Check expiry
    plan_expires_at = user_doc.get("plan_expires_at")
    if plan in ("basic", "pro") and plan_expires_at:
        try:
            expires = datetime.fromisoformat(plan_expires_at)
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires < datetime.now(timezone.utc):
                return "free"
        except Exception:
            pass
    return plan if plan in ("free", "basic", "pro") else "free"


def _create_louvin_transaction(amount: int, currency: str, label: str, user_id: str, plan: str, email: str, success_url: str, cancel_url: str) -> dict:
    """Call Louvin.dev POST /create-transaction."""
    api_key = _get_louvin_key()
    if not api_key:
        raise RuntimeError("LOUVIN_API_KEY not configured")

    payload = {
        "amount": amount,
        "currency": currency,
        "description": label,
        "slug": LOUVIN_SLUG,
        "metadata": {
            "user_id": user_id,
            "plan": plan,
            "email": email,
        },
        "redirect_url": success_url,
        "cancel_url": cancel_url,
    }
    body = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        f"{LOUVIN_BASE_URL}/create-transaction",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="replace") if e else ""
        logging.error(f"Louvin API error {e.code}: {body_err}")
        raise RuntimeError(f"Payment gateway error ({e.code}): {body_err}")


def _handle_webhook(req: func.HttpRequest) -> func.HttpResponse:
    """
    Louvin.dev webhook — POST /api/payment with action header/query = webhook.
    Validates signature header X-Louvin-Signature if present, then upgrades user plan.
    """
    try:
        raw_body = req.get_body()
        body = json.loads(raw_body.decode("utf-8"))
    except Exception:
        return func.HttpResponse("Bad request", status_code=400)

    # Optional HMAC verification (Louvin sends X-Louvin-Signature)
    sig_header = req.headers.get("X-Louvin-Signature", "")
    api_key = _get_louvin_key()
    if sig_header and api_key:
        expected = hmac.new(api_key.encode(), raw_body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig_header, expected):
            logging.warning("Louvin webhook signature mismatch")
            return func.HttpResponse("Forbidden", status_code=403)

    status = (body.get("status") or "").lower()
    if status not in ("paid", "success", "completed"):
        # Not a paid event — just ack
        return func.HttpResponse(json.dumps({"ok": True}), status_code=200, headers={"Content-Type": "application/json"})

    metadata = body.get("metadata") or {}
    user_id = str(metadata.get("user_id") or "").strip()
    plan = str(metadata.get("plan") or "").strip().lower()

    if not user_id or plan not in PLAN_PRICES:
        logging.warning(f"Webhook missing metadata: user_id={user_id} plan={plan}")
        return func.HttpResponse(json.dumps({"ok": True}), status_code=200, headers={"Content-Type": "application/json"})

    try:
        users = get_container("Users")
        user_doc = users.read_item(item=user_id, partition_key=user_id)
        duration_days = PLAN_DURATION_DAYS.get(plan, 30)
        expires_at = (datetime.now(timezone.utc) + timedelta(days=duration_days)).isoformat()
        user_doc["plan"] = plan
        user_doc["plan_expires_at"] = expires_at
        user_doc["plan_activated_at"] = datetime.now(timezone.utc).isoformat()
        user_doc["plan_transaction_id"] = str(body.get("id") or body.get("transaction_id") or "")
        users.upsert_item(user_doc)
        logging.info(f"Plan upgraded: user={user_id} plan={plan} expires={expires_at}")
    except Exception as e:
        logging.error(f"Failed to upgrade user plan: {e}")
        return func.HttpResponse("Internal error", status_code=500)

    return func.HttpResponse(json.dumps({"ok": True}), status_code=200, headers={"Content-Type": "application/json"})


def main(req: func.HttpRequest) -> func.HttpResponse:
    logging.info("Payment function triggered")

    # OPTIONS preflight
    if req.method == "OPTIONS":
        return func.HttpResponse("", status_code=200, headers=CORS_HEADERS)

    # Webhook is unauthenticated — check before auth
    action_param = (req.params.get("action") or "").strip().lower()
    if action_param == "webhook" or req.method == "POST" and (req.headers.get("X-Louvin-Signature") or action_param == "webhook"):
        # Try to detect webhook via header or explicit action
        try:
            raw = req.get_body()
            body_sniff = json.loads(raw) if raw else {}
            sniff_action = (body_sniff.get("action") or "").lower()
        except Exception:
            sniff_action = ""
        if action_param == "webhook" or sniff_action == "webhook" or req.headers.get("X-Louvin-Signature"):
            return _handle_webhook(req)

    user_id, email, err = authenticate(req)
    if err:
        return err

    try:
        users = get_container("Users")
        user_doc = users.read_item(item=user_id, partition_key=user_id)
    except Exception:
        user_doc = {"id": user_id, "email": email}

    current_plan = _get_user_plan(user_doc)
    plan_expires_at = user_doc.get("plan_expires_at")
    is_admin_user = _is_admin(email)

    # ── GET: return current plan info ──
    if req.method == "GET":
        return success_response({
            "current_plan": current_plan,
            "plan_expires_at": plan_expires_at,
            "is_admin": is_admin_user,
            "available_plans": [
                {
                    "id": "free",
                    "name": "Free",
                    "price": 0,
                    "price_label": "Rp0",
                    "subtitle": "Selamanya",
                    "features": [
                        "Quick Match analysis",
                        "Study Room basic path",
                        "Killer Quiz generation",
                        "CV manager core tools",
                        "5 credits/hari",
                    ],
                },
                {
                    "id": "basic",
                    "name": "Basic",
                    "price": 29000,
                    "price_label": "Rp29.000",
                    "subtitle": "/bulan",
                    "features": [
                        "Semua fitur Free",
                        "Limit harian lebih tinggi",
                        "Interview Lite (text mode)",
                        "Prioritas generasi lebih cepat",
                        "10 credits/hari",
                    ],
                },
                {
                    "id": "pro",
                    "name": "Pro",
                    "price": 79000,
                    "price_label": "Rp79.000",
                    "subtitle": "/bulan",
                    "highlighted": True,
                    "features": [
                        "Semua fitur Basic",
                        "Interview Lite speech mode",
                        "Deep AI coaching quality",
                        "Prioritas antrian tertinggi",
                        "20 credits/hari",
                    ],
                },
            ],
        })

    # ── POST: create transaction ──
    if req.method == "POST":
        try:
            body = req.get_json()
        except Exception:
            return error_response("Invalid JSON body", 400)

        action = (body.get("action") or "").strip().lower()

        if action == "create":
            plan = (body.get("plan") or "").strip().lower()
            if plan not in PLAN_PRICES:
                return error_response(f"Invalid plan. Choose: {list(PLAN_PRICES.keys())}", 400)

            if is_admin_user:
                return error_response("Admin sudah unlimited, tidak perlu upgrade.", 400)

            if current_plan == plan:
                return error_response(f"Kamu sudah berlangganan paket {plan}.", 400)

            plan_info = PLAN_PRICES[plan]
            success_url = str(body.get("success_url") or "https://fyjob.my.id/dashboard?payment=success")
            cancel_url = str(body.get("cancel_url") or "https://fyjob.my.id/dashboard/upgrade?payment=cancel")

            try:
                result = _create_louvin_transaction(
                    amount=plan_info["amount"],
                    currency=plan_info["currency"],
                    label=plan_info["label"],
                    user_id=user_id,
                    plan=plan,
                    email=email,
                    success_url=success_url,
                    cancel_url=cancel_url,
                )
            except RuntimeError as e:
                return error_response(str(e), 502)

            return success_response({
                "checkout_url": result.get("checkout_url") or result.get("url") or result.get("redirect_url"),
                "transaction_id": result.get("id") or result.get("transaction_id"),
                "plan": plan,
                "amount": plan_info["amount"],
            })

        if action == "webhook":
            return _handle_webhook(req)

        return error_response("Unknown action. Use: create, webhook", 400)

    return error_response("Method not allowed", 405)
