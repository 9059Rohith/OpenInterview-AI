import asyncio
import base64
import hashlib
import hmac
import io
import json
import time
from datetime import datetime, timezone, timedelta
from urllib.parse import parse_qs
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from app import models as m
from app.billing import Razorpay
from app.providers import ProviderGateway
from .conftest import signup

API = '/api/v1'


def paid_plan(app, client, plan='plus', status='active', end=None):
    owner = client.get(API + '/auth/me').json()['id']
    with app.state.sessions() as db:
        sub = m.Subscription(owner_id=owner, provider_id='sub_test123', plan=plan, currency='INR', amount=9900 if plan == 'plus' else 19900, status=status, current_end=end or (datetime.now(timezone.utc) + timedelta(days=30)).isoformat())
        db.add(sub)
        db.commit()
        return sub.id


def configured_billing(app, monkeypatch, handler):
    settings = app.state.settings
    settings.razorpay_id = 'rzp_test_public'
    settings.razorpay_secret = 'test-only-payment-secret'
    settings.webhook_secret = 'test-only-webhook-secret'
    monkeypatch.setenv('RAZORPAY_PLAN_PLUS_INR', 'plan_plus123')
    monkeypatch.setenv('RAZORPAY_PLAN_PRO_INR', 'plan_pro123')
    app.state.billing = Razorpay(settings, transport=httpx.MockTransport(handler))
    return settings


def signed_webhook(client, settings, payload, event_id='event-test-1'):
    content = json.dumps(payload).encode()
    signature = hmac.new(settings.webhook_secret.encode(), content, hashlib.sha256).hexdigest()
    return client.post(API + '/billing/webhook', content=content, headers={'content-type': 'application/json', 'x-razorpay-signature': signature, 'x-razorpay-event-id': event_id})


def test_billing_checkout_verify_hmac_history_cancellation(authenticated, app, monkeypatch):
    end = int(time.time()) + 30 * 86400
    calls = []
    def handler(request):
        assert request.headers['authorization'].startswith('Basic ')
        path = request.url.path
        calls.append((request.method, path))
        if path == '/v1/plans/plan_plus123': return httpx.Response(200, json={'period': 'monthly', 'interval': 1, 'item': {'amount': 9900, 'currency': 'INR'}})
        if path == '/v1/subscriptions' and request.method == 'POST': return httpx.Response(200, json={'id': 'sub_test123', 'status': 'created'})
        if path == '/v1/subscriptions/sub_test123' and request.method == 'GET': return httpx.Response(200, json={'id': 'sub_test123', 'status': 'active', 'current_end': end})
        if path == '/v1/payments/pay_test123': return httpx.Response(200, json={'id': 'pay_test123', 'status': 'captured', 'amount': 9900, 'currency': 'INR', 'invoice_id': 'inv_test123'})
        if path == '/v1/invoices/inv_test123': return httpx.Response(200, json={'subscription_id': 'sub_test123', 'payment_id': 'pay_test123'})
        if path.endswith('/cancel'):
            assert json.loads(request.content)['cancel_at_cycle_end'] == 1
            return httpx.Response(200, json={'status': 'active', 'cancel_at_cycle_end': True})
        raise AssertionError(path)
    settings = configured_billing(app, monkeypatch, handler)
    checkout = authenticated.post(API + '/billing/checkout', json={'plan': 'plus'})
    assert checkout.status_code == 200, checkout.text
    assert checkout.json()['amount'] == 9900
    assert authenticated.post(API + '/billing/checkout', json={'plan': 'plus'}).json()['subscriptionId'] == 'sub_test123'
    assert calls.count(('POST', '/v1/subscriptions')) == 1
    data = {'razorpay_payment_id': 'pay_test123', 'razorpay_subscription_id': 'sub_test123', 'razorpay_signature': '0' * 64}
    assert authenticated.post(API + '/billing/verify', json=data).status_code == 400
    data['razorpay_signature'] = hmac.new(settings.razorpay_secret.encode(), b'pay_test123|sub_test123', hashlib.sha256).hexdigest()
    verified = authenticated.post(API + '/billing/verify', json=data)
    assert verified.status_code == 200, verified.text
    assert verified.json()['verified']
    assert authenticated.post(API + '/billing/verify', json=data).status_code == 200
    assert len(authenticated.get(API + '/billing/history').json()) == 1
    assert authenticated.get(API + '/billing/status').json()['plan'] == 'plus'
    assert authenticated.delete(API + '/users/me').status_code == 409
    assert authenticated.post(API + '/billing/cancel').json()['status'] == 'cancel_at_period_end'
    assert authenticated.get(API + '/billing/status').json()['plan'] == 'plus'


