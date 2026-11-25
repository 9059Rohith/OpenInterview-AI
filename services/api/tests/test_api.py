import hashlib
import hmac
import io
import json
from datetime import datetime, timezone, timedelta
import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, inspect
from app import models as m
from app.config import Settings
from app.database import make_engine, migrate
from app.main import create_app
from app.intelligence import optimize, analyze_resume, extract_document
from app.providers import ProviderGateway
from app.billing import Razorpay
from app.schemas import Generate
from .conftest import signup

API = '/api/v1'


def test_actual_migration_upgrade_downgrade(tmp_path):
    from alembic.config import Config
    from alembic import command
    from app.config import ROOT
    engine = make_engine('sqlite:///' + str(tmp_path / 'migration.db'))
    migrate(engine)
    assert set(m.Base.metadata.tables) <= set(inspect(engine).get_table_names())
    config = Config(str(ROOT / 'alembic.ini'))
    config.set_main_option('script_location', str(ROOT / 'alembic'))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.downgrade(config, 'base')
    assert set(inspect(engine).get_table_names()) == {'alembic_version'}
    migrate(engine)
    assert 'resume_versions' in inspect(engine).get_table_names()


def test_auth_session_csrf_and_revocation(client, app):
    user = signup(client)
    assert 'HttpOnly' in client.post(API + '/auth/login', json={'email': user['email'], 'password': 'a-test-password-123'}).headers['set-cookie']
    client.headers.pop('x-csrf-token')
    csrf = client.get(API + '/auth/csrf').json()['csrfToken']
    assert client.post(API + '/auth/logout').status_code == 403
    client.headers['x-csrf-token'] = csrf
    devices = client.get(API + '/auth/devices').json()
    current = next(d for d in devices if d['current'])
    assert client.get(API + '/auth/devices/' + current['id']).status_code == 200
    assert client.delete(API + '/auth/devices/' + current['id']).status_code == 200
    assert client.get(API + '/auth/me').status_code == 401
    with app.state.sessions() as db:
        record = db.scalar(select(m.User))
        assert record.password_hash.startswith('scrypt$')
        assert 'a-test-password-123' not in record.password_hash
        assert all(len(d.token_hash) == 64 for d in db.scalars(select(m.Device)))


def test_validation_origin_secrets_and_rate_limit(client):
    weak = client.post(API + '/auth/register', json={'email': 'not-email', 'password': 'secret', 'name': 'A'})
    assert weak.status_code == 422
    assert 'secret' not in weak.text
    assert client.post(API + '/auth/register', headers={'origin': 'https://evil.invalid'}, json={}).status_code == 403
    assert client.options(API + '/auth/login', headers={'Origin': 'http://localhost:3000', 'Access-Control-Request-Method': 'POST'}).headers['access-control-allow-origin'] == 'http://localhost:3000'
    statuses = [client.post(API + '/auth/login', json={'email': 'no@example.com', 'password': 'wrong'}).status_code for _ in range(11)]
    assert statuses[:10] == [401] * 10
    assert statuses[-1] == 429


def test_request_limit(authenticated):
    response = authenticated.post(API + '/documents', content=b'x' * (12 * 1024 * 1024 + 1), headers={'content-type': 'application/json'})
    assert response.status_code == 413


def test_profile_roundtrip_and_owner_isolation(authenticated, app):
    first = authenticated
    profile = {'name': 'Example', 'role': 'Engineer', 'skills': ['Python', 'SQL', 'Python'], 'projects': [{'name': 'Original demo', 'description': 'Self-authored sample'}], 'education': [{'degree': 'Illustrative BSc'}], 'resumeText': 'Example only'}
    response = first.put(API + '/profile', json=profile)
    assert response.status_code == 200, response.text
    assert response.json()['skills'] == ['Python', 'SQL']
    with TestClient(app) as other:
        signup(other, 'other@example.com')
        assert other.get(API + '/profile').json()['resumeText'] == ''
        assert other.get(API + '/profile').json()['projects'] == []


