# Google sign-in setup

The API implements Google's authorization-code flow with an S256 PKCE challenge, a browser-bound HttpOnly state cookie, and an atomic, ten-minute, single-use state record. Google access tokens are exchanged server-side and used only to fetch Google's HTTPS UserInfo endpoint; they are never sent to the frontend or stored. Sessions use random cookie tokens whose hashes are stored in the database, with a separate session-bound CSRF token for writes.

Google sign-in is available only when durable account storage and both Google client credentials are configured. A public deployment without `DATABASE_URL` serves the public catalog and reports `accounts=false` and `googleOAuth=false`; authentication returns HTTP 503. Adding a visible button does not activate Google OAuth.

## Required deployment configuration

Create an OAuth client of type **Web application** in your own Google Cloud project. Configure the consent screen and allowed users according to the project's publishing state. Register the API's exact callback URL as an authorized redirect URI, including its scheme, hostname, and path. Google documents the [web-server authorization flow and redirect requirements](https://developers.google.com/identity/protocols/oauth2/web-server).

Set these server environment variables in the API deployment's production environment:

| Variable | Value |
| --- | --- |
| `APP_MODE` | `cloud` |
| `DATABASE_URL` | Durable PostgreSQL connection URL, stored as a secret |
| `COOKIE_SECURE` | `true` |
| `ALLOWED_ORIGINS` | Exact HTTPS frontend origin, with no wildcard or trailing path |
| `FRONTEND_URL` | Canonical HTTPS frontend URL |
| `GOOGLE_CLIENT_ID` | The web application's Google client ID |
| `GOOGLE_CLIENT_SECRET` | The matching client secret, stored as a secret |
| `GOOGLE_REDIRECT_URI` | `https://openinterview-ai.vercel.app/api/v1/auth/google/callback` for the production frontend API proxy |

Never put the client secret or database URL in frontend environment variables, browser storage, source control, public screenshots, or chat. Apply the committed Alembic migrations to PostgreSQL before serving account requests. `AUTO_MIGRATE=true` currently runs migrations on startup; production operators may run migrations as a controlled deployment step and then set it to `false`.

The production frontend forwards `/api/:path*` to the API service. Set `FRONTEND_URL` and `ALLOWED_ORIGINS` to `https://openinterview-ai.vercel.app`, configure the frontend's API URL to that same origin, and register `https://openinterview-ai.vercel.app/api/v1/auth/google/callback` in Google Cloud. Both the OAuth start and callback then pass through the frontend host; host-only cookies are set on that host and the browser avoids third-party cookie restrictions. The callback registered in Google must match `GOOGLE_REDIRECT_URI` exactly, even though the backend itself has a separate deployment hostname.

The configured frontend origin must match the browser's actual origin. Preview deployment hostnames are different origins and need their own reviewed configuration. For direct separate frontend/API hosts, cloud session cookies use `SameSite=None; Secure`; browser third-party-cookie restrictions can still prevent cross-site sessions. A custom same-site API hostname or reverse proxy is preferable. A direct API deployment may instead register its own `https://<api-host>/api/v1/auth/google/callback`, provided the browser can retain the API cookie.

## Local development

Use local settings with SQLite, frontend `http://localhost:3000`, API `http://localhost:8000`, and an explicitly registered local redirect URI `http://localhost:8000/api/v1/auth/google/callback`. Local HTTP cookies use `SameSite=Lax` and may use `COOKIE_SECURE=false`. Credentials remain server-side. Use your own Google development client; test placeholders do not activate sign-in.

## Account identity and collision handling

The API requires a boolean `email_verified=true`, a valid email, and a nonempty Google `sub`. The `sub` is the permanent Google identity; subsequent logins retain the same application account even when the Google email changes. This follows Google's [OpenID Connect identity guidance](https://developers.google.com/identity/openid-connect/reference).

A Google login whose email matches an existing password account returns HTTP 409 and preserves the existing login. The API does not silently merge accounts. Sign in using the original method; adding account linking later requires a separate, explicitly authorized flow that proves control of both identities. Google-only accounts recover through Google and do not gain a password through application email recovery.

## Verification

1. Redeploy after setting the real configuration. Confirm `/health` reports `accountsReady=true` and `/api/v1/capabilities` reports `googleOAuth=true`.
2. Start from the deployed frontend. `/api/v1/auth/google/start?format=json` returns a Google authorization URL; the request must include credentials so the state cookie is retained.
3. Complete Google's consent screen in the same browser. Success redirects to the configured frontend `/login/`, where the frontend can fetch `/api/v1/auth/me` with credentials.
4. Confirm session cookies are Secure and the session cookie is HttpOnly. Fetch `/api/v1/auth/csrf` before authenticated mutations. Confirm logout/revocation invalidates the session.
5. Confirm another browser cannot reuse the state, a second callback fails, and a verified email collision does not link accounts.

The regression suite uses a mocked Google transport and synthetic identities. It validates PKCE, state binding and replay protection, malformed claims, account collisions, stable subject identity, session rotation, CSRF, cloud storage gating, and OAuth limits. It does not prove a real Google Cloud client or the production PostgreSQL deployment has been configured. Run `python -m pytest -q` from `services/api` for the complete backend suite.

Callback failures return sanitized JSON rather than a frontend redirect: HTTP 400 for invalid/expired/missing state or unverified claims, 409 for existing-email collisions, 429 for rate limits, 502 for Google exchange failures, and 503 for missing deployment configuration. Restart sign-in after a failed or canceled exchange because valid state is consumed once.
