# Validation record — 2026-11-25

## Verified implementation

| Check | Observed result |
| --- | --- |
| Web typecheck and static build | Passed; final image-integrated export 42 pages |
| Web core unit tests | 20 passed: rubric, resume extraction signals, context selection, state validation, credential redaction and vision adapters/consent/cancellation |
| Web browser workflow suite | 10 passed together after fixes (39.1 seconds); actual PDF/DOCX import/export, onboarding/documents/mock/history persistence, mentor two-turn retrieval and memory, key nonpersistence, JavaScript cases and infinite-loop timeout, Mermaid editing, 390px mobile layout, malformed-data recovery, actual WebM recording with mocked direct transcription; selected-image consent, extraction/edit/save/privacy/clear/cancel |
| Actual browser/account API lifecycle | Passed using isolated loopback services and invented fixtures: registration, cookie session, onboarding, consented profile sync with CSRF, server persistence, authenticated reload, logout and session revocation; zero page errors |
| API core/integration suite | 40 passed, one opt-in live test skipped in default run; provider/OAuth/billing fixtures are explicitly mocked |
| Separate actual local inference | Real Ollama API integration passed with installed `qwen2.5:0.5b`, using an in-memory synthetic account and no cloud key |
| Database | Three reversible SQLite migrations upgrade/downgrade/reupgrade passed; Alembic reports no schema drift; PostgreSQL offline SQL generated. A live PostgreSQL server was not tested |
| Actual OpenAI text adapter | Synthetic prompt through desktop provider adapter: nonempty `gpt-4.1-mini` answer, 54 tokens, 5.74 seconds |
| Actual OpenAI audio adapter | Windows synthetic WAV recognized exactly as “What is an idempotent operation?” using `gpt-4o-mini-transcribe`, 2.004 seconds; no private microphone input |
| Actual local desktop adapter | Ollama generation returned nonempty text in 3.8 seconds; separate streaming test returned live chunks and cancellation after the first event |
| Desktop fixture suite | 27 passed, including all five streaming adapters, split UTF-8 boundaries, cancellation, encrypted records and vision validation |
| Actual OpenAI image bridge | Synthetic canvas text was correctly extracted through the actual renderer/main/vault OpenAI path in 2.051 seconds; no private screen capture or persisted source image |
| Actual Electron bridge/cloud streaming | Real renderer → validated IPC → OS vault → OpenAI streaming passed after aligning the credential setup helper with the real app profile; no key was rendered or logged |
| Electron shell and sandbox | Actual rendered dashboard, renderer Node isolation, malformed IPC rejection, DPAPI/SQLite roundtrip, CSP script rejection, worker execution and blocked network passed |
| Dependency audit | `npm audit --omit=dev` reported zero advisories after upgrading jsPDF, PDF.js and Mermaid |
| Public-source scan | Common credential patterns absent from tracked/unignored source; private keys/data remain outside the public source and build outputs |

Detailed browser/design evidence is in `apps/web/design/QA_DESIGN_REVIEW.md`. Desktop test/build evidence is in `apps/desktop/docs/VERIFICATION.md`. API test boundaries are in API.md. The image-integrated 42-page build and ten browser workflows passed. Final package results are appended below when their installed-app checks complete.

## Deployment checks

- Web: https://openinterview-ai.vercel.app — public HTML routes `/`, `/workspace/`, `/download/`, `/docs/`, `/privacy/` returned HTTP 200.
- API: https://openinterview-api.vercel.app — public health, capabilities, original question catalog and pricing returned HTTP 200. CORS explicitly permits the web origin.
- The public API intentionally reports `accountsReady:false`, `database:not configured`, and unavailable Google/billing/server inference. It does not store account data on an ephemeral serverless filesystem.
- Initial Vercel web configuration incorrectly combined its Next runtime preset with static `out`; the observed routes-manifest error was corrected by hosting the successful Next static export as a static project. This preserves the requested Next.js source.

## Limits of the evidence

Test adapters establish request/response and failure behavior, not live merchant/OAuth activation. Native device permissions, arbitrary meeting portals and long-running sessions have not been exhaustively tested. No two-hour soak test, independent penetration test, load test, macOS notarization or Linux installer verification is claimed. Small local models and deterministic rubric scores do not establish answer correctness.

Google/SMTP credentials, persistent cloud PostgreSQL, Razorpay merchant credentials/plans/webhook registration, server-owned cloud image/inference credentials and a separately audited multi-language code runner remain operator setup requirements. Windows community packages are unsigned. GitHub workflow activation is blocked by the publishing credential's missing `workflow` scope; workflow templates are supplied, while the actual validation above was run locally.
