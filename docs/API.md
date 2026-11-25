# OpenInterview AI API

The independent Python API lives in `services/api`. It supports Python 3.12, FastAPI, Pydantic 2, SQLAlchemy 2, SQLite for local storage and PostgreSQL for cloud storage. All product routes start with `/api/v1`. Interactive documentation is at `/docs`; machine-readable schemas are at `/openapi.json`.

## Run and test

From `services/api`:

```powershell
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

In another terminal in that directory:

```powershell
python -m pytest -q
python scripts/benchmark_context.py
```

Verification: the full core/mock suite completed with **40 passed, 1 optional live test skipped** in 21.57 seconds. Three targeted final regressions for numeric/skill fidelity, concurrent mock answers and audio upload also passed. An opt-in real local-runtime test separately passed (`RUN_OLLAMA_TEST=1 python -m pytest -q tests/test_live_ollama.py`, 7.41 seconds): it listed the installed `qwen2.5:0.5b` model and generated text through the authenticated API using only an original synthetic prompt. The default suite skips this external-runtime test unless explicitly enabled. The host's installed Starlette/TestClient emits one deprecation warning about its HTTPX transport; tests and live runtime both work.

Environment variables are read from the process; the API does not automatically load `.env` files. Copy the examples into your process/deployment environment. Do not commit populated environment files. `--no-access-log` prevents default Uvicorn logs from including OAuth authorization codes or user-selected query strings. The supplied Dockerfile uses this option.

The Alembic history contains explicit, reversible schema operations: initial schema, scheduled plan changes and shared rate-limit windows. Startup migrates automatically unless `AUTO_MIGRATE=false`; managed multi-instance production should run migrations once as a release step and disable automatic migration. SQLite upgrade, downgrade and re-upgrade are tested against a real temporary database. PostgreSQL SQL generation is checked offline; a live PostgreSQL service was not supplied during implementation.

## Production and Vercel

Deploy `services/api` as the project root. `api/index.py` exports the ASGI application and `vercel.json` routes requests to it. `APP_ENV=production`, `VERCEL`, or `APP_MODE=cloud` selects cloud mode. Configure a persistent PostgreSQL `DATABASE_URL`, `COOKIE_SECURE=true`, and an exact `CORS_ORIGINS` allowlist containing the deployed web origin. `postgres://` and `postgresql://` URLs are normalized to the psycopg SQLAlchemy driver.

Without a production database, the server exposes only health, capabilities, pricing and original public preparation content. Account creation, authentication and all personal resource operations return 503. An isolated in-memory database holds the original catalog; no ephemeral cloud accounts or resumes are created. `/health` returns `status: degraded`, `database: not configured`, and `accountsReady: false`. It is a liveness response, not a guarantee that optional services are ready.

`APP_MODE=local` defaults to `sqlite:///./openinterview.db`; store this file on an encrypted volume when it contains personal data. Never use a serverless instance filesystem for persistent accounts. Cloud storage encryption, backups, TLS, database credentials and financial retention are operator responsibilities; application-level database encryption is not included.

## Authentication and browser requests

Passwords require 12–128 characters and use random-salted scrypt hashes. Session identifiers are opaque random values; only SHA-256 hashes are stored. The `oi_session` cookie is HTTPOnly, expires after 14 days and is revocable per device or for all devices. Sign-in rotates an existing session. Password recovery uses one-time hashed tokens expiring after 20 minutes and revokes every session when completed. Recovery delivery uses configured SMTP with STARTTLS; without SMTP, the API returns a generic setup state and never exposes a reset token.

Credentialed requests must use `credentials: 'include'`. Registration/login and `GET /auth/me` return `csrfToken`. `GET /auth/csrf` also returns the current API-side CSRF cookie. Send that value in `X-CSRF-Token` for authenticated mutations. This works even when frontend JavaScript cannot read API-origin cookies. CSRF values are not logged. Local cookies use SameSite=Lax; HTTPS cloud cookies use SameSite=None and Secure to support the separately deployed frontend. Browsers that block third-party cookies can require same-site custom domains or a same-origin reverse proxy.

Mutations reject origins outside the exact allowlist. Defaults are `http://localhost:3000`, `http://127.0.0.1:3000` and the desktop `oi://app` origin. Override these for production. The server does not trust arbitrary request-provided redirect URLs or provider URLs.

