"""Regression checks for OAuth trust boundaries and browser session rotation."""
import base64
import hashlib
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app import models as m
from app.config import Settings
from app.database import make_engine, migrate
from app.main import create_app
from app.security import consume_oauth_state, digest, future
from .conftest import signup

API = '/api/v1'
VALID_INFO = {'sub': 'stable-google-subject', 'email': 'google@example.com', 'email_verified': True, 'name': 'OAuth Example'}


def configure_google(app, info=None, token_status=200):
    app.state.settings.google_id = 'test-client-id'
    app.state.settings.google_secret = 'test-client-secret'
    observed = []

    def handler(request):
        observed.append(request)
        if request.url.host == 'oauth2.googleapis.com':
            return httpx.Response(token_status, json={'access_token': 'test-access-token'})
        return httpx.Response(200, json=VALID_INFO if info is None else info)

    app.state.oauth_transport = httpx.MockTransport(handler)
    return observed


def start(client):
    response = client.get(API + '/auth/google/start?format=json')
    assert response.status_code == 200, response.text
    return parse_qs(httpx.URL(response.json()['url']).query.decode())


def callback(client, state):
    return client.get(API + '/auth/google/callback', params={'state': state, 'code': 'test-code'}, follow_redirects=False)


def test_google_browser_bound_state_and_pkce(client, app):
    observed = configure_google(app)
    query = start(client)
    state = query['state'][0]
    with TestClient(app) as other:
        assert callback(other, state).status_code == 400
    assert not observed  # A copied authorization URL cannot sign another browser in.
    assert callback(client, state).status_code == 302
    exchange = parse_qs(observed[0].content.decode())
    verifier = exchange['code_verifier'][0]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    assert query['code_challenge'] == [challenge]
    assert query['code_challenge_method'] == ['S256']
    assert 'code_verifier' not in query


@pytest.mark.parametrize('info', [
    {**VALID_INFO, 'email_verified': False},
    {**VALID_INFO, 'email_verified': 'false'},
    {**VALID_INFO, 'email_verified': 1},
    {**VALID_INFO, 'sub': ''},
    {**VALID_INFO, 'sub': ['not-a-subject']},
    {**VALID_INFO, 'email': 'invalid'},
    {**VALID_INFO, 'email': ['not-an-email']},
    [],
])
def test_google_rejects_unverified_or_malformed_claims(client, app, info):
    configure_google(app, info)
    state = start(client)['state'][0]
    assert callback(client, state).status_code == 400
    assert client.get(API + '/auth/me').status_code == 401
    with app.state.sessions() as db:
        assert db.scalar(select(m.User.id)) is None
    # Invalid upstream claims still consume the browser-bound state.
    assert callback(client, state).status_code == 400


def test_google_does_not_link_password_account_by_email(authenticated, app):
    original = authenticated.get(API + '/auth/me').json()
    configure_google(app, {**VALID_INFO, 'email': original['email']})
    state = start(authenticated)['state'][0]
    assert callback(authenticated, state).status_code == 409
    assert authenticated.get(API + '/auth/me').json()['id'] == original['id']
    with app.state.sessions() as db:
        assert db.get(m.User, original['id']).google_sub is None


def test_google_subject_identity_survives_email_change(client, app):
    configure_google(app)
    assert callback(client, start(client)['state'][0]).status_code == 302
    original = client.get(API + '/auth/me').json()
    configure_google(app, {**VALID_INFO, 'email': 'changed@example.com'})
    assert callback(client, start(client)['state'][0]).status_code == 302
    assert client.get(API + '/auth/me').json()['id'] == original['id']


def test_google_failure_and_missing_code_consume_state(client, app):
    observed = configure_google(app, token_status=400)
    state = start(client)['state'][0]
    assert callback(client, state).status_code == 502
    assert callback(client, state).status_code == 400
    assert len(observed) == 1
    state = start(client)['state'][0]
    assert client.get(API + '/auth/google/callback', params={'state': state, 'error': 'access_denied'}).status_code == 400
    assert callback(client, state).status_code == 400


