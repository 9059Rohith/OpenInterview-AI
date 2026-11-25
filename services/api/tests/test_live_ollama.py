"""Opt-in integration against the explicitly installed local runtime; never calls cloud."""
import os
import pytest


@pytest.mark.skipif(os.getenv('RUN_OLLAMA_TEST') != '1', reason='Set RUN_OLLAMA_TEST=1 with a local Ollama service and downloaded model')
def test_real_local_ollama_through_owned_api(authenticated):
    models = authenticated.get('/api/v1/providers/ollama/models')
    assert models.status_code == 200, models.text
    installed = models.json()['models']
    assert installed, 'Download a local model first'
    response = authenticated.post('/api/v1/ai/generate', json={'provider': 'ollama', 'model': os.getenv('OLLAMA_TEST_MODEL', installed[0]['id']), 'messages': [{'role': 'user', 'content': 'Say local interview practice is ready in one short sentence.'}], 'temperature': 0, 'max_tokens': 32})
    assert response.status_code == 200, response.text
    assert response.json()['text'].strip()
    assert response.json()['provider'] == 'ollama'
    assert response.json()['aiGenerated'] is True