def test_documents_crud_extract_and_cross_user(authenticated, app):
    record = authenticated.post(API + '/documents', json={'name': 'Notes', 'text': 'A safe original sample'}).json()
    identifier = record['id']
    assert authenticated.get(API + '/documents?search=safe').json()[0]['id'] == identifier
    assert authenticated.put(API + '/documents/' + identifier, json={'name': 'Revised', 'text': 'new'}).json()['text'] == 'new'
    parsed = authenticated.post(API + '/documents/extract', files={'file': ('notes.txt', b'Skills\nPython and SQL', 'text/plain')})
    assert parsed.status_code == 200, parsed.text
    assert parsed.json()['stored'] is False
    assert parsed.json()['analysis']['skills'] == ['Python', 'SQL']
    unsupported = authenticated.post(API + '/documents/extract', files={'file': ('photo.png', b'not an image', 'image/png')})
    assert unsupported.status_code == 415
    with TestClient(app) as other:
        signup(other, 'other@example.com')
        for method in ['get', 'delete']:
            assert getattr(other, method)(API + '/documents/' + identifier).status_code == 404
    assert authenticated.delete(API + '/documents/' + identifier).json()['deleted']
    assert authenticated.get(API + '/documents/' + identifier).status_code == 404


def test_pdf_docx_extraction_and_invalid_files(authenticated):
    from docx import Document
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, NameObject, DictionaryObject
    document, buffer = Document(), io.BytesIO()
    document.add_heading('Education', 1)
    document.add_paragraph('Illustrative BSc Computer Science')
    document.save(buffer)
    assert 'Illustrative BSc' in extract_document('resume.docx', buffer.getvalue())
    writer = PdfWriter()
    page = writer.add_blank_page(600, 800)
    stream = DecodedStreamObject()
    stream.set_data(b'BT /F1 12 Tf 50 750 Td (Original PDF example) Tj ET')
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
    page[NameObject('/Contents')] = writer._add_object(stream)
    pdf = io.BytesIO()
    writer.write(pdf)
    assert 'Original PDF example' in extract_document('sample.pdf', pdf.getvalue())
    response = authenticated.post(API + '/documents/extract', files={'file': ('bad.pdf', b'not pdf', 'application/pdf')})
    assert response.status_code == 422


def test_resume_versions_analysis_export_and_cascade(authenticated, app):
    response = authenticated.post(API + '/resumes', json={'name': 'Original', 'text': 'Skills\nPython\nEducation\nIllustrative BSc'})
    assert response.status_code == 201, response.text
    identifier = response.json()['id']
    assert authenticated.put(API + '/resumes/' + identifier, json={'name': 'Revised', 'text': 'Python and SQL'}).status_code == 200
    assert [v['version'] for v in authenticated.get(API + '/resumes/' + identifier + '/versions').json()] == [2, 1]
    analysis = authenticated.post(API + '/resumes/analyze', json={'text': 'Skills\nPython', 'job_description': 'Python and SQL'}).json()
    assert analysis['match']['score'] == 50
    assert analysis['match']['missingSkills'] == ['SQL']
    assert analysis['aiGenerated'] is False
    assert authenticated.get(API + '/resumes/' + identifier + '/export?format=docx').content.startswith(b'PK')
    assert authenticated.delete(API + '/resumes/' + identifier).status_code == 200
    with app.state.sessions() as db:
        assert db.scalar(select(m.ResumeVersion.id).where(m.ResumeVersion.resume_id == identifier)) is None


def test_question_catalog_submissions_bookmarks_reports(authenticated, app):
    catalog = authenticated.get(API + '/questions?topic=Python').json()
    assert len(catalog) == 1
    assert catalog[0]['original']
    identifier = catalog[0]['id']
    assert authenticated.post(API + '/questions/' + identifier + '/bookmark').status_code == 200
    assert authenticated.get(API + '/bookmarks').json()[0]['id'] == identifier
    assert authenticated.post(API + '/questions/' + identifier + '/report', json={'reason': 'Needs a clearer example'}).status_code == 201
    submission = authenticated.post(API + '/questions', json={'topic': 'Python', 'question': 'Explain a generator with a practical example.', 'source': {'title': 'My original question', 'confidence': 'verified'}})
    assert submission.status_code == 201
    assert submission.json()['source']['confidence'] == 'unverified'
    with TestClient(app) as other:
        signup(other, 'other@example.com')
        assert submission.json()['id'] not in [q['id'] for q in other.get(API + '/questions').json()]
    assert authenticated.delete(API + '/questions/' + identifier + '/bookmark').status_code == 200
    assert authenticated.get(API + '/bookmarks').json() == []
    assert authenticated.get(API + '/companies?search=General').json()[0]['roles']


