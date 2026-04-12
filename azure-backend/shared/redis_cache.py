import hashlib
import json
import os
import time
from typing import Any, Optional

try:
    import redis
except Exception:  # pragma: no cover
    redis = None


_redis_client = None


def get_redis_client():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    if redis is None:
        return None

    redis_url = os.environ.get("REDIS_URL")
    if redis_url:
        try:
            _redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
            return _redis_client
        except Exception:
            return None

    host = os.environ.get("REDIS_HOST")
    key = os.environ.get("REDIS_KEY")
    if not host or not key:
        return None

    try:
        _redis_client = redis.Redis(
            host=host,
            port=int(os.environ.get("REDIS_PORT", "6380")),
            password=key,
            ssl=True,
            decode_responses=True,
        )
        return _redis_client
    except Exception:
        return None


def hash_text(*parts: Any) -> str:
    payload = "|".join([str(p or "") for p in parts])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def get_json(key: str) -> Optional[Any]:
    client = get_redis_client()
    if not client:
        return None
    try:
        raw = client.get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


def set_json(key: str, value: Any, ttl_sec: int) -> None:
    client = get_redis_client()
    if not client:
        return
    try:
        client.setex(key, max(1, int(ttl_sec)), json.dumps(value))
    except Exception:
        return


def get_text(key: str) -> Optional[str]:
    client = get_redis_client()
    if not client:
        return None
    try:
        return client.get(key)
    except Exception:
        return None


def set_text(key: str, value: str, ttl_sec: int) -> None:
    client = get_redis_client()
    if not client:
        return
    try:
        client.setex(key, max(1, int(ttl_sec)), value)
    except Exception:
        return


def acquire_lock(key: str, ttl_sec: int) -> Optional[str]:
    client = get_redis_client()
    if not client:
        return "noop"
    token = hashlib.md5(f"{key}-{time.time()}".encode("utf-8")).hexdigest()
    try:
        ok = bool(client.set(key, token, nx=True, ex=max(1, int(ttl_sec))))
        return token if ok else None
    except Exception:
        return "noop"


def release_lock(key: str, token: Optional[str]) -> None:
    client = get_redis_client()
    if not client or not token or token == "noop":
        return
    try:
        current = client.get(key)
        if current == token:
            client.delete(key)
    except Exception:
        return


def increment_window(key: str, ttl_sec: int) -> int:
    client = get_redis_client()
    if not client:
        return 0
    try:
        count = int(client.incr(key))
        if count == 1:
            client.expire(key, max(1, int(ttl_sec)))
        return count
    except Exception:
        return 0