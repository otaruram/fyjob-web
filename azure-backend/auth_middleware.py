"""
Authentication & Authorization Middleware (LEGACY)
⚠️ Deprecated — use shared/auth.py instead.
This file is kept for backward compatibility only.
"""
import jwt
import os
from datetime import datetime, timedelta
from jwt import PyJWKClient
import logging

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
JWT_SECRET = os.environ.get("JWT_SECRET")

_jwks_client = None

def _get_jwks():
    global _jwks_client
    if _jwks_client:
        return _jwks_client
    if SUPABASE_URL:
        try:
            _jwks_client = PyJWKClient(f"{SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True)
            return _jwks_client
        except Exception as e:
            logging.warning(f"JWKS init failed: {e}")
    return None

def verify_token(token: str):
    """Verify JWT token — tries ES256 (JWKS) first, then HS256 fallback."""
    # Try ES256 via JWKS
    jwks = _get_jwks()
    if jwks:
        try:
            signing_key = jwks.get_signing_key_from_jwt(token)
            return jwt.decode(token, signing_key.key, algorithms=["ES256"], audience="authenticated")
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError) as e:
            logging.warning(f"ES256 failed: {e}")

    # Fallback: HS256
    try:
        if JWT_SECRET:
            return jwt.decode(token, JWT_SECRET, algorithms=["HS256"], audience="authenticated")
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        pass
    return None