def test_sessions_turns_summary_exports_and_owner(authenticated, app):
    response = authenticated.post(API + '/sessions', json={'title': 'Mock sample', 'mode': 'Shadow Mode', 'notes': 'Visible user-started practice'})
    assert response.status_code == 201, response.text
    identifier = response.json()['id']
    for speaker, text in [('assistant', 'How do transactions work?'), ('user', 'Transactions group operations.'), ('transcript', 'A user-consented sample segment')]:
        assert authenticated.post(API + '/sessions/' + identifier + '/turns', json={'speaker': speaker, 'text': text}).status_code == 201
    summary = authenticated.post(API + '/sessions/' + identifier + '/summary').json()
    assert summary['responseCount'] == 1
    assert summary['transcriptSegments'] == 1
    assert summary['questions'] == ['How do transactions work?']
    assert 'Transactions' in authenticated.get(API + '/sessions/' + identifier + '/export').text
    assert len(authenticated.get(API + '/sessions/' + identifier + '/export?format=json').json()['turns']) == 3
    assert authenticated.patch(API + '/sessions/' + identifier, json={'archived': True, 'notes': 'Updated note'}).json()['archived']
    assert len(authenticated.get(API + '/sessions?archived=true').json()) == 1
    with TestClient(app) as other:
        signup(other, 'other@example.com')
        assert other.get(API + '/sessions/' + identifier).status_code == 404
        assert other.post(API + '/sessions/' + identifier + '/turns', json={'speaker': 'user', 'text': 'attempt'}).status_code == 404
    assert authenticated.delete(API + '/sessions/' + identifier).status_code == 200
    with app.state.sessions() as db:
        assert not db.scalar(select(m.Turn.id).where(m.Turn.session_id == identifier))


def test_mock_interview_and_progress(authenticated):
    response = authenticated.post(API + '/mock-interviews', json={'title': 'Python practice', 'category': 'Python'})
    assert response.status_code == 201, response.text
    mock = response.json()
    assert len(mock['session']['turns']) == 1
    answer = authenticated.post(API + '/mock-interviews/' + mock['id'] + '/answer', json={'text': 'For example use None to avoid a shared mutable argument. Allocate a new list for each call.'})
    assert answer.status_code == 200, answer.text
    assert answer.json()['completed']
    assert answer.json()['evaluation']['criteria']['conceptCoverage'] == 5
    assert authenticated.get(API + '/reports').json()['practiceAnswers'] == 1
    assert authenticated.post(API + '/mock-interviews/' + mock['id'] + '/answer', json={'text': 'again'}).status_code == 409


def test_roadmap_owner_scoping_and_reports(authenticated, app):
    roadmap = authenticated.post(API + '/roadmaps', json={'title': 'Original plan', 'items': [{'topic': 'SQL', 'dueDate': '2026-12-01', 'completed': False}]}).json()
    roadmap['items'][0]['completed'] = True
    assert authenticated.patch(API + '/roadmaps/' + roadmap['id'], json={'title': roadmap['title'], 'items': roadmap['items']}).status_code == 200
    assert authenticated.get(API + '/reports').json()['roadmapCompletion'] == {'completed': 1, 'total': 1}
    with TestClient(app) as other:
        signup(other, 'other@example.com')
        assert other.patch(API + '/roadmaps/' + roadmap['id'], json={'title': 'attack', 'items': []}).status_code == 404
        second = other.post(API + '/roadmaps', json={'title': 'Another plan', 'items': []}).json()
        assert other.patch(API + '/roadmaps/' + second['id'], json={'title': 'Another plan', 'items': roadmap['items']}).status_code == 404


