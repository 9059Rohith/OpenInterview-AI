import asyncio
import base64
import hashlib
import json
import logging
import os
import secrets
import smtplib
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage
from io import BytesIO
from urllib.parse import urlencode
import httpx
from fastapi import FastAPI, APIRouter, Depends, Request, Response, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, PlainTextResponse, StreamingResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select, delete, func, update, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from .config import Settings
from .database import make_engine, migrate, get_db
from . import models as m, schemas as s
from .security import identify, hash_password, check_password, set_session, digest, future, RateLimiter, require_consent
from .intelligence import analyze_resume, extract_document, optimize, evaluate_answer, tokens
from .providers import ProviderGateway
from .billing import Razorpay, plans, active_subscription

log = logging.getLogger('openinterview.events')
if not log.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(message)s'))
    log.addHandler(handler)
log.setLevel(logging.INFO)
log.propagate = False


def user_json(user): return {'id': user.id, 'email': user.email, 'name': user.name}
def owned(db, model, identifier, owner):
    value = db.scalar(select(model).where(model.id == identifier, model.owner_id == owner))
    if not value: raise HTTPException(404, 'Resource not found')
    return value


def public_question(db, question):
    source = db.get(m.QuestionSource, question.source_id)
    return {'id': question.id, 'company': question.company, 'role': question.role, 'topic': question.topic, 'difficulty': question.difficulty, 'question': question.question, 'expectedConcepts': question.expected_concepts, 'sampleAnswer': question.sample_answer, 'followUps': question.follow_ups, 'source': {'title': source.title, 'url': source.url, 'collectedAt': source.created_at, 'confidence': source.confidence}, 'original': question.original, 'userSubmission': question.owner_id is not None}


def accessible_question(db, identifier, owner):
    question = db.scalar(select(m.Question).where(m.Question.id == identifier, or_(m.Question.owner_id.is_(None), m.Question.owner_id == owner)))
    if not question: raise HTTPException(404, 'Question not found')
    return question


def document_json(record):
    return {'id': record.id, 'name': record.name, 'type': record.type, 'text': record.text, 'createdAt': record.created_at, 'updatedAt': record.updated_at, 'consentCloud': record.consent_cloud}


def resume_json(record):
    return {'id': record.id, 'name': record.name, 'text': record.text, 'sections': record.sections, 'createdAt': record.created_at, 'updatedAt': record.updated_at, 'consentCloud': record.consent_cloud}


def session_json(db, record):
    turns = db.scalars(select(m.Turn).where(m.Turn.session_id == record.id, m.Turn.owner_id == record.owner_id).order_by(m.Turn.created_at)).all()
    note = db.scalar(select(m.SessionNote).where(m.SessionNote.session_id == record.id, m.SessionNote.owner_id == record.owner_id))
    return {'id': record.id, 'title': record.title, 'mode': record.mode, 'category': record.category, 'company': record.company, 'role': record.role, 'difficulty': record.difficulty, 'status': record.status, 'archived': record.archived, 'createdAt': record.created_at, 'updatedAt': record.updated_at, 'notes': note.text if note else '', 'summary': note.summary if note else {}, 'turns': [{'id': t.id, 'speaker': t.speaker, 'text': t.text, 'createdAt': t.created_at, 'evaluation': t.evaluation} for t in turns]}


def roadmap_json(db, roadmap):
    items = db.scalars(select(m.RoadmapItem).where(m.RoadmapItem.roadmap_id == roadmap.id).order_by(m.RoadmapItem.created_at)).all()
    return {'id': roadmap.id, 'title': roadmap.title, 'items': [{'id': item.id, 'topic': item.topic, 'dueDate': item.due_date, 'completed': item.completed} for item in items]}


def seed(db):
    if db.scalar(select(m.Question.id).limit(1)): return
    source = m.QuestionSource(title='OpenInterview AI original practice material', url='', confidence='original')
    db.add(source)
    db.flush()
    examples = [
        ('System Design', 'Design a URL shortener. Explain identifiers, storage, caching and abuse controls.', ['identifiers', 'cache', 'collision', 'rate limit'], 'Clarify scale, choose collision-safe identifiers and indexed persistence, add caching and rate limits, then explain failure modes.'),
        ('Python', 'Explain mutable default arguments in Python and demonstrate a safe alternative.', ['mutable', 'None', 'shared'], 'Defaults are evaluated once when the function is defined. Use None and allocate a new list in the function body.'),
        ('Behavioral', 'Describe a disagreement on a team and how you resolved it with evidence.', ['situation', 'action', 'result'], 'Use a real situation, explain your responsibility, describe the evidence and respectful discussion, then share the outcome and learning.'),
        ('SQL', 'How would you find the second highest distinct salary in an employee table?', ['distinct', 'order', 'null'], 'Use DENSE_RANK over salary descending, exclude null salaries, and filter rank 2; describe tie behavior.'),
        ('DBMS', 'Explain transaction isolation and give an example of a lost update.', ['transaction', 'isolation', 'concurrent'], 'Describe concurrent reads and writes, isolation guarantees, and optimistic version checks or row locks.'),
        ('Networks', 'What happens from entering a URL to receiving an HTTPS response?', ['DNS', 'TLS', 'HTTP'], 'Explain DNS lookup, connection establishment, TLS authentication, HTTP request, server processing and response rendering.'),
        ('Coding', 'Find two numbers in an array that add to a target. Discuss duplicates and complexity.', ['hash', 'complement', 'O(n)'], 'Track seen values and indices in a hash map. Check the complement before inserting each number; average time O(n), memory O(n).'),
        ('Machine Learning', 'How do you detect and reduce overfitting in a supervised model?', ['validation', 'regularization', 'leakage'], 'Compare train and validation performance, prevent leakage, use appropriate splits and regularization, then evaluate on held-out data.'),
        ('Leadership', 'How would you prioritize competing deadlines when your team has limited capacity?', ['impact', 'risk', 'communication'], 'Make constraints explicit, compare impact and risk, agree on scope and communicate ownership and trade-offs early.'),
        ('Operating Systems', 'Explain deadlock conditions and one practical prevention strategy.', ['mutual exclusion', 'hold', 'circular'], 'Describe mutual exclusion, hold-and-wait, no preemption and circular wait. A consistent resource lock order prevents circular wait.'),
        ('OOP', 'When would you choose composition over inheritance? Give a concrete example.', ['composition', 'coupling', 'interface'], 'Prefer composition when behavior should vary independently. Inject a strategy behind an interface and explain the coupling trade-off.'),
        ('Projects', 'Choose one project and explain your own contribution, a constraint and a measurable outcome.', ['contribution', 'constraint', 'outcome'], 'Use only verifiable facts. Separate your contribution from the team and explain a design decision and its observed result.'),
    ]
    for topic, question, concepts, answer in examples:
        db.add(m.Question(company='General', role='Software Engineer', topic=topic, question=question, expected_concepts=concepts, sample_answer=answer, follow_ups=['What trade-off would change your approach?', 'How would you validate your answer?'], source_id=source.id))
    company = m.Company(name='General', overview='Original preparation material applicable across employers. No claim about a specific company hiring process.')
    db.add(company)
    db.flush()
    db.add(m.Role(company_id=company.id, name='Software Engineer', skills=['Problem solving', 'Communication', 'Data structures']))
    db.commit()


