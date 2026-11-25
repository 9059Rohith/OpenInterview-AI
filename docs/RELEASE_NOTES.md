OpenInterview AI 0.1.0 is an initial community release with a Next.js static web workspace, sandboxed Electron desktop client and optional FastAPI account service.

Includes Light Mode and visible Shadow Mode; local profiles/resume versions; PDF/DOCX import/export; document retrieval; user-selected image text extraction/explanation; original practice questions; mock interviews and transparent rubrics; coding sandbox and Mermaid design practice; study plans/flashcards/reports; persistent notes and mentor conversation memory; direct personal provider keys; OS-protected desktop credentials and encrypted SQLite; visible consented audio transcription; optional cloud/auth/billing/headshot adapters.

The web app is available at https://openinterview-ai.vercel.app. Source and setup documentation are in this repository. Only uploaded, existing release assets are downloadable; Windows packages are unsigned community builds. Check SHA256SUMS.txt before installation.

Validation includes browser workflows, actual account lifecycle against an isolated local API, database migration roundtrips, ownership/consent/payment signature tests, actual Electron isolation and real OpenAI/Ollama adapter checks. See docs/VALIDATION.md for exact evidence and limitations.

Public cloud accounts and paid checkout are not activated: persistent PostgreSQL, Google/SMTP and Razorpay credentials are still required. Multi-language server execution needs a separately isolated runner. Image/voice processing requires a configured supported provider and explicit consent. macOS/Linux artifacts, signing, a two-hour soak test and independent production security/load audits are not claimed. GitHub Actions definitions are provided as templates because the publishing credential cannot activate workflows.

Local tools work without a paid plan; generated answers require a configured model. Feedback and AI outputs can be wrong. No hiring outcome or perfect accuracy is promised.