def test_unconfigured_integrations_honest_and_byok_forbidden(authenticated):
    caps = authenticated.get(API + '/capabilities').json()
    assert caps['byokToBackend'] is False
    assert not caps['billing']
    assert authenticated.get(API + '/auth/google/start').status_code == 503
    assert authenticated.post(API + '/billing/checkout', json={'plan': 'plus'}).status_code == 503
    assert authenticated.post(API + '/coding/run', json={'language': 'python', 'code': 'print(1)'}).status_code == 503
    request = {'provider': 'openai', 'model': 'test', 'messages': [{'role': 'user', 'content': 'Original sample'}]}
    assert authenticated.post(API + '/ai/generate', json=request).status_code == 503
    response = authenticated.post(API + '/ai/generate', json={**request, 'apiKey': 'never-accept-this-key'})
    assert response.status_code == 422
    assert 'never-accept-this-key' not in response.text
    assert authenticated.post(API + '/speech/transcribe', files={'file': ('clip.wav', b'example', 'audio/wav')}).status_code == 422
    assert authenticated.post(API + '/speech/transcribe', data={'consent': 'true'}, files={'file': ('clip.wav', b'example', 'audio/wav')}).status_code == 503


def test_context_budget_dedup_facts_and_sanitized_metrics(authenticated, caplog):
    content = 'API key SECRET-NEVER-LOG-CONTENT.\n\nLatency must stay below 120 ms.\n\nLatency must stay below 120 ms.\n\n```python\nx = 999\n```'
    response = authenticated.post(API + '/context/optimize', json={'query': 'latency constraint', 'documents': [{'id': 'original', 'text': content}], 'budget': 50})
    assert response.status_code == 200, response.text
    optimized = response.json()
    assert optimized['tokensAfter'] <= 50
    assert optimized['text'].count('120 ms') == 1
    assert all(chunk['text'] in content for chunk in optimized['chunks'])
    assert authenticated.get(API + '/context/stats').json()['requests'] == 1
    metrics = authenticated.get(API + '/observability/summary').json()
    assert metrics['privateContentLogged'] is False
    assert 'SECRET-NEVER-LOG-CONTENT' not in json.dumps(metrics) + caplog.text


def test_context_ranks_exact_numeric_constraint_and_parser_suppresses_private_warning(caplog):
    facts = [{'id': 'source', 'text': 'Service 41 requires 141 ms latency.\n\nService 42 requires 142 ms latency.'}]
    result = optimize('Service 42 latency', facts, 32)
    assert result['chunks'][0]['text'] == 'Service 42 requires 142 ms latency.'
    from fastapi import HTTPException
    with pytest.raises(HTTPException): extract_document('private.pdf', b'PRIVATE-CANDIDATE-MALFORMED-INPUT')
    assert 'PRIVATE-CANDIDATE-MALFORMED-INPUT' not in caplog.text
    assert analyze_resume('Skills: C++ and JavaScript')['skills'] == ['JavaScript', 'C++']


