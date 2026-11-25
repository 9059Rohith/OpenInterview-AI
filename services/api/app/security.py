import base64
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request
from sqlalchemy import select, delete, update
from .models import Device, User, RateBucket, OAuthState


def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def future(days=0, minutes=0): return (datetime.now(timezone.utc) + timedelta(days=days, minutes=minutes)).isoformat()


def hash_password(password):
    salt = secrets.token_bytes(16)
    result = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return 'scrypt$' + base64.b64encode(salt).decode() + '$' + base64.b64encode(result).decode()


def check_password(password, stored):
    # Always perform a password derivation, including unknown accounts.
    try:
        _, salt, expected = stored.split('$')
        result = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=16384, r=8, p=1)
        return hmac.compare_digest(result, base64.b64decode(expected))
    except (AttributeError, ValueError):
        hashlib.scrypt(password.encode(), salt=b'unknown-account!', n=16384, r=8, p=1)
        return False


def consume_oauth_state(db, state):
    # Claim once in the database, even when callbacks hit different workers.
    verifier = db.execute(delete(OAuthState).where(
        OAuthState.state_hash == digest(state), OAuthState.expires_at > datetime.now(timezone.utc).isoformat()
    ).returning(OAuthState.verifier)).scalar_one_or_none()
    db.commit()
    return verifier


def set_session(db, user, response, settings, previous_token=None):
    if previous_token:
        db.execute(update(Device).where(Device.token_hash == digest(previous_token)).values(revoked=True))
    token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    device = Device(owner_id=user.id, token_hash=digest(token), csrf_hash=digest(csrf), expires_at=future(days=settings.session_days))
    db.add(device)
    db.commit()
    cookie = dict(secure=settings.secure_cookies, samesite='none' if settings.mode == 'cloud' else 'lax', max_age=settings.session_days * 86400, path='/')
    response.set_cookie('oi_session', token, httponly=True, **cookie)
    response.set_cookie('oi_csrf', csrf, httponly=False, **cookie)
    device.csrf_token = csrf  # transient response field; only its hash is persisted
    return device


def identify(request: Request, db):
    raw = request.cookies.get('oi_session')
    if not raw: raise HTTPException(401, 'Sign in required')
    device = db.scalar(select(Device).where(Device.token_hash == digest(raw), Device.revoked.is_(False), Device.expires_at > datetime.now(timezone.utc).isoformat()))
    if not device: raise HTTPException(401, 'Session expired or revoked')
    if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
        csrf = request.headers.get('x-csrf-token', '')
        if not csrf or not hmac.compare_digest(digest(csrf), device.csrf_hash):
            raise HTTPException(403, 'Missing or invalid CSRF token')
    user = db.get(User, device.owner_id)
    if not user: raise HTTPException(401, 'Account unavailable')
    request.state.device = device
    return user


class RateLimiter:
    """Atomic database fixed-window limits across workers; public no-DB mode falls back to memory."""
    def __init__(self, sessions=None):
        self.hits = defaultdict(deque)
        self.last_cleanup = time.monotonic()
        self.sessions = sessions

    def check(self, key, limit=120, seconds=60):
        if self.sessions:
            from sqlalchemy.dialects.sqlite import insert as sqlite_insert
            from sqlalchemy.dialects.postgresql import insert as postgres_insert
            with self.sessions() as db:
                epoch = int(time.time())
                window = epoch // seconds
                hashed = digest('rate-v1:' + repr(key) + ':' + str(seconds))
                insert = sqlite_insert if db.bind.dialect.name == 'sqlite' else postgres_insert
                statement = insert(RateBucket).values(key_hash=hashed, window=window, count=1, expires_at=(window + 1) * seconds)
                statement = statement.on_conflict_do_update(index_elements=['key_hash', 'window'], set_={'count': RateBucket.count + 1}).returning(RateBucket.count)
                count = db.execute(statement).scalar_one()
                if time.monotonic() - self.last_cleanup > 60:
                    db.execute(delete(RateBucket).where(RateBucket.expires_at <= epoch))
                    self.last_cleanup = time.monotonic()
                db.commit()
            if count > limit: raise HTTPException(429, 'Rate limit reached; retry later', headers={'Retry-After': str(seconds - epoch % seconds)})
            return
        now = time.monotonic()
        if now - self.last_cleanup > 60:
            for old_key in list(self.hits):
                if not self.hits[old_key] or self.hits[old_key][-1] <= now - 3600:
                    self.hits.pop(old_key, None)
            self.last_cleanup = now
        queue = self.hits[key]
        while queue and queue[0] <= now - seconds: queue.popleft()
        if len(queue) >= limit: raise HTTPException(429, 'Rate limit reached; retry later', headers={'Retry-After': str(seconds)})
        queue.append(now)


def require_consent(request, consent):
    if request.app.state.settings.mode == 'cloud' and not consent:
        raise HTTPException(422, 'Explicit consentCloud=true is required before personal content is uploaded to cloud storage or processing')
