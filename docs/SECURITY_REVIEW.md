# Security review and action plan — 2026-11-26

This is a targeted source review with regression tests and dependency scans, not an independent penetration test or a guarantee of security. Candidate resumes, private project sources, transcripts and API keys were not used as security-test fixtures or published.

## Findings and changes

| Priority | Finding | Status and evidence |
| --- | --- | --- |
| P1 | A compatible-provider URL imported/edited after key connection could reuse that key at a different origin. | Fixed: browser credentials bind to the explicitly approved origin; tests verify zero requests after origin changes. |
| P1 | Browser sessions preceding registration or Google sign-in were not revoked. A captured old cookie still authenticated. | Fixed: shared session rotation. Original-code regressions returned 200; patched cases require 401. |
| P1 | OAuth state and recovery-token consumption used separate reads/writes, permitting concurrent consumption. | Fixed: atomic database DELETE/UPDATE RETURNING. PKCE/browser state already limited OAuth replay; this finding alone is not proof of account takeover. |
| P1 | Reusing a realtime request ID during cancel/restart could let old asynchronous cleanup remove the replacement session from tracking. | Fixed: identity-aware owned-session registry, including crash/reload cancellation regressions. |
| P1 | Provider JSON, transcription and vision buffered entire response bodies before enforcing size limits. | Fixed: streaming byte limits cancel readers, including an endless-response regression. |
| P2 | A corrupted/local-renderer-created project corpus could synchronously expand hundreds of MB. | Fixed: aggregate 32M-character / 20,000-source bounds and metadata validation. Current private corpus fits; no stored data was modified. |
| P2 | Diagram preview injected generated SVG markup into the document. | Hardened: isolated image rendering and bounded diagram input, with an injection-shaped regression. No successful pre-fix XSS exploit is claimed. |
| P2 | Google readiness was hidden when storage was absent, and authorization URLs were trusted too broadly. | Fixed: visible configuration status; Google HTTPS, callback-origin, authorization-code and PKCE checks; token-bearing redirects rejected. |
| P2 | Cloud secure-cookie validation depended on database environment configuration. | Fixed: secure cookies required in cloud mode; account persistence still fails closed without PostgreSQL. Production cookie configuration was explicitly updated. |
| P2 | esbuild development-server Windows path traversal advisory. | Updated direct build dependency to 0.28.2. [Upstream advisory](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr). This app does not use esbuild's development server for production serving. |

## Google sign-in activation

The web authorization flow and synthetic Google integration are implemented. **Live Google sign-in is not activated**: this deployment has no production PostgreSQL URL, Google client ID or Google client secret. Missing account storage returns unavailable rather than creating temporary personal accounts.

The web deployment proxies `/api/:path*` to the API, so account and OAuth cookies can use the frontend host instead of relying on third-party cookies. Required Google callback:

`https://openinterview-ai.vercel.app/api/v1/auth/google/callback`

The operator must register an owned Google web client, securely configure `DATABASE_URL`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, migrate PostgreSQL, and complete one real browser sign-in/logout/replay test. Public redirect/cookie configuration is prepared. Follow [GOOGLE_AUTH_SETUP.md](GOOGLE_AUTH_SETUP.md). Never paste client secrets into public source, browser fields or chat. Desktop Google browser handoff requires its own native-client/callback implementation; it is not claimed by the web flow.

## Remaining work, in order

1. **P1 — Activate and verify production account infrastructure.** Configure the secrets and PostgreSQL above; verify TLS, account ownership, cookie/CSRF behavior, recovery and database backups using synthetic users. If using a database service with browser APIs, deny anonymous table access or enable appropriate row policies.
2. **P2 — Packaging dependency advisory.** Full npm audit still reports six development dependency entries derived from one minimatch advisory in electron-builder's packaging tree. Production npm dependencies have no reported advisories. Replace or patch that toolchain only with a verified packaging-compatible version; do not apply npm's suggested major downgrade blindly. [Upstream minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).
3. **P2 — Tighten deployment policy.** Add a tested per-page script CSP for the static export, lock Python deployment dependencies/hashes, gate CI on security tests and audits, and review dependency alerts regularly. Existing CSP already restricts framing/object/base behavior but is not a complete script execution policy.
4. **P2 — Desktop distribution and authentication.** Sign platform installers, review updater provenance, implement the native Google browser/callback handoff before enabling desktop Google accounts, and migrate deprecated safeStorage calls before changing the pinned Electron major.
5. **P2 — Independent verification.** Run an external penetration test and production abuse/load tests before describing the service as independently audited. Review proxy-aware authentication rate limits and log retention without storing private prompts or credentials.

## Verification boundaries

- Backend security suite: 63 passed, one opt-in local inference test skipped; Google upstream calls are mocked, with PKCE, browser binding, concurrent one-use operations, identity collisions and session rotation tested.
- Focused web review: 74 unit tests and five mock-account/diagram browser flows passed before final integration testing.
- Desktop review: 48 unit tests and TypeScript passed, including session-ID reuse, infinite responses and malformed corpus metadata.
- Dependency scans: production npm audit reports zero advisories; resolved API requirements scan covers 35 Python distributions with no known vulnerabilities. Full npm audit retains the packaging-tree advisory above. These are point-in-time scans of tested dependency resolutions, not proof about every future installation or deployed dependency.

Final build, deployment and installed-application verification results are recorded in [VALIDATION.md](VALIDATION.md).