Request and authentication limits use atomic SQLite/PostgreSQL upserts with hashed identifiers and expiring windows, shared between API workers. The no-database public catalog uses a process-local fallback. Limits: 240 requests/minute per client address, 20 auth attempts/15 minutes per client address, 10 attempts/15 minutes per normalized account, 10 generations/minute and 10 code runs/minute per authenticated owner. Configure a trusted proxy correctly; the API deliberately does not trust arbitrary `X-Forwarded-For` headers. NAT users can share address limits. Provider calls additionally have persistent monthly quotas.

Google login implements authorization-code exchange with S256 PKCE, a short-lived server-side verifier, a browser-bound state cookie and single-use hashed state. `GET /auth/google/start` redirects for top-level navigation; `?format=json` or `Accept: application/json` returns `{url, authorizationUrl}` and the same state cookie for credentialed frontend fetch/navigation. The callback redirects to the existing frontend `/login/` account page. Only a verified Google email is accepted. OAuth access tokens are used transiently for Google userinfo and never persisted; the application establishes its own revocable session. Existing password accounts are not silently linked by matching email. There is no need to retain or rotate a Google refresh token because the app does not request offline Google API access.

## Route inventory

Routes below omit the `/api/v1` prefix. Public routes are capabilities, provider setup status, catalog, companies and pricing; all personal resources require a session. Collections return arrays unless an explicit object is described. Question/document/session collections support `limit` (1–100) and `offset`.