def test_cloud_without_db_public_only(monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    app = create_app(Settings(mode='cloud', secure_cookies=True))
    with TestClient(app, base_url='https://testserver') as client:
        assert client.get('/health').json()['database'] == 'not configured'
        assert client.get(API + '/capabilities').json()['accounts'] is False
        assert len(client.get(API + '/questions').json()) >= 10
        assert client.get(API + '/billing/plans').json()['plans'][1]['monthly']['INR'] == 9900
        assert client.post(API + '/auth/register', json={'email': 'c@example.com', 'password': 'a-test-password123', 'name': 'Example'}).status_code == 503


def test_cloud_consent_and_cross_origin_csrf(monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    app = create_app(Settings(mode='cloud', secure_cookies=True), engine=make_engine('sqlite:///:memory:'))
    with TestClient(app, base_url='https://testserver') as client:
        user = signup(client)
        assert 'SameSite=none' in client.post(API + '/auth/login', json={'email': user['email'], 'password': 'a-test-password-123'}).headers['set-cookie']
        client.headers['x-csrf-token'] = client.get(API + '/auth/csrf').json()['csrfToken']
        assert client.post(API + '/documents', json={'name': 'Example', 'text': 'candidate original sample'}).status_code == 422
        assert client.post(API + '/documents', json={'name': 'Example', 'text': 'candidate original sample', 'consentCloud': True}).status_code == 201


def test_account_export_delete_and_recovery_generic(authenticated):
    authenticated.post(API + '/documents', json={'name': 'Original', 'text': 'A sample only'})
    export = authenticated.get(API + '/users/export')
    assert export.status_code == 200, export.text
    assert export.json()['documents'][0]['text'] == 'A sample only'
    for email in ['candidate@example.com', 'missing@example.com']:
        assert authenticated.post(API + '/auth/recovery/request', json={'email': email}).json()['deliveryConfigured'] is False
    assert authenticated.delete(API + '/users/me').status_code == 200
    assert authenticated.get(API + '/auth/me').status_code == 401


@pytest.mark.parametrize('provider', ['openai', 'compatible', 'gemini', 'claude', 'ollama'])
def test_provider_adapter_payload_models_and_output(provider):
    async def run():
        def handler(request):
            assert request.url.host in {'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'compatible.example', '127.0.0.1'}
            if request.method == 'GET':
                if provider == 'ollama': return httpx.Response(200, json={'models': [{'name': 'sample', 'size': 10}]})
                if provider == 'gemini': return httpx.Response(200, json={'models': [{'name': 'models/sample', 'supportedGenerationMethods': ['generateContent']}]})
                return httpx.Response(200, json={'data': [{'id': 'sample'}]})
            payload = json.loads(request.content)
            if provider == 'gemini':
                assert payload['contents'][0]['parts'][0]['text'] == 'Original sample'
                return httpx.Response(200, json={'candidates': [{'content': {'parts': [{'text': 'Mocked provider response'}]}}]})
            if provider == 'claude':
                assert request.headers['anthropic-version'] == '2023-06-01'
                return httpx.Response(200, json={'content': [{'text': 'Mocked provider response'}]})
            if provider == 'ollama': return httpx.Response(200, json={'message': {'content': 'Mocked provider response'}})
            assert request.headers['authorization'] == 'Bearer test-server-secret'
            return httpx.Response(200, json={'choices': [{'message': {'content': 'Mocked provider response'}}]})
        gateway = ProviderGateway(transport=httpx.MockTransport(handler))
        for config in gateway.config.values(): config['key'] = 'test-server-secret'
        gateway.config['compatible']['base'] = 'https://compatible.example/v1'
        request = Generate(provider=provider, model='sample', messages=[{'role': 'user', 'content': 'Original sample'}])
        assert (await gateway.generate(request))['text'] == 'Mocked provider response'
        assert (await gateway.models(provider))[0]['id'] == 'sample'
    import asyncio
    asyncio.run(run())


def test_provider_retry_and_stream_cancellation():
    import asyncio
    async def run():
        calls = []
        def handler(request):
            calls.append(request)
            if len(calls) < 3: return httpx.Response(503)
            if json.loads(request.content).get('stream'):
                return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"one"}}]}\n\ndata: {"choices":[{"delta":{"content":"two"}}]}\n\ndata: [DONE]\n\n')
            return httpx.Response(200, json={'choices': [{'message': {'content': 'Recovery after retry'}}]})
        gateway = ProviderGateway(transport=httpx.MockTransport(handler))
        gateway.config['openai']['key'] = 'test-only'
        request = Generate(provider='openai', model='sample', messages=[{'role': 'user', 'content': 'sample'}])
        assert (await gateway.generate(request))['text'] == 'Recovery after retry'
        assert len(calls) == 3
        async def disconnected(): return True
        assert [event async for event in gateway.stream(request, disconnected)] == []
        async def connected(): return False
        assert [event async for event in gateway.stream(request, connected)] == [{'text': 'one', 'aiGenerated': True}, {'text': 'two', 'aiGenerated': True}, {'done': True}]
    asyncio.run(run())
