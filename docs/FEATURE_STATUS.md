# Feature status

This file tracks verification rather than marketing claims. The core application builds and has passed the workflow checks in VALIDATION.md. Optional external service activation remains distinct from implemented/tested adapters.

| Area | Intended working path | External readiness boundary |
| --- | --- | --- |
| Light Mode | Device-local learning, questions, profile, mocks, resume, plans and history | Generated responses require a configured provider/model |
| Shadow Mode | Visible start/stop transcription, context and notes | Browser/OS microphone support and participant permission |
| Documents/resume | PDF/DOCX import, editable content, analysis, export | Parsing quality depends on source document |
| Selected screenshots/images | Explicit upload, preview, AI-assisted text extraction/explanation and saved searchable text | Requires a supported vision provider and consent; not offline OCR |
| Companies/questions | Original educational catalog, filters and source/confidence labels | No claim of leaked or guaranteed company questions |
| Coding | Constrained execution and review | Server execution needs isolated runner |
| System design | Structured practice and Mermaid | Generated critique needs configured AI |
| Providers | Direct browser BYOK or desktop vault | Actual provider key/model availability; no bundled shared key |
| Local AI | Ollama status/models/control | Runtime/model must exist locally |
| Cloud auth/data | API adapters, ownership and migration tests | Persistent PostgreSQL and auth configuration |
| Google OAuth | PKCE adapter and failure tests | Client credentials/redirect registration |
| Billing | Checkout, verified signatures, idempotency and cancellation adapters | Merchant credentials and live subscription activation |
| Context optimization | Modular budget/retrieval/dedup pipeline | Not represented as Headroom itself |
| Observability | Sanitized local/API metrics | Not represented as an installed external LogLens service |
| Desktop | Sandboxed Windows build | Signing, Mac/Linux builds need external platform setup |

No hidden recording, screen-sharing evasion, process disguise or monitoring bypass is implemented. The original question catalog is educational material, not a claim of verified employer interview reports. See API.md for backend-specific advanced features that remain outside the verified release, and VALIDATION.md for exact test and deployment results.

AI evaluation is guidance, not objective proof of skill. No two-hour reliability claim is made without a two-hour soak test.