def test_billing_captured_amount_and_invoice_membership_required(authenticated, app, monkeypatch):
    paid_plan(app, authenticated, status='created')
    invalid_invoice = {'wrong': False}
    def handler(request):
        path = request.url.path
        if '/subscriptions/' in path: return httpx.Response(200, json={'status': 'active', 'current_end': int(time.time()) + 86400})
        if '/payments/' in path: return httpx.Response(200, json={'id': 'pay_test123', 'status': 'captured', 'amount': 9900 if invalid_invoice['wrong'] else 1, 'currency': 'INR', 'invoice_id': 'inv_test'})
        if '/invoices/' in path: return httpx.Response(200, json={'subscription_id': 'sub_someoneelse', 'payment_id': 'pay_test123'})
        raise AssertionError(path)
    settings = configured_billing(app, monkeypatch, handler)
    signature = hmac.new(settings.razorpay_secret.encode(), b'pay_test123|sub_test123', hashlib.sha256).hexdigest()
    data = {'razorpay_payment_id': 'pay_test123', 'razorpay_subscription_id': 'sub_test123', 'razorpay_signature': signature}
    assert authenticated.post(API + '/billing/verify', json=data).status_code == 409
    invalid_invoice['wrong'] = True
    assert authenticated.post(API + '/billing/verify', json=data).status_code == 400
    assert authenticated.get(API + '/billing/status').json()['plan'] == 'free'


def test_webhook_idempotency_out_of_order_grace_failed_and_refund(authenticated, app, monkeypatch):
    paid_plan(app, authenticated, status='created')
    settings = configured_billing(app, monkeypatch, lambda request: httpx.Response(200, json={}))
    now = int(time.time())
    end = now + 86400
    def payload(event, stamp=now, payment_status='captured'):
        return {'event': event, 'created_at': stamp, 'payload': {'subscription': {'entity': {'id': 'sub_test123', 'status': 'active', 'current_end': end, 'plan_id': 'plan_plus123'}}, 'payment': {'entity': {'id': 'pay_test123', 'status': payment_status, 'amount': 9900, 'currency': 'INR', 'invoice_id': 'inv_test'}}}}
    unsigned = authenticated.post(API + '/billing/webhook', json=payload('subscription.charged'))
    assert unsigned.status_code == 400
    charged = payload('subscription.charged')
    assert signed_webhook(authenticated, settings, charged).json()['duplicate'] is False
    assert signed_webhook(authenticated, settings, charged).json()['duplicate'] is True
    assert authenticated.get(API + '/billing/status').json()['plan'] == 'plus'
    assert signed_webhook(authenticated, settings, payload('subscription.cancelled', now - 60), 'older-event').status_code == 200
    assert authenticated.get(API + '/billing/status').json()['plan'] == 'plus'
    changed_same_id = payload('subscription.cancelled')
    assert signed_webhook(authenticated, settings, changed_same_id).status_code == 409
    malformed = {'event': 'subscription.charged', 'payload': {'subscription': []}}
    assert signed_webhook(authenticated, settings, malformed, 'malformed').status_code == 400
    pending = payload('subscription.pending')
    assert signed_webhook(authenticated, settings, pending, 'pending').status_code == 200
    assert authenticated.get(API + '/billing/status').json()['graceUntil'] is not None
    refund = {'event': 'refund.processed', 'created_at': now, 'payload': {'refund': {'entity': {'payment_id': 'pay_test123', 'amount': 9900}}}}
    assert signed_webhook(authenticated, settings, refund, 'refund').status_code == 200
    assert authenticated.get(API + '/billing/status').json()['plan'] == 'free'
    assert authenticated.get(API + '/billing/history').json()[0]['status'] == 'refund_processed'
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.Payment)) == 1


