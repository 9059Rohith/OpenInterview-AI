# OpenInterview AI

An open-source interview preparation workspace with a local-first Next.js web app, an Electron desktop client and an optional FastAPI account service.

[Open the live workspace](https://openinterview-ai.vercel.app/workspace/) · [Desktop downloads](https://github.com/9059Rohith/OpenInterview-AI/releases) · [Validation and limitations](docs/VALIDATION.md)

**Light Mode** supports learning and practice. **Shadow Mode** supports visible, user-initiated transcription and assistance in permitted conversations. Recording and cloud processing always require user action. AI responses are fallible; this product does not guarantee hiring outcomes.

## Run the web app

Requirements: Node.js 22.12 or later and npm 10 or later.

```powershell
npm ci
npm run dev
```

Open http://localhost:3000. Guest work is saved on the current device. Configure a provider in the app for generated responses; personal API keys are not posted to the OpenInterview backend.

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Run the account API

Use Python 3.11 or later. Copy `.env.example` to a private local environment file, configure the database, cookie security and allowed origins in the process environment. Example environment files are not loaded automatically. See [API setup](docs/API.md) for supported variables and endpoints.

```powershell
cd services/api
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m alembic upgrade head
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

SQLite is suitable for local use. Production account storage requires persistent PostgreSQL. A serverless deployment without a configured database must fail closed for personal data rather than silently store it on an ephemeral filesystem.

## Desktop

Build the web export first, then `npm run build:desktop` and `npm run desktop`. `npm run dist:win` builds Windows NSIS and portable artifacts. See [desktop documentation](apps/desktop/docs/DESKTOP.md). macOS and Linux scripts require those hosts; availability is reported only after an artifact has been built. Community Windows builds are unsigned.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Public pages and persistent guest workspace |
| `apps/desktop` | Sandboxed Electron shell, encrypted vault and local model controls |
| `services/api` | Auth, owner-scoped data, optional providers and verified billing |
| `docs` | Specification, setup, threat model and verification evidence |
| `infrastructure` | Local PostgreSQL/API deployment support |

Read [feature status](docs/FEATURE_STATUS.md), [deployment](docs/DEPLOYMENT.md), [security](SECURITY.md), [privacy](docs/PRIVACY.md) and [contributing](CONTRIBUTING.md) before hosting a shared service. MIT licensed.

GitHub Actions definitions are supplied in `.github/workflow-templates/*.yml.example`. The publishing credential cannot activate workflows; a repository owner can copy them to `.github/workflows/` with the `.yml` extension. Local checks run independently of that account permission.
