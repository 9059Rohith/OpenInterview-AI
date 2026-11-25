# Deployment

The web app is a Next.js static export: run `npm ci`, `npm run build:web`, then host `apps/web/out`. Keep private environment files and databases out of the output. `NEXT_PUBLIC_API_URL` is optional and must reference an HTTPS API in production. No secret belongs in a `NEXT_PUBLIC_` variable.

The FastAPI service includes a Vercel entry point in `services/api/api/index.py`. A public API with no production database can serve nonpersonal capability/catalog endpoints, but personal account operations must report unavailable. Configure PostgreSQL via `DATABASE_URL`, run Alembic migrations, set `APP_ENV=production`, `COOKIE_SECURE=true` and a restricted `CORS_ORIGINS` allowlist before enabling account storage.

Optional integrations:

| Service | Setup required |
| --- | --- |
| Google sign-in | OAuth client/secret, allowed callback URI and consent-screen configuration |
| Razorpay | Account keys, webhook secret, correct subscriptions/plans and signed webhook endpoint |
| Hosted AI | Operator-owned server keys plus quotas, or each user's direct BYOK |
| Local AI | Official Ollama runtime and an explicitly downloaded model on the user's computer |
| Secure code runner | Separate isolated execution service; Docker daemon required for container execution |
| Headshots | Explicit image-provider configuration and user consent |
| Desktop signing | Platform certificates and platform-native CI runners |

Never test live billing by charging a real card. Test adapters and signature tests validate logic; they do not establish live merchant activation. Do not advertise Mac/Linux downloads until those artifacts have been built. Windows community packages are unsigned.

`infrastructure/compose.yaml` runs PostgreSQL and the API locally. Supply a private `.env` with a strong database password. This is an operator development recipe, not a public production ingress or backup solution.

The deployment record and feature status document record what was actually checked in this environment. Credentials and database URLs must never be copied into that record.

The authenticated GitHub credential rejected publication of active workflow files because it lacks the `workflow` scope. Definitions are retained as `.github/workflow-templates/*.yml.example`; no broader credential permission was granted. Activating Actions requires the repository owner to place them in `.github/workflows/` using an appropriately authorized account. Platform builds are not advertised as CI-verified merely because these templates exist.