| Group | Routes | Behavior |
| --- | --- | --- |
| Health | `GET /health` outside prefix; `GET /capabilities` | Runtime readiness without credentials or private data |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /auth/me`, `/auth/csrf` | Cookie authentication, CSRF and session rotation |
| Devices | `GET/DELETE /auth/devices`; `GET/DELETE /auth/devices/{id}` | Owner-only device metadata and revocation |
| Google | `GET /auth/google/start`, `/auth/google/callback` | PKCE redirects or explicit 503 setup state |
| Recovery | `POST /auth/recovery/request`, `/auth/recovery/confirm` | Generic request response and one-time token confirmation |
| Profile | `GET/PUT /profile` | Editable profile with normalized owned skills and projects |
| Documents | `GET/POST /documents`; `GET/PUT/DELETE /documents/{id}`; `POST /documents/extract` | Owner-only CRUD, text search, multipart parsing without implicit storage |
| Resumes | `POST /resumes/analyze`; `GET/POST /resumes`; `GET/PUT/DELETE /resumes/{id}` | Deterministic checklist, exact skill matching and immutable text/section versions |
| Resume versions/export | `GET /resumes/{id}/versions`, `/resumes/{id}/export?format=md\|docx` | Original version snapshots; Markdown or real DOCX files; browser printing supplies PDF |
| Catalog | `GET /questions`; `POST /questions`; `POST /questions/{id}/report`; `GET /companies` | Original labeled content and private, unverified user submissions. Filters: topic/company/role/difficulty/search |
| Bookmarks | `GET /bookmarks`; `POST/DELETE /questions/{id}/bookmark` | Owner-only saved questions |
| Sessions | `GET/POST /sessions`; `GET/PATCH/DELETE /sessions/{id}`; `POST /sessions/{id}/turns`, `/summary`; `GET /sessions/{id}/export?format=md\|json` | Search, archive, notes, ordered transcript turns, extractive summary and actual exports |
| Mock interviews | `POST /mock-interviews`; `POST /mock-interviews/{id}/answer` | Ask one original question, wait for an answer, score a transparent practice rubric, expose follow-ups/sample answer and advance or complete |
| Learning | `GET/POST /roadmaps`; `PATCH/DELETE /roadmaps/{id}`; `GET /reports` | Owned normalized tasks, completion and practice progress. Patch supplies the complete title/item set; omitted existing items are removed |
| Providers | `GET /providers`; `GET /providers/{provider}/models` | Explicit configuration state and live model-list adapters |
| Text AI | `POST /ai/generate`, `/ai/stream` | Optional server-owned inference; SSE streaming with disconnect cancellation |
| Speech | `POST /speech/transcribe` multipart | Explicit `consent=true`, audio-only upload, remote transcription adapter; raw audio is not stored |
| Headshots | `POST /headshots` multipart | Own-photo image edit with explicit consent; generated image returned, upload and output not stored by API |
| Billing | `GET /billing/plans`, `/status`, `/history`; `POST /billing/checkout`, `/verify`, `/webhook`, `/cancel`, `/change-plan` | Verified recurring billing, scheduled plan changes, bounded grace and owner-only payment records |
| Coding | `POST /coding/run` | Configured isolated-service adapter only; unavailable without secure service credentials |
| Context | `POST /context/optimize`; `GET /context/stats` | Fact-preserving extractive selection, deduplication, ranking, budget and anonymous process statistics |
| Observability | `GET /observability/summary` | Authenticated route-template latency/error aggregates, no private request content |
| Account privacy | `GET /users/export`; `DELETE /users/me` | Export owned content and delete owned data. Cancellable subscriptions must be stopped first; paid scheduled-cancellation periods must finish |

The canonical contract uses `/profile`, `/sessions` and `/roadmaps`. Redundant legacy names such as `/profiles`, `/interview-sessions` and `/learning` are not separately implemented; clients should use the canonical routes above. Resource IDs belonging to another account return the same 404 response as nonexistent resources. User submissions are private until a future moderation workflow explicitly publishes them; the API does not claim to operate an unattended moderation queue.

## Personal-content consent and parsing

In cloud mode, profile/document/resume/session creation, document extraction, answer/transcript uploads and context optimization require `consentCloud: true` (multipart extraction uses the same field). Once a consented session exists, editing its notes does not require another prompt. The client must obtain consent before transmitting the body; server validation cannot undo a client that already uploaded content without consent. No backend endpoint accepts BYOK keys, even inside nested profile/resume metadata. Credential-bearing headers and recognizable credential JSON fields are rejected. Text deliberately pasted by a user is still content and must not contain secrets.

Text extraction supports unencrypted text PDFs, DOCX paragraphs/tables, UTF-8 TXT/Markdown/CSV and common code files. Limits: 12 MiB request body; 10 MiB extracted-document or audio upload; 500,000 extracted characters; 200 PDF pages; 25 MiB uncompressed DOCX contents. Image OCR and scanned-PDF OCR require a future configured OCR adapter and return a clear unsupported state. Original filenames are not used as disk paths. Parsing runs in a background thread; hostile-document parser isolation and a malware scanner are not included.

Resume extraction never invents employment, education, metrics or projects. Analysis identifies explicitly named skills and section text, then provides an explainable checklist and job-description skill overlap. Its score is not an ATS or hiring-outcome prediction. Advanced semantic reviews can use the configured AI interface only after explicit remote processing consent. The deterministic mock rubric assesses lexical concept coverage, answer length/structure and example markers; it does not verify technical truth or guarantee communication quality. No result is mislabeled as objective correctness.

## Provider setup and limits

Set server-owned `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `COMPATIBLE_API_KEY` plus `COMPATIBLE_API_BASE` as appropriate. `COMPATIBLE_MODEL` selects its default. These values are never returned. User BYOK stays in browser memory or the desktop credential bridge and goes directly to provider origins.

Ollama uses `OLLAMA_BASE_URL=http://127.0.0.1:11434` and `ENABLE_SERVER_OLLAMA=true` in local mode; no key is required. The cloud API disables server Ollama so that a cloud machine is never represented as the user's local runtime. The desktop bridge separately manages model installation, download, removal and hardware information.

All five adapters implement text generation, model listing, streamed output, timeout and sanitized errors. Remote URLs configured by the operator must use HTTPS; HTTP is allowed only on loopback. Client requests cannot select base URLs. Nonstreaming transient HTTP 429/5xx or connection failures receive at most two bounded retries; streaming never retries after output begins. Disconnecting the SSE request closes the upstream stream. There is no independent background job left running behind a fake cancellation acknowledgement.

Input is conservatively capped at 16,000 estimated tokens and output at 4,096. Estimates use UTF-8 bytes/3, not a model tokenizer. Model-list responses expose context limits when the provider supplies them; vision support is a provider capability only, and multimodal chat input is not implemented by this text adapter. Provider cost estimates are explicitly unknown because model pricing changes; no fabricated estimate is shown. A configured key does not imply a successful live connection; model listing or generation checks connectivity.