def test_scheduled_plan_change_and_entitlements_only_on_charge(authenticated, app, monkeypatch):
    paid_plan(app, authenticated)
    calls = []
    def handler(request):
        calls.append(request)
        if '/plans/plan_pro123' in request.url.path: return httpx.Response(200, json={'period': 'monthly', 'interval': 1, 'item': {'amount': 19900, 'currency': 'INR'}})
        assert request.method == 'PATCH'
        assert json.loads(request.content)['schedule_change_at'] == 'cycle_end'
        return httpx.Response(200, json={'status': 'active'})
    settings = configured_billing(app, monkeypatch, handler)
    response = authenticated.post(API + '/billing/change-plan', json={'plan': 'pro'})
    assert response.status_code == 200, response.text
    assert response.json()['pendingPlan'] == 'pro'
    assert authenticated.get(API + '/billing/status').json()['plan'] == 'plus'
    event = {'event': 'subscription.charged', 'created_at': int(time.time()), 'payload': {'subscription': {'entity': {'id': 'sub_test123', 'plan_id': 'plan_pro123', 'current_end': int(time.time()) + 60 * 86400}}, 'payment': {'entity': {'id': 'pay_upgrade', 'status': 'captured', 'amount': 19900, 'currency': 'INR'}}}}
    assert signed_webhook(authenticated, settings, event).status_code == 200
    assert authenticated.get(API + '/billing/status').json()['plan'] == 'pro'


def test_expired_paid_and_grace_access_reverts_to_free(authenticated, app):
    identifier = paid_plan(app, authenticated, status='pending', end=(datetime.now(timezone.utc) - timedelta(days=2)).isoformat())
    assert authenticated.get(API + '/billing/status').json()['plan'] == 'plus'
    with app.state.sessions() as db:
        db.get(m.Subscription, identifier).current_end = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
        db.commit()
    assert authenticated.get(API + '/billing/status').json()['plan'] == 'free'


def test_google_pkce_state_one_time_and_mocked_code_exchange(authenticated, app):
    app.state.settings.google_id = 'test-client-id'
    app.state.settings.google_secret = 'test-client-secret'
    observed = []
    def handler(request):
        observed.append(request)
        if request.url.host == 'oauth2.googleapis.com':
            data = parse_qs(request.content.decode())
            assert data['code_verifier']
            assert data['grant_type'] == ['authorization_code']
            assert data['client_secret'] == ['test-client-secret']
            return httpx.Response(200, json={'access_token': 'never-persist-test-token'})
        assert request.headers['authorization'] == 'Bearer never-persist-test-token'
        return httpx.Response(200, json={'sub': 'google-test-sub', 'email': 'google@example.com', 'email_verified': True, 'name': 'OAuth Example'})
    app.state.oauth_transport = httpx.MockTransport(handler)
    start = authenticated.get(API + '/auth/google/start', follow_redirects=False)
    query = parse_qs(httpx.URL(start.headers['location']).query.decode())
    assert query['code_challenge_method'] == ['S256']
    assert query['redirect_uri'] == ['http://localhost:8000/api/v1/auth/google/callback']
    state = query['state'][0]
    assert authenticated.get(API + '/auth/google/callback?state=wrong&code=test').status_code == 400
    response = authenticated.get(API + '/auth/google/callback', params={'state': state, 'code': 'mock-code'}, follow_redirects=False)
    assert response.status_code == 302, response.text
    assert response.headers['location'] == 'http://localhost:3000/login/'
    assert authenticated.get(API + '/auth/me').json()['email'] == 'google@example.com'
    assert authenticated.get(API + '/auth/google/callback', params={'state': state, 'code': 'mock-code'}).status_code == 400
    assert len(observed) == 2
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(m.OAuthState)) == 0
    json_start = authenticated.get(API + '/auth/google/start?format=json')
    assert json_start.status_code == 200
    assert json_start.json()['url'].startswith('https://accounts.google.com/')
    assert 'HttpOnly' in json_start.headers['set-cookie']


def test_provider_auth_consent_paid_quota_and_no_prompt_retention(authenticated, app):
    def handler(request):
        return httpx.Response(200, json={'choices': [{'message': {'content': 'Test-only generated reply'}}]})
    gateway = ProviderGateway(transport=httpx.MockTransport(handler))
    gateway.config['openai']['key'] = 'test-server-owned-key'
    app.state.providers = gateway
    request = {'provider': 'openai', 'model': 'mock-model', 'messages': [{'role': 'user', 'content': 'PRIVATE-EXAMPLE-NOT-RETAINED'}], 'consentCloud': True}
    assert authenticated.post(API + '/ai/generate', json=request).status_code == 402
    paid_plan(app, authenticated)
    assert authenticated.post(API + '/ai/generate', json={**request, 'consentCloud': False}).status_code == 422
    response = authenticated.post(API + '/ai/generate', json=request)
    assert response.status_code == 200, response.text
    assert response.json()['aiGenerated'] is True
    with app.state.sessions() as db:
        usage = db.scalar(select(m.Usage).where(m.Usage.kind == 'generate'))
        assert usage.count == 1
        usage.count = 20
        metadata = db.scalar(select(m.AIResponse))
        assert metadata.provider == 'openai'
        assert 'PRIVATE-EXAMPLE-NOT-RETAINED' not in repr(metadata.__dict__)
        db.commit()
    assert authenticated.post(API + '/ai/generate', json=request).status_code == 429


