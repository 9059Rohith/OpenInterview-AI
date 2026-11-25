"""Server-owned credential adapters. No endpoint accepts a key, URL, or arbitrary origin."""
import asyncio
import json
import os
from urllib.parse import urlparse
import httpx
from fastapi import HTTPException
from .intelligence import tokens


class ProviderGateway:
    def __init__(self, transport=None, local=True):
        self.transport = transport
        self.local = local
        self.config = {
            'openai': {'base': 'https://api.openai.com/v1', 'key': os.getenv('OPENAI_API_KEY', ''), 'default': 'gpt-4o-mini', 'stream': True, 'vision': True},
            'gemini': {'base': 'https://generativelanguage.googleapis.com/v1beta', 'key': os.getenv('GEMINI_API_KEY', ''), 'default': 'gemini-2.5-flash', 'stream': True, 'vision': True},
            'claude': {'base': 'https://api.anthropic.com/v1', 'key': os.getenv('ANTHROPIC_API_KEY', ''), 'default': 'claude-sonnet-4-5', 'stream': True, 'vision': True},
            'compatible': {'base': os.getenv('COMPATIBLE_API_BASE', ''), 'key': os.getenv('COMPATIBLE_API_KEY', ''), 'default': os.getenv('COMPATIBLE_MODEL', ''), 'stream': True, 'vision': False},
            'ollama': {'base': os.getenv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'), 'key': '', 'default': '', 'stream': True, 'vision': False},
        }
        self.enabled_ollama = local and os.getenv('ENABLE_SERVER_OLLAMA', 'true').lower() == 'true'
        for name, config in self.config.items():
            if config['base']:
                parsed = urlparse(config['base'])
                if parsed.scheme not in {'https', 'http'} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                    raise ValueError(f'Invalid server base URL for {name}')
                if parsed.scheme == 'http' and parsed.hostname not in {'127.0.0.1', 'localhost', '::1'}:
                    raise ValueError('Remote provider URLs require HTTPS')

    def configured(self, name):
        c = self.config.get(name)
        return bool(c and ((name == 'ollama' and self.enabled_ollama) or (name != 'ollama' and c['base'] and c['key'])))

    def status(self):
        return [{'provider': name, 'configured': self.configured(name), 'model': c['default'], 'processing': 'local server' if name == 'ollama' else 'remote provider', 'capabilities': {'text': True, 'streaming': c['stream'], 'visionAdapter': False, 'providerSupportsVision': c['vision'], 'transcription': name == 'openai'}, 'status': 'configured; connectivity checked when used' if self.configured(name) else 'setup required', 'byokAccepted': False, 'maxInputEstimatedTokens': 16000, 'maxOutputTokens': 4096, 'costEstimate': None, 'costNote': 'Model prices vary; no unsupported price estimate is shown.'} for name, c in self.config.items()]

    def ensure(self, name):
        if name not in self.config: raise HTTPException(404, 'Unknown provider')
        if not self.configured(name): raise HTTPException(503, f'{name} is not configured on this server. Use browser/desktop BYOK directly, or configure a server-owned credential.')

    def client(self): return httpx.AsyncClient(timeout=httpx.Timeout(60, connect=5), transport=self.transport, follow_redirects=False)

    def headers(self, name):
        key = self.config[name]['key']
        if name == 'gemini': return {'x-goog-api-key': key}
        if name == 'claude': return {'x-api-key': key, 'anthropic-version': '2023-06-01'}
        return {'Authorization': f'Bearer {key}'} if key else {}

    async def request(self, name, method, path, **kwargs):
        self.ensure(name)
        async with self.client() as client:
            for attempt in range(3):
                try:
                    response = await client.request(method, self.config[name]['base'].rstrip('/') + path, headers=self.headers(name), **kwargs)
                    if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                        await asyncio.sleep(0.15 * 2**attempt)
                        continue
                    response.raise_for_status()
                    return response.json()
                except httpx.HTTPStatusError as exc:
                    raise HTTPException(502, f'{name} rejected the request (HTTP {exc.response.status_code}); provider response contents are withheld')
                except (httpx.RequestError, ValueError):
                    if attempt < 2:
                        await asyncio.sleep(0.15 * 2**attempt)
                        continue
                    raise HTTPException(503, f'{name} is unreachable or returned invalid JSON')

    async def models(self, name):
        path = '/api/tags' if name == 'ollama' else '/models'
        data = await self.request(name, 'GET', path)
        if name == 'ollama':
            return [{'id': m['name'], 'sizeBytes': m.get('size'), 'details': m.get('details', {})} for m in data.get('models', [])]
        if name == 'gemini':
            return [{'id': m['name'].removeprefix('models/'), 'displayName': m.get('displayName'), 'contextWindow': m.get('inputTokenLimit'), 'outputLimit': m.get('outputTokenLimit')} for m in data.get('models', []) if 'generateContent' in m.get('supportedGenerationMethods', [])]
        return [{'id': m['id']} for m in data.get('data', [])]

    def payload(self, request, stream=False):
        messages = [m.model_dump() for m in request.messages]
        if sum(tokens(m['content']) for m in messages) > 16000:
            raise HTTPException(413, 'Estimated input exceeds 16000 tokens; use context optimization')
        name = request.provider
        if name == 'gemini':
            system = '\n'.join(m['content'] for m in messages if m['role'] == 'system')
            body = {'contents': [{'role': 'model' if m['role'] == 'assistant' else 'user', 'parts': [{'text': m['content']}]} for m in messages if m['role'] != 'system'], 'generationConfig': {'maxOutputTokens': request.max_tokens, 'temperature': request.temperature}}
            if system: body['systemInstruction'] = {'parts': [{'text': system}]}
            return f'/models/{request.model}:streamGenerateContent?alt=sse' if stream else f'/models/{request.model}:generateContent', body
        if name == 'claude':
            system = '\n'.join(m['content'] for m in messages if m['role'] == 'system')
            return '/messages', {'model': request.model, 'messages': [m for m in messages if m['role'] != 'system'], 'system': system, 'max_tokens': request.max_tokens, 'temperature': min(request.temperature, 1), 'stream': stream}
        if name == 'ollama':
            return '/api/chat', {'model': request.model, 'messages': messages, 'stream': stream, 'options': {'num_predict': request.max_tokens, 'temperature': request.temperature, 'num_ctx': 20096}}
        return '/chat/completions', {'model': request.model, 'messages': messages, 'max_tokens': request.max_tokens, 'temperature': request.temperature, 'stream': stream}

    def parse_text(self, name, data):
        if name == 'gemini': return ''.join(p.get('text', '') for c in data.get('candidates', []) for p in c.get('content', {}).get('parts', []))
        if name == 'claude': return ''.join(p.get('text', '') for p in data.get('content', []))
        if name == 'ollama': return data.get('message', {}).get('content', '')
        return data.get('choices', [{}])[0].get('message', {}).get('content', '')

    async def generate(self, request):
        self.ensure(request.provider)
        path, body = self.payload(request)
        data = await self.request(request.provider, 'POST', path, json=body)
        text = self.parse_text(request.provider, data)
        if not text: raise HTTPException(502, 'Provider returned no text')
        return {'text': text, 'aiGenerated': True, 'provider': request.provider, 'model': request.model, 'estimatedOutputTokens': tokens(text)}

    async def stream(self, request, disconnected):
        self.ensure(request.provider)
        path, body = self.payload(request, True)
        # Cancellation closes the upstream HTTP stream. No automatic retry once output begins.
        async with self.client() as client:
            try:
                async with client.stream('POST', self.config[request.provider]['base'].rstrip('/') + path, headers=self.headers(request.provider), json=body) as response:
                    if response.status_code >= 400:
                        yield {'error': f'Provider HTTP {response.status_code}', 'done': True}
                        return
                    async for line in response.aiter_lines():
                        if await disconnected(): return
                        if not line or line.startswith(('event:', ':')): continue
                        raw = line[5:].strip() if line.startswith('data:') else line
                        if raw == '[DONE]': break
                        try:
                            data = json.loads(raw)
                            if request.provider == 'ollama': text = data.get('message', {}).get('content', '')
                            elif request.provider == 'gemini': text = self.parse_text('gemini', data)
                            elif request.provider == 'claude': text = data.get('delta', {}).get('text', '')
                            else: text = data.get('choices', [{}])[0].get('delta', {}).get('content', '')
                            if text: yield {'text': text, 'aiGenerated': True}
                        except (ValueError, KeyError, TypeError):
                            continue
                    yield {'done': True}
            except (httpx.RequestError, asyncio.TimeoutError):
                yield {'error': 'Provider connection failed or timed out', 'done': True}

    async def transcribe(self, filename, data, mime):
        self.ensure('openai')
        response = await self.request('openai', 'POST', '/audio/transcriptions', files={'file': (filename, data, mime)}, data={'model': os.getenv('TRANSCRIPTION_MODEL', 'whisper-1')})
        return {'text': response.get('text', ''), 'provider': 'openai', 'processing': 'remote', 'aiGenerated': True, 'audioStored': False}

    async def headshot(self, data, mime, style, background):
        self.ensure('openai')
        prompt = f'Create a professional headshot by editing this user-provided photograph. The user confirms this is their own photograph and consents to the edit. Preserve this same person\'s identity, natural facial features and skin tone. Style: {style}. Background: {background}. Use realistic professional lighting, business-appropriate clothing, and natural retouching. Do not add text or other people.'
        extension = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}[mime]
        result = await self.request('openai', 'POST', '/images/edits', files={'image': ('own-photo.' + extension, data, mime)}, data={'model': os.getenv('HEADSHOT_MODEL', 'gpt-image-1'), 'prompt': prompt, 'size': '1024x1024', 'quality': 'low', 'n': '1'})
        encoded = result.get('data', [{}])[0].get('b64_json')
        if not encoded: raise HTTPException(502, 'Image provider returned no image')
        return {'imageBase64': encoded, 'mime': 'image/png', 'aiGenerated': True, 'provider': 'openai', 'stored': False, 'label': 'AI-generated professional headshot'}