Monthly server text requests: Free 0, Plus 20, Pro 50. Transcription is capped at 10 requests for paid plans. Headshots are capped at Plus 1/Pro 2. Each request is reserved before external processing, so retries, disconnects or upstream failures can consume an allowance. Local Ollama and direct BYOK do not use the server's paid allowance. Per-request token limits additionally bound exposure; these prices do not promise unlimited cloud AI. Free reports expose basic aggregate practice counts and scores; Plus exposes stored detailed rubric evidence/weak topics, and Pro adds actual per-topic averages/latest scores and completed-session analytics. Account data export always includes the owner's raw progress irrespective of subscription. No organization-management feature is advertised.

The API enforces multiple-resume, detailed-report, full-analytics and server-inference entitlements. Individual owner-scoped cloud CRUD endpoints remain available to free accounts for explicit onboarding and manual transfers; the `cloudSync` subscription capability describes the client's optional paid sync workflow and is not a server authorization boundary. There is no automatic background sync engine on the API.

Speech uses the server OpenAI transcription adapter (`TRANSCRIPTION_MODEL`, default `whisper-1`). Supported multipart MIME types include WAV, MP3, WebM, Ogg and MP4 audio. Capture/VAD/source selection belongs to the visible client; the API handles explicit short segments and does not continuously listen, diarize or access system audio.

Headshots require `consent=true`, `ownPhoto=true`, a PNG/JPEG/WebP image up to 5 MiB, `style=Professional|Natural|Studio` and `background=Neutral|Light|Office`. `HEADSHOT_MODEL` defaults to `gpt-image-1` using server OpenAI image edits. Identity-preserving instructions are sent; the API cannot independently establish photo ownership. The response includes `imageBase64`, `mime`, `aiGenerated`, `stored: false` and a generated-image label. The client provides preview, local save/download and deletion. Provider-side retention follows that provider's policy. Missing keys and upstream image failures are tested setup/error states, not generated samples pretending to be user results.

## Billing

Plans are returned in minor currency units: Free 0; Plus INR 9,900 / USD 199; Pro INR 19,900 / USD 399 monthly, corresponding to ₹99/₹199 and $1.99/$3.99. Override `PRICE_PLUS_INR`, `PRICE_PRO_INR`, `PRICE_PLUS_USD`, `PRICE_PRO_USD` to configure published prices.

Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and the four `RAZORPAY_PLAN_{PLUS|PRO}_{INR|USD}` IDs. Create matching monthly recurring plans in the Razorpay test dashboard first; the checkout adapter fetches the remote plan and validates amount, currency, interval and period against published pricing. USD availability depends on merchant/account support. No credentials means no checkout is created.

The checkout response contains only the public key ID, subscription ID and price. Verification checks Razorpay's HMAC of `payment_id|subscription_id`, fetches captured payment and active subscription, checks amount/currency and verifies the fetched invoice associates that exact payment with that exact owned subscription. A redirect or client claim cannot activate access.

Webhooks verify HMAC over untouched request bytes. A unique Razorpay event ID (or body hash fallback) and body hash make replay idempotent; reusing an ID for a different body returns 409. Older subscription events cannot overwrite a newer recorded timestamp. Activation/resume is confirmed with the provider; renewal charges require expected captured funds. Captured payment IDs are unique. Refund events update billing records, and full refunds remove entitlements. No card details or webhook payload bodies are stored.

An already-paid renewal enters at most 72 hours of grace when the provider reports `subscription.pending`; new unpaid mandates get no grace. Active paid access expires at the verified period end. Cancellation schedules the end of an active cycle and preserves access only until its verified end. Plan changes are scheduled for the next cycle, validated against the remote plan, and apply entitlements only when a matching new-plan payment is captured. Currency changes require ending the existing subscription and starting another. History includes invoice IDs and payment status; issuing refunds and downloading provider-hosted invoice PDFs require operator/provider tooling and are not exposed as fabricated API actions.

## Isolated code runner