@pytest.mark.parametrize('method', ['register', 'login', 'google'])
def test_successful_auth_replaces_and_revokes_old_session(client, app, method):
    signup(client)
    old_cookie = client.cookies.get('oi_session')
    old_csrf = client.cookies.get('oi_csrf')
    if method == 'register':
        signup(client, email='second@example.com')
    elif method == 'login':
        assert client.post(API + '/auth/login', json={'email': 'candidate@example.com', 'password': 'a-test-password-123'}).status_code == 200
    else:
        configure_google(app)
        assert callback(client, start(client)['state'][0]).status_code == 302
    assert client.cookies.get('oi_session') != old_cookie
    assert client.cookies.get('oi_csrf') != old_csrf
    with TestClient(app) as stale:
        stale.cookies.set('oi_session', old_cookie)
        assert stale.get(API + '/auth/me').status_code == 401
    with app.state.sessions() as db:
        assert db.scalar(select(m.Device).where(m.Device.token_hash == digest(old_cookie))).revoked


def test_expired_state_cannot_reach_google(client, app):
    observed = configure_google(app)
    state = start(client)['state'][0]
    with app.state.sessions() as db:
        db.scalar(select(m.OAuthState)).expires_at = future(minutes=-1)
        db.commit()
    assert callback(client, state).status_code == 400
    assert not observed


def test_oauth_state_atomic_across_database_connections(tmp_path):
    engine = make_engine('sqlite:///' + str(tmp_path / 'oauth-concurrency.db'))
    migrate(engine)
    sessions = sessionmaker(engine)
    state = 'test-single-use-state'
    with sessions() as db:
        db.add(m.OAuthState(state_hash=digest(state), verifier='test-verifier', expires_at=future(minutes=10)))
        db.commit()
    barrier = Barrier(2)

    def claim():
        with sessions() as db:
            barrier.wait(timeout=10)
            return consume_oauth_state(db, state)

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: claim(), range(2)))
    assert results.count('test-verifier') == 1
    assert results.count(None) == 1
    engine.dispose()


def test_cloud_rejects_insecure_cookies_and_ephemeral_account_storage(monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    with pytest.raises(ValueError, match='COOKIE_SECURE'):
        Settings(mode='cloud', secure_cookies=False).validate()
    monkeypatch.setenv('DATABASE_URL', 'sqlite:///:memory:')
    with pytest.raises(ValueError, match='PostgreSQL'):
        Settings(mode='cloud', secure_cookies=True, database_url='sqlite:///:memory:').validate()


def test_oauth_start_rate_limit_is_separate_from_public_catalog(client, app):
    configure_google(app)
    for _ in range(20):
        assert client.get(API + '/auth/google/start?format=json').status_code == 200
    response = client.get(API + '/auth/google/start?format=json')
    assert response.status_code == 429
    assert int(response.headers['retry-after']) > 0
    assert client.get(API + '/questions').status_code == 200


def test_csrf_tokens_are_bound_to_session_and_origin(authenticated, app):
    original_token = authenticated.headers['x-csrf-token']
    with TestClient(app) as other:
        signup(other, 'other@example.com')
        other_token = other.headers['x-csrf-token']
    payload = {'name': 'Example', 'text': 'Synthetic test document'}
    assert authenticated.post(API + '/documents', json=payload, headers={'x-csrf-token': other_token}).status_code == 403
    assert authenticated.post(API + '/documents', json=payload, headers={'origin': 'https://hostile.example'}).status_code == 403
    assert authenticated.post(API + '/documents', json=payload, headers={'sec-fetch-site': 'cross-site'}).status_code == 403
    assert authenticated.headers['x-csrf-token'] == original_token
    assert authenticated.get(API + '/documents').json() == []


def test_google_only_account_cannot_create_password_by_email_recovery(client, app, monkeypatch):
    configure_google(app)
    assert callback(client, start(client)['state'][0]).status_code == 302
    monkeypatch.setenv('SMTP_HOST', 'smtp.invalid.example')
    response = client.post(API + '/auth/recovery/request', json={'email': VALID_INFO['email']})
    assert response.status_code == 200
    with app.state.sessions() as db:
        assert db.scalar(select(m.RecoveryToken.id)) is None
        assert db.scalar(select(m.User)).password_hash is None


def test_google_stays_disabled_without_durable_cloud_storage(monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    settings = Settings(mode='cloud', secure_cookies=True, google_id='test-id', google_secret='test-secret')
    app = create_app(settings)
    with TestClient(app, base_url='https://testserver') as client:
        assert client.get(API + '/capabilities').json()['googleOAuth'] is False
        assert client.get(API + '/auth/google/start?format=json').status_code == 503
        assert client.get(API + '/auth/google/callback?state=example&code=example').status_code == 503
        assert client.post(API + '/auth/login', json={'email': 'nobody@example.com', 'password': 'a-test-password-123'}).status_code == 503
