# OpenInterview AI implementation plan

Build an independent, local-first interview-preparation product. Preserve the existing Aster installation and private resume/credential data. Light Mode and Shadow Mode are the only mode names. All listening, screenshot input and cloud processing require visible user initiation.

1. Establish shared data contracts and a feature/status matrix from the master specification.
2. Build the original Next.js/React web application: public pages, guest onboarding, persistent profile/documents, resume tools, question bank, company preparation, teaching, mocks, coding/design labs, roadmaps, notes/history, provider settings and billing/device controls.
3. Build FastAPI/Pydantic/SQLAlchemy APIs and Alembic migrations for account-owned data, Google OAuth PKCE, rate limits, quotas, verified/idempotent billing, provider capabilities, context budgets and isolated runner adapters. SQLite supports local use; PostgreSQL configuration and Docker deployment support cloud use.
4. Build a visible Electron desktop client with sandboxed renderer, validated IPC, encrypted credential storage, explicit microphone/audio handling and local Ollama management. Generate only installers that the available host can build and verify.
5. Exercise core flows locally, test failure and authorization cases, compare the actual UI to generated concepts, and repair observed issues.
6. Publish source and usable deployment, verify public URLs and deployment flows, and report external-service blockers precisely. Do not expose private candidate data, API credentials, misleading integrations or nonexistent downloads.

## Ownership boundaries

- Web implementation owns `apps/web/**` and web-specific tests. Its local-first data layer must not depend on cloud availability.
- API implementation owns `services/api/**`, API tests and backend migrations. Shared resources must be owner-scoped. BYOK keys must never be posted to our backend.
- Desktop implementation owns `apps/desktop/**` and desktop tests/builds. It hosts the same built web UI and exposes a narrow bridge; no stealth features.
- Coordinator owns root configuration, shared contracts/question data, integration, deployment, status documentation and final verification.

## Verification policy

Run meaningful tests for the implemented workflows, rerun after fixes, then test the deployed build. Credential-gated OAuth, provider, payment and image operations require tested adapters and an honest setup state when live credentials are absent. No cloud-local AI or cross-platform signing claims without evidence.
