# Shared implementation contract

## Monorepo and runtime

- Root npm workspaces: `apps/web` (Next.js, port 3000), `apps/desktop` (Electron). Independent Python API in `services/api`, port 8000.
- Web builds as Next.js static export (`output: 'export'`, `images.unoptimized: true`). Use catch-all/static route generation or query-selected workspaces so every advertised route exports correctly. All user data in guest/local mode persists in IndexedDB/local storage and remains fully functional without a server.
- Cloud API base is configured by `NEXT_PUBLIC_API_URL`; when absent, no fake cloud-sync or paid-service claims. Public deployment must be immediately usable as a local-first app.
- Use original sample profiles/questions clearly labeled illustrative; never embed the user's private resume, chat logs or API key.

## Desktop bridge

`window.openInterviewDesktop` is optional and feature-detected. Expose `platform`, `version`, `getCapabilities()`, `vaultStatus()`, `setCredential(provider,key)`, `removeCredential(provider)`, `providerRequest({provider,model,messages,...})`, `ollamaStatus()`, `ollamaModels()`, `ollamaPull({model})`, `ollamaRemove({model})`, `ollamaGenerate({model,prompt})`, `chooseFile({extensions})`, `exportFile({name,content,mime})`, `getApiStatus()`, `onEvent(callback)` with disposer. Desktop agent may adjust names only by notifying web agent and coordinator. No arbitrary shell, filesystem, URL or IPC access.

## Provider handling

- Browser BYOK keys stay in memory and are sent only directly to the selected provider origin. Never serialize a BYOK key or post it to our backend. Desktop uses its credential bridge. Server-configured provider keys are a separate optional service, authenticated and quota-limited.
- Providers: OpenAI, Gemini, Claude, compatible, Ollama. Capabilities and configuration states must be explicit. Default workspace is usable without a key via original question/teaching material, local notes/plans, deterministic practice rubrics and local runtime setup.
- AI output is labeled AI-generated. Missing provider setup is a useful state, never fabricated model output.

## Core entities

IDs are UUID strings; dates ISO-8601. `Profile {id,name,role,experience,language,companies:string[],skills:string[],education:[],projects:[],resumeText,consentCloud:boolean}`. `Document {id,name,type,text,createdAt,updatedAt}`. `Session {id,title,mode:'Light Mode'|'Shadow Mode',category,company,role,difficulty,status,createdAt,updatedAt,turns:Turn[],notes,archived:boolean}`. `Turn {id,speaker:'user'|'assistant'|'transcript',text,createdAt,evaluation?}`. `Question {id,company,role,topic,difficulty,question,expectedConcepts:string[],sampleAnswer,followUps:string[],source:{title,url,collectedAt,confidence},original:boolean}`. `Roadmap {id,title,items:{id,topic,dueDate,completed}[]}`. `ProviderConfig {provider,model,baseUrl?,configured:boolean}` contains no secret.

## API routes

All routes prefixed `/api/v1` except `/health`. API returns JSON with clear validation errors.

- `GET /capabilities`: runtime/integration readiness, no secrets.
- `POST /auth/register {email,password,name}`; `POST /auth/login {email,password}`; `POST /auth/logout`; `GET /auth/me`; `GET /auth/google/start`; `GET /auth/google/callback`; `GET/DELETE /auth/devices/{id?}`.
- `GET/PUT /profile`; `GET/POST /documents`; `GET/PUT/DELETE /documents/{id}`; `POST /documents/extract` multipart file; `POST /resumes/analyze {text,job_description?}`; `GET/POST /resumes`; `GET/PUT/DELETE /resumes/{id}`.
- `GET /questions` filters topic/company/role/difficulty/search; `POST /questions` user submissions; `POST /questions/{id}/report`; `GET /companies`.
- `GET/POST /sessions`; `GET/PATCH/DELETE /sessions/{id}`; `POST /sessions/{id}/turns`; `POST /sessions/{id}/summary`; `GET /sessions/{id}/export`.
- `GET/POST /roadmaps`; `PATCH /roadmaps/{id}`; `GET /reports`.
- `GET /providers`; `GET /providers/{provider}/models`; `POST /ai/generate` optional server-configured provider, never accept BYOK credentials; `POST /speech/transcribe` explicit user audio with consent.
- `GET /billing/plans`; `GET /billing/status`; `POST /billing/checkout`; `POST /billing/verify`; `POST /billing/webhook`; `POST /billing/cancel`; `GET /billing/history`.
- `POST /coding/run {language,code,stdin,tests?}` via configured isolated service/container only; returns unavailable when secure execution absent. Web can run JavaScript/Python in an isolated browser sandbox instead.
- `GET /context/stats`; `POST /context/optimize {query,documents,budget}`; `GET /observability/summary` authenticated and sanitized.

Backend can add endpoints to complete functionality and document additions. Web must work in guest mode independently, with optional explicit account/sync integration using the endpoints above. No personal keys or unconsented documents go to a cloud server.
