"""
Shared JWT Authentication
Centralized JWT validation for all Azure Functions.
Supports both HS256 (legacy) and ES256 (Supabase default) tokens.
"""
import os
import json
import logging
from typing import Dict, Any, Optional
import jwt
from jwt import PyJWKClient
from .cosmos_client import get_secret
import azure.functions as func

# CORS headers used by all endpoints
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
}

# ─── JWKS Client (cached) for ES256 verification ───
_jwks_client = None
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")


def _get_jwks_client():
    """Get or create a cached JWKS client for Supabase."""
    global _jwks_client
    if _jwks_client:
        return _jwks_client
    
    url = SUPABASE_URL or os.environ.get("SUPABASE_URL", "") or get_secret("SUPABASE_URL") or "https://uwzrsqhnseepshkffaud.supabase.co"
    if not url:
        return None
    
    jwks_url = f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    try:
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)
        return _jwks_client
    except Exception as e:
        logging.error(f"Failed to create JWKS client: {e}")
        return None


def verify_jwt(token: str) -> Optional[Dict[str, Any]]:
    """
    Verify Supabase JWT token, return payload or None.
    Strategy:
      1. Try ES256 via JWKS (Supabase default since late 2024)
      2. Fallback to HS256 with JWT secret (legacy projects)
    """
    # ── Strategy 1: ES256 via JWKS ──
    jwks_client = _get_jwks_client()
    if jwks_client:
        try:
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256"],
                audience="authenticated"
            )
            return payload
        except jwt.ExpiredSignatureError:
            logging.error("JWT expired (ES256)")
            return None
        except jwt.InvalidTokenError as e:
            logging.warning(f"ES256 verification failed: {e}, trying HS256 fallback...")
        except Exception as e:
            logging.warning(f"JWKS verification error: {e}, trying HS256 fallback...")

    # ── Strategy 2: HS256 with secret (fallback) ──
    try:
        secret = get_secret("jwt-supabase")
        if not secret:
            logging.error("JWT secret not found and JWKS also failed")
            return None
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience="authenticated"
        )
        return payload
    except jwt.ExpiredSignatureError:
        logging.error("JWT expired (HS256)")
        return None
    except jwt.InvalidTokenError as e:
        logging.error(f"Invalid JWT (HS256 fallback): {e}")
        return None


def authenticate(req: func.HttpRequest):
    """
    Authenticate request. Returns (user_id, email, error_response).
    If error_response is not None, return it immediately.
    """
    # Handle CORS preflight
    if req.method == "OPTIONS":
        return None, None, func.HttpResponse("", status_code=200, headers=CORS_HEADERS)

    auth_header = req.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None, None, func.HttpResponse(
            json.dumps({"error": "Missing or invalid Authorization header"}),
            status_code=401, headers=CORS_HEADERS
        )

    token = auth_header.split("Bearer ")[1]
    payload = verify_jwt(token)

    if not payload:
        return None, None, func.HttpResponse(
            json.dumps({"error": "Invalid or expired token"}),
            status_code=401, headers=CORS_HEADERS
        )

    user_id = payload.get("sub")
    email = payload.get("email", "")

    if not user_id:
        return None, None, func.HttpResponse(
            json.dumps({"error": "Invalid token payload"}),
            status_code=401, headers=CORS_HEADERS
        )

    return user_id, email, None


def error_response(message: str, status_code: int = 500) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"error": message}),
        status_code=status_code, headers=CORS_HEADERS
    )


def success_response(data: Any, status_code: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(data, default=str),
        status_code=status_code, headers=CORS_HEADERS
    )