`CODE_RUNNER_URL`/`CODE_RUNNER_TOKEN` (aliases `ISOLATED_RUNNER_URL`/`ISOLATED_RUNNER_TOKEN`) configure an independently isolated HTTPS execution service. The API sends language/code/stdin/tests and mandatory requested limits: 2,000 ms, 128 MiB, disabled network, ephemeral filesystem and at most 16 processes. The service must confirm `isolated: true` and `limitsEnforced: true` and return stdout, stderr, exitCode, optional timedOut and test results. A missing confirmation fails closed. The API never invokes a shell, interpreter, Docker daemon or user code itself. Operator assessment must verify actual runner isolation; the API cannot attest a remote service's implementation. No such service or functioning Docker daemon was available during implementation, so the default result is an honest 503.

## Context and observability decisions

The context adapter ranks lexical relevance (including numeric identifiers), removes duplicate source units, preserves complete selected source text/code fences verbatim and omits units that do not fit the conservative budget. It reports before/after estimates, latency, source positions and omitted counts. It does not rewrite facts or claim omitted context is retained. The offline 50-run benchmark used 400 original synthetic constraint paragraphs including 200 duplicates: **12,386 estimated tokens before, 1,178 after within a 1,200-token budget**, 2.34 ms median/4.06 ms p95 on this host. Selected units were unique and verbatim, and the specifically queried numeric constraint was retained. Semantic answer quality was not measured with a real model; these are synthetic selection measurements, not universal compression or accuracy claims.

Headroom's public Python API and architecture were reviewed. Its current pipeline optimizes recent content and uses reversible cache/retrieval behavior; its former score-based conversation managers have been retired. This app needs explicit owner-isolated source selection with no implicit persistent prompt cache. Therefore the small deterministic adapter is the default instead of silently installing a cache pipeline. Headroom is not an installed or benchmarked dependency, and there is no claim that its compression/quality percentages were reproduced. See [Headroom architecture](https://github.com/headroomlabs-ai/headroom/blob/main/docs/content/docs/architecture.mdx), [context management](https://github.com/headroomlabs-ai/headroom/blob/main/docs/content/docs/context-management.mdx), and [Python implementation](https://github.com/headroomlabs-ai/headroom/blob/main/headroom/compress.py). A future opt-in adapter must partition retrieval/cache storage by owner and receive a new privacy review.

Structured JSON events contain only event name, random request ID, route template, HTTP method/status and latency. They omit raw URLs, query strings, IP addresses, user IDs, request/response bodies, provider error bodies, passwords, keys, OAuth tokens, resumes, transcripts and audio. Seven-day database metrics retain only route/status/latency; the authenticated summary is compatible with local JSON log analysis. [LogLens documents JSON parsing and local querying](https://github.com/xiyi-one/loglens). This is a compatible local workflow, not an installed external LogLens service or an automated AI root-cause product. The `openinterview.events` JSON stream handler is enabled by default; keep separate HTTP access logs disabled.

## Verification boundaries and remaining gaps

Automated tests exercise real local database migrations/constraints/cascades, API ownership, consent, CSRF, scrypt/session revocation, rate limits, recovery, resume PDF/DOCX parsing/versioning/export, sessions, bookmarks, mocks/progress, context and private-content logging. HTTPX test transports exercise all provider adapters, streamed cancellation/retries, Google PKCE exchange, paid quotas, headshot/audio uploads, Razorpay signatures/amount/invoice validation/replay/refund/grace/plan-change and isolated-runner contract failures. Test fixtures are synthetic; no real candidate documents or personal keys are used.

External readiness still depends on: a live persistent PostgreSQL database; operator-configured Google OAuth and SMTP; server-owned cloud model/transcription/image keys; Razorpay merchant/test credentials, recurring plans and webhook registration; an audited isolated execution service. These integrations have tested adapters but were not live-verified with absent credentials. A configured Ollama service/model can be exercised locally without any cloud key.

Backend-specific gaps relative to the broad master specification: scanned-document/image OCR, full text-to-speech/diarization/VAD on the server, multimodal AI chat, semantic/embedding retrieval, automatic semantic answer grading, automatic long-history abstractive summarization, rich company hiring data and public submission moderation, native PDF rendering/export, tax-compliant invoice issuance and refund initiation, application-level encryption at rest, dedicated malware/hostile-document isolation, email verification/MFA and a load/security audit. These are not represented as completed server features. Local client/browser/desktop workflows can cover some of them separately; the API's deterministic fallback and unavailable setup states remain useful without pretending those services exist.
