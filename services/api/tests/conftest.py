import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import create_app
from app.config import Settings
from app.database import make_engine


@pytest.fixture
def app(monkeypatch):
    for key in ['DATABASE_URL', 'APP_ENV', 'APP_MODE', 'VERCEL', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'COMPATIBLE_API_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_HOST', 'CODE_RUNNER_URL', 'CODE_RUNNER_TOKEN', 'ISOLATED_RUNNER_URL', 'ISOLATED_RUNNER_TOKEN']:
        monkeypatch.delenv(key, raising=False)
    return create_app(Settings(database_url='sqlite:///:memory:'), engine=make_engine('sqlite:///:memory:'))


@pytest.fixture
def client(app):
    with TestClient(app) as client: yield client


def signup(client, email='candidate@example.com'):
    response = client.post('/api/v1/auth/register', json={'email': email, 'password': 'a-test-password-123', 'name': 'Illustrative Candidate'})
    assert response.status_code == 201, response.text
    client.headers['x-csrf-token'] = response.json()['csrfToken']
    return response.json()


@pytest.fixture
def authenticated(client):
    signup(client)
    return client