def create_app(settings=None, engine=None, provider=None, billing=None):
    settings = settings or Settings()
    settings.validate()
    persistence_ready = settings.mode == 'local' or bool(os.getenv('DATABASE_URL')) or engine is not None
    engine = engine or make_engine(settings.database_url if persistence_ready else 'sqlite:///:memory:')
    sessions = sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def lifespan(app):
        if settings.auto_migrate or not persistence_ready:
            migrate(engine)
        with sessions() as db: seed(db)
        log.info(json.dumps({'event': 'startup', 'mode': settings.mode, 'persistentDatabase': persistence_ready}))
        yield

    app = FastAPI(title='OpenInterview AI API', version='1.0.0', lifespan=lifespan)
    app.state.settings = settings
    app.state.sessions = sessions
    app.state.engine = engine
    app.state.persistence_ready = persistence_ready
    app.state.providers = provider or ProviderGateway(local=settings.mode == 'local')
    app.state.billing = billing or Razorpay(settings)
    app.state.oauth_transport = None  # Injectable test transport; never configured from request data.
    app.state.runner_transport = None
    app.state.limiter = RateLimiter(sessions if persistence_ready else None)
    app.state.context_stats = {'requests': 0, 'tokensBefore': 0, 'tokensAfter': 0}
    app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=True, allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allow_headers=['Content-Type', 'X-CSRF-Token'], expose_headers=['X-Request-ID'])

    @app.middleware('http')
    async def safeguards(request, call_next):
        start, request_id = time.perf_counter(), secrets.token_hex(8)
        response = None
        try:
            origin = request.headers.get('origin')
            if request.method not in {'GET', 'HEAD', 'OPTIONS'} and origin and origin not in settings.origins:
                raise HTTPException(403, 'Origin is not allowed')
            if request.headers.get('sec-fetch-site') == 'cross-site' and request.method not in {'GET', 'HEAD', 'OPTIONS'} and not origin:
                raise HTTPException(403, 'Cross-site request rejected')
            app.state.limiter.check(('request', request.client.host if request.client else 'unknown'), 240)
            if any(request.headers.get(header) for header in ['authorization', 'x-api-key', 'x-goog-api-key']):
                raise HTTPException(422, 'This API accepts cookie sessions only. Never send BYOK credentials to the backend.')
            if request.method in {'POST', 'PUT', 'PATCH'}:
                raw = bytearray()
                async for chunk in request.stream():
                    raw.extend(chunk)
                    if len(raw) > settings.max_body: raise HTTPException(413, 'Request body exceeds 12 MiB')
                request._body = bytes(raw)
                if request.headers.get('content-type', '').startswith('application/json'):
                    try: parsed_body = json.loads(raw)
                    except (ValueError, UnicodeDecodeError): parsed_body = None
                    def has_credentials(value):
                        if isinstance(value, dict):
                            for key, item in value.items():
                                normalized = ''.join(c for c in str(key).lower() if c.isalnum())
                                if normalized in {'apikey', 'providerkey', 'openaikey', 'openaiapikey', 'geminiapikey', 'anthropicapikey', 'accesstoken', 'refreshtoken', 'credentials'} or has_credentials(item): return True
                        elif isinstance(value, list): return any(has_credentials(item) for item in value)
                        return False
                    if has_credentials(parsed_body): raise HTTPException(422, 'BYOK credentials cannot be accepted or stored by this backend')
            response = await call_next(request)
        except HTTPException as exc:
            response = JSONResponse({'detail': exc.detail}, status_code=exc.status_code, headers=exc.headers)
        except Exception:
            log.error(json.dumps({'event': 'request_failed', 'requestId': request_id}))
            response = JSONResponse({'detail': 'Request failed; retry or check server readiness', 'requestId': request_id}, status_code=500)
        elapsed = round((time.perf_counter() - start) * 1000)
        route = getattr(request.scope.get('route'), 'path', 'unmatched')
        log.info(json.dumps({'event': 'http_request', 'requestId': request_id, 'route': route, 'method': request.method, 'status': response.status_code, 'latencyMs': elapsed}))
        csp = "default-src 'none'; frame-ancestors 'none'"
        if route in {'/docs', '/redoc'}:
            csp = "default-src 'none'; script-src https://cdn.jsdelivr.net 'unsafe-inline'; style-src https://cdn.jsdelivr.net 'unsafe-inline'; img-src https://fastapi.tiangolo.com data:; connect-src 'self'; frame-ancestors 'none'"
        response.headers.update({'X-Request-ID': request_id, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': csp})
        # Aggregates contain route templates only, never path IDs, IPs, bodies or credentials.
        if route not in {'unmatched', '/health'}:
            try:
                with sessions() as db:
                    db.add(m.Metric(route=route, status=response.status_code, latency_ms=elapsed))
                    db.execute(delete(m.Metric).where(m.Metric.created_at < (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()))
                    db.commit()
            except Exception: pass  # Logging cannot alter a successful user request.
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Pydantic's default errors include the submitted input (possibly a password/key).
        return JSONResponse(status_code=422, content={'detail': [{'loc': error['loc'], 'msg': error['msg'], 'type': error['type']} for error in exc.errors()]})

    @app.exception_handler(IntegrityError)
    async def conflict(request, exc):
        return JSONResponse(status_code=409, content={'detail': 'This record already exists or conflicts with a related record'})

    def ready():
        if not persistence_ready: raise HTTPException(503, 'Cloud account storage is not configured. Use local-first guest mode; configure PostgreSQL DATABASE_URL for accounts and sync.')

    def current(request: Request, db: Session = Depends(get_db)):
        ready()
        return identify(request, db)

    def optional_user(request, db):
        if request.cookies.get('oi_session'):
            ready()
            return identify(request, db)
        return None

    def auth_limit(request, email):
        app.state.limiter.check(('auth-ip', request.client.host if request.client else 'unknown'), 20, 900)
        app.state.limiter.check(('auth-account', digest(email.lower())), 10, 900)

    def quota(db, user, kind='generate'):
        sub = active_subscription(db, user.id)
        limit = (50 if sub.plan == 'pro' else 20) if sub else 0
        if kind == 'transcribe': limit = min(limit, 10)
        if kind == 'headshot': limit = (2 if sub.plan == 'pro' else 1) if sub else 0
        period = datetime.now(timezone.utc).strftime('%Y-%m')
        usage = db.scalar(select(m.Usage).where(m.Usage.owner_id == user.id, m.Usage.period == period, m.Usage.kind == kind))
        if not usage:
            usage = m.Usage(owner_id=user.id, period=period, kind=kind, count=0)
            db.add(usage)
            db.flush()
        if limit == 0: raise HTTPException(402, 'Server inference requires an active paid plan. Local AI and direct BYOK remain available without this server budget.')
        result = db.execute(update(m.Usage).where(m.Usage.id == usage.id, m.Usage.count < limit).values(count=m.Usage.count + 1))
        if result.rowcount != 1: raise HTTPException(429, 'Monthly server inference allowance exhausted')
        db.commit()

    @app.get('/health')
    def health():
        database = 'not configured'
        if persistence_ready:
            try:
                with engine.connect() as connection: connection.exec_driver_sql('SELECT 1')
                database = 'ready'
            except Exception: database = 'unavailable'
        return {'status': 'ok' if database == 'ready' else 'degraded', 'service': 'OpenInterview AI', 'mode': settings.mode, 'database': database, 'accountsReady': database == 'ready'}

    router = APIRouter(prefix='/api/v1')

    @router.get('/capabilities')
    def capabilities():
        return {'mode': settings.mode, 'accounts': persistence_ready, 'cloudSync': persistence_ready and settings.mode == 'cloud', 'googleOAuth': bool(settings.google_id and settings.google_secret and persistence_ready), 'passwordRecovery': bool(os.getenv('SMTP_HOST')), 'billing': app.state.billing.configured() and persistence_ready, 'codingRunner': bool(settings.runner_url and settings.runner_token), 'providers': app.state.providers.status(), 'speech': {'uploadTranscription': app.state.providers.configured('openai'), 'explicitConsentRequired': True, 'audioStored': False, 'streaming': 'Use short explicitly captured chunks; no hidden or continuous server recording'}, 'byokToBackend': False, 'headshots': {'configured': app.state.providers.configured('openai'), 'status': 'Server-owned OpenAI image-edit adapter; paid quota and explicit own-photo consent required' if app.state.providers.configured('openai') else 'Configure server OPENAI_API_KEY and HEADSHOT_MODEL for consented own-photo edits', 'styles': ['Professional', 'Natural', 'Studio'], 'backgrounds': ['Neutral', 'Light', 'Office'], 'uploadStored': False}, 'context': 'local deterministic extraction and ranking', 'database': 'configured' if persistence_ready else 'not configured; public catalog only'}

    @router.post('/auth/register', status_code=201)
    def register(data: s.Register, request: Request, response: Response, db: Session = Depends(get_db)):
        ready()
        auth_limit(request, str(data.email))
        email = str(data.email).lower()
        if db.scalar(select(m.User.id).where(m.User.email == email)): raise HTTPException(409, 'An account already exists')
        user = m.User(email=email, name=data.name, password_hash=hash_password(data.password))
        db.add(user)
        db.flush()
        db.add(m.Profile(owner_id=user.id, name=user.name))
        db.commit()
        device = set_session(db, user, response, settings)
        return {**user_json(user), 'csrfToken': device.csrf_token}

    @router.post('/auth/login')
    def login(data: s.Login, request: Request, response: Response, db: Session = Depends(get_db)):
        ready()
        auth_limit(request, str(data.email))
        user = db.scalar(select(m.User).where(m.User.email == str(data.email).lower()))
        if not check_password(data.password, user.password_hash if user else None): raise HTTPException(401, 'Invalid email or password')
        # Rotate an existing browser session on sign-in.
        old = request.cookies.get('oi_session')
        if old: db.execute(update(m.Device).where(m.Device.token_hash == digest(old)).values(revoked=True))
        device = set_session(db, user, response, settings)
        return {**user_json(user), 'csrfToken': device.csrf_token}

    @router.get('/auth/me')
    def me(request: Request, user=Depends(current)):
        return {**user_json(user), 'csrfToken': request.cookies.get('oi_csrf', '')}

    @router.get('/auth/csrf')
    def csrf(request: Request, user=Depends(current)):
        token = request.cookies.get('oi_csrf', '')
        if not token or not secrets.compare_digest(digest(token), request.state.device.csrf_hash):
            raise HTTPException(403, 'CSRF cookie missing; sign in again')
        return {'csrfToken': token}

    @router.post('/auth/logout')
    def logout(request: Request, response: Response, user=Depends(current), db: Session = Depends(get_db)):
        request.state.device.revoked = True
        db.commit()
        response.delete_cookie('oi_session', path='/')
        response.delete_cookie('oi_csrf', path='/')
        return {'loggedOut': True}

    @router.get('/auth/devices')
    def devices(request: Request, user=Depends(current), db: Session = Depends(get_db)):
        return [{'id': d.id, 'label': d.label, 'createdAt': d.created_at, 'expiresAt': d.expires_at, 'current': d.id == request.state.device.id, 'revoked': d.revoked} for d in db.scalars(select(m.Device).where(m.Device.owner_id == user.id).order_by(m.Device.created_at.desc()))]

    @router.delete('/auth/devices/{identifier}')
    def revoke(identifier: str, user=Depends(current), db: Session = Depends(get_db)):
        owned(db, m.Device, identifier, user.id).revoked = True
        db.commit()
        return {'revoked': True}

    @router.get('/auth/devices/{identifier}')
    def get_device(identifier: str, request: Request, user=Depends(current), db: Session = Depends(get_db)):
        d = owned(db, m.Device, identifier, user.id)
        return {'id': d.id, 'label': d.label, 'createdAt': d.created_at, 'expiresAt': d.expires_at, 'revoked': d.revoked, 'current': d.id == request.state.device.id}

    @router.delete('/auth/devices')
    def revoke_all(user=Depends(current), db: Session = Depends(get_db)):
        db.execute(update(m.Device).where(m.Device.owner_id == user.id).values(revoked=True))
        db.commit()
        return {'revoked': True}

    @router.get('/auth/google/start')
    def google_start(request: Request, format: str = '', db: Session = Depends(get_db)):
        ready()
        if not settings.google_id or not settings.google_secret: raise HTTPException(503, 'Google OAuth client credentials are not configured')
        state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
        db.execute(delete(m.OAuthState).where(m.OAuthState.expires_at <= m.now()))
        db.add(m.OAuthState(state_hash=digest(state), verifier=verifier, expires_at=future(minutes=10)))
        db.commit()
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urlencode({'client_id': settings.google_id, 'redirect_uri': settings.google_redirect, 'response_type': 'code', 'scope': 'openid email profile', 'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256', 'prompt': 'select_account'})
        response = JSONResponse({'url': url, 'authorizationUrl': url}) if format == 'json' or 'application/json' in request.headers.get('accept', '') else RedirectResponse(url, status_code=302)
        response.set_cookie('oi_oauth_state', state, httponly=True, secure=settings.secure_cookies, samesite='none' if settings.mode == 'cloud' else 'lax', max_age=600, path='/')
        return response

    @router.get('/auth/google/callback')
    async def google_callback(request: Request, state: str = '', code: str = '', db: Session = Depends(get_db)):
        ready()
        if not settings.google_id or not settings.google_secret: raise HTTPException(503, 'Google OAuth is not configured')
        if not state or not secrets.compare_digest(state, request.cookies.get('oi_oauth_state', '')): raise HTTPException(400, 'OAuth state mismatch')
        pending = db.scalar(select(m.OAuthState).where(m.OAuthState.state_hash == digest(state), m.OAuthState.expires_at > m.now()))
        if not pending or not code: raise HTTPException(400, 'OAuth state expired or authorization code missing')
        verifier = pending.verifier
        db.delete(pending)
        db.commit()  # One-time state, including failed exchanges.
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=False, transport=app.state.oauth_transport) as client:
                token = await client.post('https://oauth2.googleapis.com/token', data={'client_id': settings.google_id, 'client_secret': settings.google_secret, 'redirect_uri': settings.google_redirect, 'grant_type': 'authorization_code', 'code': code, 'code_verifier': verifier})
                token.raise_for_status()
                access = token.json()['access_token']
                info = await client.get('https://openidconnect.googleapis.com/v1/userinfo', headers={'Authorization': 'Bearer ' + access})
                info.raise_for_status()
                info = info.json()
        except (httpx.HTTPError, ValueError, KeyError): raise HTTPException(502, 'Google authorization exchange failed')
        if not info.get('email_verified') or not info.get('sub') or not info.get('email'): raise HTTPException(400, 'A verified Google email is required')
        email = info['email'].lower()
        user = db.scalar(select(m.User).where(m.User.google_sub == info['sub']))
        if not user:
            # Avoid silently linking a password account merely because an email matches.
            if db.scalar(select(m.User.id).where(m.User.email == email)): raise HTTPException(409, 'An account with this email exists. Sign in using the original method.')
            user = m.User(email=email, name=info.get('name', email)[:120], google_sub=info['sub'])
            db.add(user)
            db.flush()
            db.add(m.Profile(owner_id=user.id, name=user.name))
            db.commit()
        response = RedirectResponse(settings.frontend_url.rstrip('/') + '/login/', status_code=302)
        response.delete_cookie('oi_oauth_state', path='/')
        set_session(db, user, response, settings)
        return response

    @router.post('/auth/recovery/request')
    async def recovery_request(data: s.RecoveryRequest, request: Request, db: Session = Depends(get_db)):
        ready()
        auth_limit(request, str(data.email))
        user = db.scalar(select(m.User).where(m.User.email == str(data.email).lower()))
        if user and user.password_hash and os.getenv('SMTP_HOST'):
            raw = secrets.token_urlsafe(40)
            db.add(m.RecoveryToken(owner_id=user.id, token_hash=digest(raw), expires_at=future(minutes=20)))
            db.commit()
            def send():
                message = EmailMessage()
                message['Subject'] = 'OpenInterview AI password recovery'
                message['From'] = os.environ['SMTP_FROM']
                message['To'] = user.email
                message.set_content('Use this one-time recovery token within 20 minutes: ' + raw + '\nIf you did not request this, ignore this message.')
                with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.getenv('SMTP_PORT', '587')), timeout=15) as smtp:
                    smtp.starttls()
                    if os.getenv('SMTP_USER'): smtp.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
                    smtp.send_message(message)
            try: await asyncio.to_thread(send)
            except Exception: log.warning(json.dumps({'event': 'recovery_delivery_failed'}))
        return {'message': 'If recovery is available for this account, a one-time token will be emailed.', 'deliveryConfigured': bool(os.getenv('SMTP_HOST'))}

    @router.post('/auth/recovery/confirm')
    def recovery_confirm(data: s.RecoveryConfirm, request: Request, db: Session = Depends(get_db)):
        ready()
        app.state.limiter.check(('recovery', request.client.host if request.client else ''), 10, 900)
        token = db.scalar(select(m.RecoveryToken).where(m.RecoveryToken.token_hash == digest(data.token), m.RecoveryToken.used.is_(False), m.RecoveryToken.expires_at > m.now()))
        if not token: raise HTTPException(400, 'Invalid or expired recovery token')
        db.get(m.User, token.owner_id).password_hash = hash_password(data.password)
        db.execute(update(m.RecoveryToken).where(m.RecoveryToken.owner_id == token.owner_id).values(used=True))
        db.execute(update(m.Device).where(m.Device.owner_id == token.owner_id).values(revoked=True))
        db.commit()
        return {'passwordReset': True, 'sessionsRevoked': True}

    @router.get('/profile')
    def get_profile(user=Depends(current), db: Session = Depends(get_db)):
        profile = db.scalar(select(m.Profile).where(m.Profile.owner_id == user.id))
        return {'id': profile.id, 'name': profile.name, 'role': profile.role, 'experience': profile.experience, 'language': profile.language, 'companies': profile.companies, 'skills': list(db.scalars(select(m.Skill.name).where(m.Skill.owner_id == user.id))), 'education': profile.education, 'projects': [p.content for p in db.scalars(select(m.Project).where(m.Project.owner_id == user.id))], 'resumeText': profile.resume_text, 'consentCloud': profile.consent_cloud}

    @router.put('/profile')
    def put_profile(data: s.ProfileIn, request: Request, user=Depends(current), db: Session = Depends(get_db)):
        require_consent(request, data.consentCloud)
        profile = db.scalar(select(m.Profile).where(m.Profile.owner_id == user.id))
        for key in ['name', 'role', 'experience', 'language', 'companies', 'education']: setattr(profile, key, getattr(data, key))
        profile.resume_text, profile.consent_cloud = data.resumeText, data.consentCloud
        db.execute(delete(m.Skill).where(m.Skill.owner_id == user.id))
        db.execute(delete(m.Project).where(m.Project.owner_id == user.id))
        for skill in dict.fromkeys(x[:120] for x in data.skills): db.add(m.Skill(owner_id=user.id, name=skill))
        for project in data.projects: db.add(m.Project(owner_id=user.id, content=project))
        db.commit()
        return get_profile(user, db)

    @router.get('/documents')
    def documents(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), search: str = '', user=Depends(current), db: Session = Depends(get_db)):
        query = select(m.Document).where(m.Document.owner_id == user.id)
        if search: query = query.where(or_(m.Document.name.icontains(search, autoescape=True), m.Document.text.icontains(search, autoescape=True)))
        return [document_json(d) for d in db.scalars(query.order_by(m.Document.updated_at.desc()).limit(limit).offset(offset))]

    @router.post('/documents', status_code=201)
    def create_document(data: s.DocumentIn, request: Request, user=Depends(current), db: Session = Depends(get_db)):
        require_consent(request, data.consentCloud)
        record = m.Document(owner_id=user.id, name=data.name, type=data.type, text=data.text, consent_cloud=data.consentCloud)
        db.add(record)
        db.commit()
        return document_json(record)

    @router.post('/documents/extract')
    async def extract(request: Request, file: UploadFile = File(...), consentCloud: bool = Form(False), user=Depends(current)):
        require_consent(request, consentCloud)
        data = await file.read(10 * 1024 * 1024 + 1)
        if len(data) > 10 * 1024 * 1024: raise HTTPException(413, 'File exceeds 10 MiB')
        text = await asyncio.to_thread(extract_document, file.filename or 'document.txt', data)
        return {'name': (file.filename or 'document')[:200], 'text': text, 'stored': False, 'analysis': analyze_resume(text)}

    @router.get('/documents/{identifier}')
    def get_document(identifier: str, user=Depends(current), db: Session = Depends(get_db)): return document_json(owned(db, m.Document, identifier, user.id))

    @router.put('/documents/{identifier}')
    def put_document(identifier: str, data: s.DocumentIn, request: Request, user=Depends(current), db: Session = Depends(get_db)):
        require_consent(request, data.consentCloud)
        record = owned(db, m.Document, identifier, user.id)
        record.name, record.type, record.text, record.consent_cloud = data.name, data.type, data.text, data.consentCloud
        db.commit()
        return document_json(record)

    @router.delete('/documents/{identifier}')
    def delete_document(identifier: str, user=Depends(current), db: Session = Depends(get_db)):
        db.delete(owned(db, m.Document, identifier, user.id))
        db.commit()
        return {'deleted': True}

    @router.post('/resumes/analyze')
    def analyze(data: s.Analyze, request: Request, user=Depends(current)):
        require_consent(request, data.consentCloud)
        return analyze_resume(data.text, data.job_description)

    @router.get('/resumes')
    def resumes(user=Depends(current), db: Session = Depends(get_db)): return [resume_json(r) for r in db.scalars(select(m.Resume).where(m.Resume.owner_id == user.id).order_by(m.Resume.updated_at.desc()).limit(100))]

    @router.post('/resumes', status_code=201)
    def create_resume(data: s.ResumeIn, request: Request, user=Depends(current), db: Session = Depends(get_db)):
        require_consent(request, data.consentCloud)
        sub = active_subscription(db, user.id)
        count = db.scalar(select(func.count()).select_from(m.Resume).where(m.Resume.owner_id == user.id))
        if not sub and count >= 1: raise HTTPException(402, 'Free cloud accounts support one resume; use local copies or upgrade for multiple profiles')
        record = m.Resume(owner_id=user.id, name=data.name, text=data.text, sections=data.sections, consent_cloud=data.consentCloud)
        db.add(record)
        db.flush()
        db.add(m.ResumeVersion(owner_id=user.id, resume_id=record.id, version=1, text=data.text, sections=data.sections))
        db.commit()
        return resume_json(record)

    @router.get('/resumes/{identifier}')
    def get_resume(identifier: str, user=Depends(current), db: Session = Depends(get_db)): return resume_json(owned(db, m.Resume, identifier, user.id))

    @router.put('/resumes/{identifier}')
    def put_resume(identifier: str, data: s.ResumeIn, request: Request, user=Depends(current), db: Session = Depends(get_db)):
        require_consent(request, data.consentCloud)
        record = owned(db, m.Resume, identifier, user.id)
        version = db.scalar(select(func.max(m.ResumeVersion.version)).where(m.ResumeVersion.resume_id == identifier)) or 0
        record.name, record.text, record.sections, record.consent_cloud = data.name, data.text, data.sections, data.consentCloud
        db.add(m.ResumeVersion(owner_id=user.id, resume_id=record.id, version=version + 1, text=data.text, sections=data.sections))
        db.commit()
        return resume_json(record)

    @router.get('/resumes/{identifier}/versions')
    def versions(identifier: str, user=Depends(current), db: Session = Depends(get_db)):
        owned(db, m.Resume, identifier, user.id)
        return [{'id': v.id, 'version': v.version, 'text': v.text, 'sections': v.sections, 'createdAt': v.created_at} for v in db.scalars(select(m.ResumeVersion).where(m.ResumeVersion.resume_id == identifier, m.ResumeVersion.owner_id == user.id).order_by(m.ResumeVersion.version.desc()))]

    @router.get('/resumes/{identifier}/export')
    def export_resume(identifier: str, format: str = 'md', user=Depends(current), db: Session = Depends(get_db)):
        resume = owned(db, m.Resume, identifier, user.id)
        if format == 'md': return PlainTextResponse(resume.text, media_type='text/markdown', headers={'Content-Disposition': 'attachment; filename="resume.md"'})
        if format == 'docx':
            from docx import Document
            document, buffer = Document(), BytesIO()
            for line in resume.text.splitlines(): document.add_paragraph(line)
            document.save(buffer)
            return Response(buffer.getvalue(), media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document', headers={'Content-Disposition': 'attachment; filename="resume.docx"'})
        raise HTTPException(422, 'Supported formats: md, docx. Use browser print for PDF.')

    @router.delete('/resumes/{identifier}')
    def delete_resume(identifier: str, user=Depends(current), db: Session = Depends(get_db)):
        db.delete(owned(db, m.Resume, identifier, user.id))
        db.commit()
        return {'deleted': True}

    @router.get('/questions')
    def questions(request: Request, topic: str = '', company: str = '', role: str = '', difficulty: str = '', search: str = '', limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
        user = optional_user(request, db)
        query = select(m.Question).where(or_(m.Question.owner_id.is_(None), m.Question.owner_id == (user.id if user else '')))
        for key, value in [('topic', topic), ('company', company), ('role', role), ('difficulty', difficulty)]:
            if value: query = query.where(getattr(m.Question, key).icontains(value, autoescape=True))
        if search: query = query.where(m.Question.question.icontains(search, autoescape=True))
        return [public_question(db, q) for q in db.scalars(query.order_by(m.Question.created_at).limit(limit).offset(offset))]

    @router.post('/questions', status_code=201)
    def submit_question(data: s.QuestionIn, user=Depends(current), db: Session = Depends(get_db)):
        source = m.QuestionSource(title=data.source.title, url=data.source.url, confidence='original' if data.original else 'unverified')
        db.add(source)
        db.flush()
        q = m.Question(owner_id=user.id, company=data.company, role=data.role, topic=data.topic, difficulty=data.difficulty, question=data.question, expected_concepts=data.expectedConcepts, sample_answer=data.sampleAnswer, follow_ups=data.followUps, original=data.original, source_id=source.id)
        db.add(q)
        db.commit()
        return public_question(db, q)

    @router.post('/questions/{identifier}/report', status_code=201)
    def report_question(identifier: str, data: s.ReportIn, user=Depends(current), db: Session = Depends(get_db)):
        accessible_question(db, identifier, user.id)
        report = m.QuestionReport(owner_id=user.id, question_id=identifier, reason=data.reason)
        db.add(report)
        db.commit()
        return {'id': report.id, 'status': 'recorded for review', 'moderationAvailable': False}

    @router.get('/bookmarks')
    def bookmarks(user=Depends(current), db: Session = Depends(get_db)):
        return [public_question(db, accessible_question(db, b.question_id, user.id)) for b in db.scalars(select(m.Bookmark).where(m.Bookmark.owner_id == user.id))]

    @router.post('/questions/{identifier}/bookmark')
    def bookmark(identifier: str, user=Depends(current), db: Session = Depends(get_db)):
        accessible_question(db, identifier, user.id)
        if not db.scalar(select(m.Bookmark).where(m.Bookmark.owner_id == user.id, m.Bookmark.question_id == identifier)):
            db.add(m.Bookmark(owner_id=user.id, question_id=identifier))
            db.commit()
        return {'bookmarked': True}

    @router.delete('/questions/{identifier}/bookmark')
    def unbookmark(identifier: str, user=Depends(current), db: Session = Depends(get_db)):
        db.execute(delete(m.Bookmark).where(m.Bookmark.owner_id == user.id, m.Bookmark.question_id == identifier))
        db.commit()
        return {'bookmarked': False}

    @router.get('/companies')
    def companies(search: str = '', db: Session = Depends(get_db)):
        query = select(m.Company)
        if search: query = query.where(m.Company.name.icontains(search, autoescape=True))
        return [{'id': c.id, 'name': c.name, 'overview': c.overview, 'roles': [{'id': r.id, 'name': r.name, 'skills': r.skills} for r in db.scalars(select(m.Role).where(m.Role.company_id == c.id))], 'source': 'original illustrative preparation content'} for c in db.scalars(query.limit(100))]

    @router.get('/sessions')
    def sessions_list(search: str = '', archived: bool | None = None, mode: str = '', limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), user=Depends(current), db: Session = Depends(get_db)):
        query = select(m.InterviewSession).where(m.InterviewSession.owner_id == user.id)
        if search: query = query.where(m.InterviewSession.title.icontains(search, autoescape=True))
        if archived is not None: query = query.where(m.InterviewSession.archived == archived)
        if mode: query = query.where(m.InterviewSession.mode == mode)
        return [session_json(db, r) for r in db.scalars(query.order_by(m.InterviewSession.updated_at.desc()).limit(limit).offset(offset))]

    def new_session(data, request, user, db):
        require_consent(request, data.consentCloud)
        fields = data.model_dump(exclude={'notes', 'consentCloud'})
        record = m.InterviewSession(owner_id=user.id, consent_cloud=data.consentCloud, **fields)
        db.add(record)
        db.flush()
        db.add(m.SessionNote(owner_id=user.id, session_id=record.id, text=data.notes))
        db.commit()
        return record

    @router.post('/sessions', status_code=201)
    def create_session(data: s.SessionIn, request: Request, user=Depends(current), db: Session = Depends(get_db)): return session_json(db, new_session(data, request, user, db))

    @router.get('/sessions/{identifier}')
    def get_session(identifier: str, user=Depends(current), db: Session = Depends(get_db)): return session_json(db, owned(db, m.InterviewSession, identifier, user.id))

    @router.patch('/sessions/{identifier}')
    def patch_session(identifier: str, data: s.SessionPatch, user=Depends(current), db: Session = Depends(get_db)):
        record = owned(db, m.InterviewSession, identifier, user.id)
        fields = data.model_dump(exclude_unset=True)
        for key, value in fields.items():
            if value is None: raise HTTPException(422, 'Explicit null patch values are unsupported')
            if key == 'notes':
                note = db.scalar(select(m.SessionNote).where(m.SessionNote.session_id == record.id, m.SessionNote.owner_id == user.id))
                note.text = value
            else: setattr(record, key, value)
        record.updated_at = m.now()
        db.commit()
        return session_json(db, record)

    @router.delete('/sessions/{identifier}')
    def delete_session(identifier: str, user=Depends(current), db: Session = Depends(get_db)):
        db.delete(owned(db, m.InterviewSession, identifier, user.id))
        db.commit()
        return {'deleted': True}

    @router.post('/sessions/{identifier}/turns', status_code=201)
    def create_turn(identifier: str, data: s.TurnIn, request: Request, user=Depends(current), db: Session = Depends(get_db)):
        record = owned(db, m.InterviewSession, identifier, user.id)
        require_consent(request, data.consentCloud)
        turn = m.Turn(owner_id=user.id, session_id=record.id, speaker=data.speaker, text=data.text)
        db.add(turn)
        record.updated_at = m.now()
        db.commit()
        return {'id': turn.id, 'speaker': turn.speaker, 'text': turn.text, 'createdAt': turn.created_at}

    @router.post('/sessions/{identifier}/summary')
    def summarize(identifier: str, user=Depends(current), db: Session = Depends(get_db)):
        record = owned(db, m.InterviewSession, identifier, user.id)
        data = session_json(db, record)
        summary = {'method': 'extractive session outline', 'aiGenerated': False, 'title': record.title, 'questions': [t['text'] for t in data['turns'] if t['speaker'] == 'assistant' and '?' in t['text']], 'responseCount': sum(t['speaker'] == 'user' for t in data['turns']), 'transcriptSegments': sum(t['speaker'] == 'transcript' for t in data['turns']), 'actionItems': ['Revisit unanswered questions and add a specific example.'], 'weakAreas': list(dict.fromkeys(c for t in data['turns'] for c in (t['evaluation'] or {}).get('missingConcepts', [])))}
        note = db.scalar(select(m.SessionNote).where(m.SessionNote.session_id == record.id, m.SessionNote.owner_id == user.id))
        note.summary = summary
        db.commit()
        return summary

    @router.get('/sessions/{identifier}/export')
    def export_session(identifier: str, format: str = 'md', user=Depends(current), db: Session = Depends(get_db)):
        record = owned(db, m.InterviewSession, identifier, user.id)
        data = session_json(db, record)
        if format == 'json': return JSONResponse(data, headers={'Content-Disposition': 'attachment; filename="session.json"'})
        if format != 'md': raise HTTPException(422, 'Supported formats: md, json')
        text = '# ' + record.title + '\n\n' + record.mode + '\n\n' + '\n\n'.join('## ' + t['speaker'] + '\n\n' + t['text'] for t in data['turns']) + '\n\n## Notes\n\n' + data['notes']
        return PlainTextResponse(text, media_type='text/markdown', headers={'Content-Disposition': 'attachment; filename="session.md"'})

    @router.post('/mock-interviews', status_code=201)
    def create_mock(data: s.SessionIn, request: Request, user=Depends(current), db: Session = Depends(get_db)):
        record = new_session(data, request, user, db)
        questions = db.scalars(select(m.Question).where(m.Question.owner_id.is_(None), m.Question.topic == data.category).limit(8)).all()
        if not questions: questions = db.scalars(select(m.Question).where(m.Question.owner_id.is_(None)).limit(8)).all()
        mock = m.MockInterview(owner_id=user.id, session_id=record.id, question_ids=[q.id for q in questions], cursor=0)
        db.add(mock)
        if questions: db.add(m.Turn(owner_id=user.id, session_id=record.id, speaker='assistant', text=questions[0].question))
        db.commit()
        return {'id': mock.id, 'session': session_json(db, record), 'engine': 'original question bank with deterministic practice rubric', 'aiGenerated': False}

    @router.post('/mock-interviews/{identifier}/answer')
    def answer_mock(identifier: str, data: s.MockAnswer, request: Request, user=Depends(current), db: Session = Depends(get_db)):
        require_consent(request, data.consentCloud)
        mock = owned(db, m.MockInterview, identifier, user.id)
        record = owned(db, m.InterviewSession, mock.session_id, user.id)
        if mock.cursor >= len(mock.question_ids): raise HTTPException(409, 'Mock interview is complete')
        question = accessible_question(db, mock.question_ids[mock.cursor], user.id)
        evaluation = evaluate_answer(data.text, question.expected_concepts)
        db.add(m.Turn(owner_id=user.id, session_id=record.id, speaker='user', text=data.text, evaluation=evaluation))
        db.add(m.Progress(owner_id=user.id, topic=question.topic, score=evaluation['score'], evidence={'sessionId': record.id, 'method': evaluation['method']}))
        mock.cursor += 1
        next_question = None
        if mock.cursor < len(mock.question_ids):
            next_question = accessible_question(db, mock.question_ids[mock.cursor], user.id).question
            db.add(m.Turn(owner_id=user.id, session_id=record.id, speaker='assistant', text=next_question))
        else: record.status = 'completed'
        record.updated_at = m.now()
        db.commit()
        return {'evaluation': evaluation, 'nextQuestion': next_question, 'completed': record.status == 'completed', 'followUps': question.follow_ups, 'sampleAnswer': question.sample_answer, 'sessionId': record.id}

    @router.get('/roadmaps')
    def roadmaps(user=Depends(current), db: Session = Depends(get_db)): return [roadmap_json(db, r) for r in db.scalars(select(m.Roadmap).where(m.Roadmap.owner_id == user.id).limit(100))]

    @router.post('/roadmaps', status_code=201)
    def create_roadmap(data: s.RoadmapIn, user=Depends(current), db: Session = Depends(get_db)):
        roadmap = m.Roadmap(owner_id=user.id, title=data.title)
        db.add(roadmap)
        db.flush()
        for item in data.items: db.add(m.RoadmapItem(roadmap_id=roadmap.id, topic=item.topic, due_date=item.dueDate, completed=item.completed))
        db.commit()
        return roadmap_json(db, roadmap)

    @router.patch('/roadmaps/{identifier}')
    def patch_roadmap(identifier: str, data: s.RoadmapIn, user=Depends(current), db: Session = Depends(get_db)):
        roadmap = owned(db, m.Roadmap, identifier, user.id)
        roadmap.title = data.title
        existing = {i.id: i for i in db.scalars(select(m.RoadmapItem).where(m.RoadmapItem.roadmap_id == roadmap.id))}
        retained = set()
        for item in data.items:
            if item.id:
                if item.id not in existing: raise HTTPException(404, 'Roadmap item does not belong to this roadmap')
                current_item = existing[item.id]
                current_item.topic, current_item.due_date, current_item.completed = item.topic, item.dueDate, item.completed
                retained.add(item.id)
            else: db.add(m.RoadmapItem(roadmap_id=roadmap.id, topic=item.topic, due_date=item.dueDate, completed=item.completed))
        for item_id, current_item in existing.items():
            if item_id not in retained: db.delete(current_item)
        db.commit()
        return roadmap_json(db, roadmap)

    @router.delete('/roadmaps/{identifier}')
    def delete_roadmap(identifier: str, user=Depends(current), db: Session = Depends(get_db)):
        db.delete(owned(db, m.Roadmap, identifier, user.id))
        db.commit()
        return {'deleted': True}

    @router.get('/reports')
    def reports(user=Depends(current), db: Session = Depends(get_db)):
        sub = active_subscription(db, user.id)
        progress = db.scalars(select(m.Progress).where(m.Progress.owner_id == user.id).order_by(m.Progress.created_at.desc()).limit(500)).all()
        sessions_count = db.scalar(select(func.count()).select_from(m.InterviewSession).where(m.InterviewSession.owner_id == user.id))
        roadmaps = db.scalars(select(m.Roadmap).where(m.Roadmap.owner_id == user.id)).all()
        items = db.scalars(select(m.RoadmapItem).where(m.RoadmapItem.roadmap_id.in_([r.id for r in roadmaps]))).all()
        average = round(sum(p.score for p in progress) / len(progress), 1) if progress else None
        analytics = None
        if sub and sub.plan == 'pro':
            by_topic = {}
            for p in progress: by_topic.setdefault(p.topic, []).append(p.score)
            analytics = {'topics': [{'topic': topic, 'attempts': len(scores), 'averageScore': round(sum(scores) / len(scores), 1), 'latestScore': scores[0]} for topic, scores in by_topic.items()], 'completedSessions': db.scalar(select(func.count()).select_from(m.InterviewSession).where(m.InterviewSession.owner_id == user.id, m.InterviewSession.status == 'completed')), 'basis': 'Actual stored deterministic practice scores; does not establish technical correctness'}
        return {'sessions': sessions_count, 'practiceAnswers': len(progress), 'averageRubricScore': average, 'readiness': {'score': average, 'basis': 'Mean deterministic practice-rubric score; not a hiring outcome prediction'}, 'roadmapCompletion': {'completed': sum(i.completed for i in items), 'total': len(items)}, 'detailedAvailable': bool(sub), 'weakTopics': list(dict.fromkeys(p.topic for p in progress if p.score < 60)) if sub else [], 'progress': [{'id': p.id, 'topic': p.topic, 'score': p.score, 'evidence': p.evidence, 'createdAt': p.created_at} for p in progress] if sub else [], 'analytics': analytics}

    @router.get('/providers')
    def providers(): return app.state.providers.status()

    @router.get('/providers/{provider}/models')
    async def models(provider: str, user=Depends(current)): return {'provider': provider, 'models': await app.state.providers.models(provider)}

    def generation_gate(data, request, user, db):
        app.state.providers.ensure(data.provider)
        app.state.providers.payload(data)
        if data.provider != 'ollama':
            if not data.consentCloud: raise HTTPException(422, 'consentCloud=true is required for remote AI processing')
            quota(db, user)
        else: require_consent(request, data.consentCloud)
        app.state.limiter.check(('generate', user.id), 10)

    @router.post('/ai/generate')
    async def generate(data: s.Generate, request: Request, user=Depends(current), db: Session = Depends(get_db)):
        generation_gate(data, request, user, db)
        start = time.perf_counter()
        result = await app.state.providers.generate(data)
        db.add(m.AIResponse(owner_id=user.id, provider=data.provider, model=data.model, tokens=result['estimatedOutputTokens'], latency_ms=round((time.perf_counter() - start) * 1000)))
        db.commit()
        return result

    @router.post('/ai/stream')
    async def stream(data: s.Generate, request: Request, user=Depends(current), db: Session = Depends(get_db)):
        generation_gate(data, request, user, db)
        async def events():
            async for event in app.state.providers.stream(data, request.is_disconnected):
                yield 'data: ' + json.dumps(event) + '\n\n'
        return StreamingResponse(events(), media_type='text/event-stream', headers={'X-Accel-Buffering': 'no'})

    @router.post('/speech/transcribe')
    async def transcribe(request: Request, file: UploadFile = File(...), consent: bool = Form(False), user=Depends(current), db: Session = Depends(get_db)):
        if not consent: raise HTTPException(422, 'Explicit consent=true is required to send audio to remote transcription')
        if file.content_type not in {'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg', 'audio/mp4', 'video/webm'}: raise HTTPException(415, 'Unsupported audio type')
        data = await file.read(10 * 1024 * 1024 + 1)
        if len(data) > 10 * 1024 * 1024: raise HTTPException(413, 'Audio exceeds 10 MiB; send a shorter segment')
        app.state.providers.ensure('openai')
        quota(db, user, 'transcribe')
        return await app.state.providers.transcribe('segment.' + ('webm' if 'webm' in file.content_type else 'wav'), data, file.content_type)

    @router.get('/billing/plans')
    def billing_plans(): return {'plans': plans(), 'amountUnit': 'minor currency units', 'interval': 'month', 'note': 'Local AI and direct BYOK do not consume server inference. Paid server inference has bounded monthly quotas and requires provider configuration.'}

    @router.post('/headshots')
    async def headshot(request: Request, file: UploadFile = File(...), consent: bool = Form(False), ownPhoto: bool = Form(False), style: str = Form('Professional'), background: str = Form('Neutral'), user=Depends(current), db: Session = Depends(get_db)):
        if not consent or not ownPhoto: raise HTTPException(422, 'Confirm ownPhoto=true and consent=true before uploading your photograph for remote image generation')
        if style not in {'Professional', 'Natural', 'Studio'} or background not in {'Neutral', 'Light', 'Office'}: raise HTTPException(422, 'Choose a supported style and background')
        if file.content_type not in {'image/png', 'image/jpeg', 'image/webp'}: raise HTTPException(415, 'Upload a PNG, JPEG or WebP photograph')
        data = await file.read(5 * 1024 * 1024 + 1)
        if len(data) > 5 * 1024 * 1024: raise HTTPException(413, 'Photograph exceeds 5 MiB')
        valid = (file.content_type == 'image/png' and data.startswith(b'\x89PNG\r\n\x1a\n')) or (file.content_type == 'image/jpeg' and data.startswith(b'\xff\xd8\xff')) or (file.content_type == 'image/webp' and data.startswith(b'RIFF') and data[8:12] == b'WEBP')
        if not valid: raise HTTPException(422, 'Photograph contents do not match the declared image type')
        app.state.providers.ensure('openai')
        quota(db, user, 'headshot')
        return await app.state.providers.headshot(data, file.content_type, style, background)

    @router.get('/billing/status')
    def billing_status(user=Depends(current), db: Session = Depends(get_db)):
        sub = active_subscription(db, user.id)
        return {'plan': sub.plan if sub else 'free', 'status': sub.status if sub else 'free', 'currentEnd': sub.current_end if sub else None, 'pendingPlan': sub.pending_plan if sub else None, 'graceUntil': (datetime.fromisoformat(sub.current_end) + timedelta(hours=72)).isoformat() if sub and sub.status == 'pending' and sub.current_end else None, 'checkoutConfigured': app.state.billing.configured(), 'entitlements': {'multipleResumes': bool(sub), 'cloudSync': bool(sub), 'advancedAnalytics': bool(sub and sub.plan == 'pro'), 'serverInferenceMonthlyLimit': (50 if sub.plan == 'pro' else 20) if sub else 0}}

    @router.post('/billing/checkout')
    async def checkout(data: s.Checkout, user=Depends(current), db: Session = Depends(get_db)): return await app.state.billing.checkout(db, user.id, data.plan, data.currency)

    @router.post('/billing/verify')
    async def verify(data: s.Verify, user=Depends(current), db: Session = Depends(get_db)): return await app.state.billing.verify(db, user.id, data)

    @router.post('/billing/change-plan')
    async def change_plan(data: s.Checkout, user=Depends(current), db: Session = Depends(get_db)): return await app.state.billing.change_plan(db, user.id, data.plan, data.currency)

    @router.post('/billing/webhook')
    async def webhook(request: Request, db: Session = Depends(get_db)):
        ready()
        body = await request.body()
        app.state.billing.signature(body, request.headers.get('x-razorpay-signature', ''), settings.webhook_secret)
        try: payload = json.loads(body)
        except ValueError: raise HTTPException(400, 'Invalid webhook JSON')
        if not isinstance(payload, dict): raise HTTPException(400, 'Invalid webhook payload')
        body_hash = hashlib.sha256(body).hexdigest()
        event_id = request.headers.get('x-razorpay-event-id', body_hash)[:128]
        event_type = str(payload.get('event', 'unknown'))[:80]
        previous = db.scalar(select(m.PaymentEvent).where(m.PaymentEvent.provider_event_id == event_id))
        if previous:
            if previous.body_hash != body_hash: raise HTTPException(409, 'Event identifier already used for a different payload')
            return {'received': True, 'duplicate': True}
        nested = payload.get('payload', {})
        if not isinstance(nested, dict): raise HTTPException(400, 'Invalid webhook entities')
        def webhook_entity(kind):
            wrapper = nested.get(kind, {})
            if not isinstance(wrapper, dict) or not isinstance(wrapper.get('entity', {}), dict): raise HTTPException(400, 'Invalid webhook entity')
            return wrapper.get('entity', {})
        entity, payment = webhook_entity('subscription'), webhook_entity('payment')
        sub = db.scalar(select(m.Subscription).where(m.Subscription.provider_id == entity.get('id', '')))
        try:
            event_at = int(payload.get('created_at', 0))
            if event_at < 0 or event_at > int(time.time()) + 300: raise ValueError()
        except (TypeError, ValueError): raise HTTPException(400, 'Invalid webhook timestamp')
        db.add(m.PaymentEvent(provider_event_id=event_id, body_hash=body_hash, event_type=event_type))
        if sub and event_at >= sub.last_event_at:
            current_end = entity.get('current_end')
            pending_plan_id = os.getenv(f'RAZORPAY_PLAN_{(sub.pending_plan or "").upper()}_{sub.currency}', '')
            if sub.pending_plan and entity.get('plan_id') == pending_plan_id and payment.get('amount') == sub.pending_amount and payment.get('status') == 'captured' and payment.get('currency') == sub.currency:
                sub.plan, sub.amount = sub.pending_plan, sub.pending_amount
                sub.pending_plan, sub.pending_amount = None, None
            if event_type in {'subscription.activated', 'subscription.charged', 'subscription.resumed'}:
                # Only trusted provider webhook plus expected plan funds can activate access.
                valid_funds = payment.get('status') == 'captured' and payment.get('amount') == sub.amount and payment.get('currency') == sub.currency
                if event_type == 'subscription.charged' and valid_funds and current_end:
                    sub.status = 'active'
                    sub.current_end = datetime.fromtimestamp(current_end, timezone.utc).isoformat()
                elif event_type != 'subscription.charged' and entity.get('status') == 'active' and current_end:
                    # Confirm provider state independently for activation/resume events.
                    remote = await app.state.billing.request('GET', '/subscriptions/' + sub.provider_id)
                    if remote.get('status') == 'active' and remote.get('paid_count', 0) > 0:
                        sub.status = 'active'
                        sub.current_end = datetime.fromtimestamp(remote['current_end'], timezone.utc).isoformat()
            elif event_type in {'subscription.cancelled', 'subscription.completed', 'subscription.halted', 'subscription.paused'}:
                sub.status = event_type.split('.')[1]
            elif event_type == 'subscription.pending': sub.status = 'pending'  # Grace is not unlimited paid access.
            sub.last_event_at = event_at
            if payment.get('id') and payment.get('amount') == sub.amount and payment.get('currency') == sub.currency:
                app.state.billing.record_payment(db, sub, payment)
        elif event_type in {'refund.created', 'refund.processed', 'refund.failed'}:
            refund = webhook_entity('refund')
            recorded = db.scalar(select(m.Payment).where(m.Payment.provider_id == refund.get('payment_id', '')))
            if recorded:
                recorded.status = 'refund_' + event_type.split('.')[1]
                if event_type == 'refund.processed' and refund.get('amount', 0) >= recorded.amount:
                    refunded_subscription = db.get(m.Subscription, recorded.subscription_id)
                    refunded_subscription.status = 'refunded'
        try: db.commit()
        except IntegrityError:
            db.rollback()
            return {'received': True, 'duplicate': True}
        return {'received': True, 'duplicate': False}

    @router.post('/billing/cancel')
    async def cancel(user=Depends(current), db: Session = Depends(get_db)):
        sub = db.scalar(select(m.Subscription).where(m.Subscription.owner_id == user.id, m.Subscription.status.in_(['created', 'authenticated', 'active', 'pending', 'refunded', 'halted', 'paused'])).order_by(m.Subscription.created_at.desc()))
        if not sub: raise HTTPException(404, 'No cancellable subscription')
        at_end = sub.status == 'active'
        await app.state.billing.request('POST', '/subscriptions/' + sub.provider_id + '/cancel', {'cancel_at_cycle_end': int(at_end)})
        sub.status = 'cancel_at_period_end' if at_end else 'cancelled'
        db.commit()
        return {'cancelled': True, 'status': sub.status, 'accessUntil': sub.current_end if at_end else None}

    @router.get('/billing/history')
    def history(user=Depends(current), db: Session = Depends(get_db)):
        return [{'id': p.id, 'paymentId': p.provider_id, 'subscriptionId': p.subscription_id, 'amount': p.amount, 'currency': p.currency, 'status': p.status, 'invoiceId': p.invoice_id, 'createdAt': p.created_at} for p in db.scalars(select(m.Payment).where(m.Payment.owner_id == user.id).order_by(m.Payment.created_at.desc()).limit(100))]

    @router.post('/coding/run')
    async def run_code(data: s.CodeRun, user=Depends(current)):
        if not settings.runner_url or not settings.runner_token:
            raise HTTPException(503, 'Secure isolated runner is not configured. Arbitrary code is never executed on the API server. Use the browser sandbox or configure ISOLATED_RUNNER_URL and ISOLATED_RUNNER_TOKEN.')
        if not settings.runner_url.startswith('https://'): raise HTTPException(503, 'Isolated runner requires HTTPS')
        app.state.limiter.check(('code-run', user.id), 10)
        async with httpx.AsyncClient(timeout=15, follow_redirects=False, transport=app.state.runner_transport) as client:
            try:
                result = await client.post(settings.runner_url, json={**data.model_dump(), 'limits': {'timeMs': 2000, 'memoryMb': 128, 'network': False, 'filesystem': 'ephemeral', 'processes': 16}}, headers={'Authorization': 'Bearer ' + settings.runner_token})
                result.raise_for_status()
                result_data = result.json()
                if not isinstance(result_data, dict) or result_data.get('isolated') is not True or result_data.get('limitsEnforced') is not True or not isinstance(result_data.get('tests', []), list):
                    raise HTTPException(502, 'Runner did not confirm isolation and resource limits')
                def display(value): return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
                tests = [{'input': display(test.get('input', '')), 'expected': display(test.get('expected', '')), 'actual': display(test.get('actual', '')), 'passed': test.get('passed') is True} for test in result_data.get('tests', [])[:50] if isinstance(test, dict)]
                # Only explicit isolated-runner contract output is exposed.
                return {'executed': True, 'tested': bool(tests), 'execution': 'configured isolated service', 'stdout': str(result_data.get('stdout', ''))[:100000], 'stderr': str(result_data.get('stderr', ''))[:100000], 'exitCode': result_data.get('exitCode'), 'timedOut': bool(result_data.get('timedOut', False)), 'tests': tests}
            except (httpx.HTTPError, ValueError): raise HTTPException(502, 'Isolated runner failed or timed out')

    @router.post('/context/optimize')
    def context_optimize(data: s.ContextIn, request: Request, user=Depends(current)):
        require_consent(request, data.consentCloud)
        result = optimize(data.query, [d.model_dump() for d in data.documents], data.budget)
        app.state.context_stats['requests'] += 1
        app.state.context_stats['tokensBefore'] += result['tokensBefore']
        app.state.context_stats['tokensAfter'] += result['tokensAfter']
        return result

    @router.get('/context/stats')
    def context_stats(user=Depends(current)): return {**app.state.context_stats, 'scope': 'process-wide anonymous aggregate, reset on restart', 'contentRetained': False}

    @router.get('/observability/summary')
    def observability(user=Depends(current), db: Session = Depends(get_db)):
        # Global latency aggregates expose no per-user identities or request bodies.
        rows = db.execute(select(m.Metric.route, func.count(), func.avg(m.Metric.latency_ms), func.sum((m.Metric.status >= 400).cast(__import__('sqlalchemy').Integer))).group_by(m.Metric.route)).all()
        return {'format': 'LogLens-compatible structured JSON events', 'retentionDays': 7, 'privateContentLogged': False, 'routes': [{'route': r[0], 'requests': r[1], 'averageLatencyMs': round(r[2], 2), 'errors': r[3]} for r in rows]}

    @router.get('/users/export')
    def export_user(user=Depends(current), db: Session = Depends(get_db)):
        return {'profile': get_profile(user, db), 'documents': [document_json(d) for d in db.scalars(select(m.Document).where(m.Document.owner_id == user.id))], 'resumes': [{**resume_json(r), 'versions': versions(r.id, user, db)} for r in db.scalars(select(m.Resume).where(m.Resume.owner_id == user.id))], 'sessions': [session_json(db, r) for r in db.scalars(select(m.InterviewSession).where(m.InterviewSession.owner_id == user.id))], 'roadmaps': [roadmap_json(db, r) for r in db.scalars(select(m.Roadmap).where(m.Roadmap.owner_id == user.id))], 'questions': [public_question(db, q) for q in db.scalars(select(m.Question).where(m.Question.owner_id == user.id))], 'bookmarks': bookmarks(user, db), 'progress': [{'id': p.id, 'topic': p.topic, 'score': p.score, 'evidence': p.evidence, 'createdAt': p.created_at} for p in db.scalars(select(m.Progress).where(m.Progress.owner_id == user.id))], 'reports': reports(user, db), 'billing': history(user, db)}

    @router.delete('/users/me')
    def delete_user(user=Depends(current), db: Session = Depends(get_db)):
        if active_subscription(db, user.id) or db.scalar(select(m.Subscription.id).where(m.Subscription.owner_id == user.id, m.Subscription.status.in_(['created', 'authenticated', 'active', 'pending', 'refunded', 'halted', 'paused'])).limit(1)):
            raise HTTPException(409, 'Cancel subscriptions and wait for the paid period to end before deleting the account')
        # Retain no account data locally; production billing record retention policy must be set by operator.
        for payment in db.scalars(select(m.Payment).where(m.Payment.owner_id == user.id)): db.delete(payment)
        contributed = db.scalars(select(m.Question).where(m.Question.owner_id == user.id)).all()
        source_ids = [q.source_id for q in contributed]
        for question in contributed: db.delete(question)
        db.flush()
        if source_ids: db.execute(delete(m.QuestionSource).where(m.QuestionSource.id.in_(source_ids)))
        db.flush()
        db.delete(user)
        db.commit()
        return {'deleted': True, 'note': 'Provider-side subscriptions must be cancelled before account deletion.'}

    app.include_router(router)
    return app


app = create_app()