def test_audio_upload_requires_consent_and_paid_adapter(authenticated, app):
    calls = []
    def handler(request):
        calls.append(request)
        assert '/audio/transcriptions' in request.url.path
        assert b'whisper-1' in request.content
        return httpx.Response(200, json={'text': 'Mocked consented audio transcript'})
    gateway = ProviderGateway(transport=httpx.MockTransport(handler))
    gateway.config['openai']['key'] = 'test-server-owned-key'
    app.state.providers = gateway
    paid_plan(app, authenticated)
    assert authenticated.post(API + '/speech/transcribe', files={'file': ('clip.wav', b'RIFF mock audio', 'audio/wav')}).status_code == 422
    result = authenticated.post(API + '/speech/transcribe', data={'consent': 'true'}, files={'file': ('clip.wav', b'RIFF mock audio', 'audio/wav')})
    assert result.status_code == 200, result.text
    assert result.json()['audioStored'] is False
    assert len(calls) == 1


def test_headshot_upload_validation_adapter_and_quota(authenticated, app):
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.path == '/v1/images/edits'
        assert b'Preserve this same person' in request.content
        assert b'gpt-image-1' in request.content
        return httpx.Response(200, json={'data': [{'b64_json': base64.b64encode(b'mocked-generated-image').decode()}]})
    gateway = ProviderGateway(transport=httpx.MockTransport(handler))
    gateway.config['openai']['key'] = 'test-server-owned-image-key'
    app.state.providers = gateway
    paid_plan(app, authenticated)
    image = ('own-photo.png', b'\x89PNG\r\n\x1a\nmocked-fixture', 'image/png')
    assert authenticated.post(API + '/headshots', files={'file': image}).status_code == 422
    assert authenticated.post(API + '/headshots', data={'consent': 'true', 'ownPhoto': 'true', 'style': 'unsupported'}, files={'file': image}).status_code == 422
    assert authenticated.post(API + '/headshots', data={'consent': 'true', 'ownPhoto': 'true'}, files={'file': ('bad.png', b'wrong', 'image/png')}).status_code == 422
    data = {'consent': 'true', 'ownPhoto': 'true', 'style': 'Professional', 'background': 'Neutral'}
    generated = authenticated.post(API + '/headshots', data=data, files={'file': image})
    assert generated.status_code == 200, generated.text
    assert generated.json()['stored'] is False
    assert generated.json()['aiGenerated'] is True
    assert base64.b64decode(generated.json()['imageBase64']) == b'mocked-generated-image'
    assert authenticated.post(API + '/headshots', data=data, files={'file': image}).status_code == 429
    assert len(calls) == 1


def test_headshot_missing_provider_and_provider_failure(authenticated, app):
    image = ('own-photo.png', b'\x89PNG\r\n\x1a\nfixture', 'image/png')
    data = {'consent': 'true', 'ownPhoto': 'true'}
    assert authenticated.post(API + '/headshots', data=data, files={'file': image}).status_code == 503
    gateway = ProviderGateway(transport=httpx.MockTransport(lambda request: httpx.Response(400, json={'error': {'message': 'private upstream error'}})))
    gateway.config['openai']['key'] = 'test-only'
    app.state.providers = gateway
    paid_plan(app, authenticated)
    response = authenticated.post(API + '/headshots', data=data, files={'file': image})
    assert response.status_code == 502
    assert 'private upstream error' not in response.text


def test_coding_uses_configured_isolated_service_only(authenticated, app):
    calls = []
    settings = app.state.settings
    settings.runner_url = 'https://isolated.example/run'
    settings.runner_token = 'test-runner-token'
    def handler(request):
        calls.append(request)
        payload = json.loads(request.content)
        assert payload['limits'] == {'timeMs': 2000, 'memoryMb': 128, 'network': False, 'filesystem': 'ephemeral', 'processes': 16}
        assert request.headers['authorization'] == 'Bearer test-runner-token'
        return httpx.Response(200, json={'isolated': True, 'limitsEnforced': True, 'stdout': '2\n', 'stderr': '', 'exitCode': 0, 'tests': [{'passed': True, 'actual': '2'}]})
    app.state.runner_transport = httpx.MockTransport(handler)
    response = authenticated.post(API + '/coding/run', json={'language': 'python', 'code': 'print(1 + 1)', 'tests': [{'nums': [2, 7, 11, 15], 'target': 9, 'expected': [0, 1]}]})
    assert response.status_code == 200, response.text
    assert response.json()['tested'] is True
    assert response.json()['stdout'] == '2\n'
    assert len(calls) == 1
    app.state.runner_transport = httpx.MockTransport(lambda request: httpx.Response(200, json={'stdout': 'untrusted'}))
    assert authenticated.post(API + '/coding/run', json={'language': 'python', 'code': 'print(1)'}).status_code == 502


def test_password_recovery_token_once_and_all_sessions_revoked(authenticated, app):
    from app.security import digest, future
    owner = authenticated.get(API + '/auth/me').json()['id']
    raw = 'test-only-recovery-token-1234567890'
    with app.state.sessions() as db:
        db.add(m.RecoveryToken(owner_id=owner, token_hash=digest(raw), expires_at=future(minutes=5)))
        db.commit()
    response = authenticated.post(API + '/auth/recovery/confirm', json={'token': raw, 'password': 'a-new-test-password-123'})
    assert response.status_code == 200, response.text
    assert authenticated.get(API + '/auth/me').status_code == 401
    assert authenticated.post(API + '/auth/recovery/confirm', json={'token': raw, 'password': 'another-new-password-123'}).status_code == 400
    authenticated.headers.pop('x-csrf-token')
    assert authenticated.post(API + '/auth/login', json={'email': 'candidate@example.com', 'password': 'a-test-password-123'}).status_code == 401
    assert authenticated.post(API + '/auth/login', json={'email': 'candidate@example.com', 'password': 'a-new-test-password-123'}).status_code == 200


def test_rate_limits_shared_between_instances_and_hashed(app):
    from app.security import RateLimiter
    from fastapi import HTTPException
    first, second = RateLimiter(app.state.sessions), RateLimiter(app.state.sessions)
    # Lifespan migrations run through TestClient before the independent limiter calls.
    with TestClient(app):
        first.check(('example-private-identity', '127.0.0.1'), 1, 60)
        with pytest.raises(HTTPException) as exc:
            second.check(('example-private-identity', '127.0.0.1'), 1, 60)
        assert exc.value.status_code == 429
        with app.state.sessions() as db:
            buckets = db.scalars(select(m.RateBucket)).all()
            assert all(len(bucket.key_hash) == 64 for bucket in buckets)
            assert '127.0.0.1' not in str([b.__dict__ for b in buckets])


def test_detailed_and_full_analytics_entitlements(authenticated, app):
    owner = authenticated.get(API + '/auth/me').json()['id']
    with app.state.sessions() as db:
        db.add(m.Progress(owner_id=owner, topic='SQL', score=55, evidence={'method': 'synthetic rubric fixture'}))
        db.commit()
    free = authenticated.get(API + '/reports').json()
    assert free['practiceAnswers'] == 1
    assert free['detailedAvailable'] is False
    assert free['progress'] == []
    assert free['analytics'] is None
    identifier = paid_plan(app, authenticated)
    plus = authenticated.get(API + '/reports').json()
    assert plus['detailedAvailable'] is True
    assert plus['weakTopics'] == ['SQL']
    assert plus['analytics'] is None
    with app.state.sessions() as db:
        db.get(m.Subscription, identifier).plan = 'pro'
        db.commit()
    pro = authenticated.get(API + '/reports').json()
    assert pro['analytics']['topics'][0]['averageScore'] == 55


def test_nested_byok_and_credential_headers_rejected(authenticated):
    response = authenticated.put(API + '/profile', json={'projects': [{'name': 'Example', 'credentials': {'apiKey': 'NEVER-STORED-SECRET'}}]})
    assert response.status_code == 422
    assert 'NEVER-STORED-SECRET' not in response.text
    response = authenticated.get(API + '/auth/me', headers={'authorization': 'Bearer NEVER-STORED-SECRET'})
    assert response.status_code == 422
    assert 'NEVER-STORED-SECRET' not in response.text
