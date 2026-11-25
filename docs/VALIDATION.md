# Validation record — 2026-11-25

## Security hardening 0.4.1 — 2026-11-26 IST

Production build and TypeScript checks pass. Final unit suites pass: 74 web and 48 desktop tests. Backend full suite passes 63 tests with one opt-in local-inference test skipped. Five focused mock-account/diagram browser flows pass. Regression evidence covers stale session-cookie replay, concurrent one-use token consumption, unsafe OAuth redirects, compatible-key origin changes, realtime ID reuse, streaming response limits and corpus bounds. Historical Git credential-pattern scan checked 291 blobs and found no matches for the scanned key patterns.

Production npm dependencies report zero advisories. Resolved API requirements audit covered 35 Python distributions with no known vulnerabilities. Full npm audit retains six build-tool dependency entries from the minimatch advisory; see SECURITY_REVIEW.md. Google OAuth credentials and a production database remain absent; real Google sign-in has not been activated or tested. The same-origin frontend API proxy and production secure-cookie configuration are prepared.

The complete 25-workflow Chrome suite passed against the canonical live frontend, including synthetic Google authorization/session responses, hostile OAuth redirects, isolated diagram images, audio restart/cancellation, context and response memory. Initial failures exposed two stale test assumptions: restart readiness counted stopped streams, and the older diagram test expected inline SVG text. Updated assertions require newly active PCM streams and a decoded, successfully loaded diagram image. These were test-only corrections; deployed runtime code and installer bytes were unchanged.

Both production deployments at runtime commit `ff772a6` are ready. Public frontend, repository, same-origin capabilities and API health returned HTTP 200; health honestly reports degraded accounts without PostgreSQL. Windows 0.4.1 setup exited 0; read-only installed checks preserved the resume, four projects, 2608 private project sources and previous responses. Installed full-monitor capture differential again passed at 1920×1200 (marker ratios 1 / 0 / 1; underlying synthetic background 1 while protected). The installed app was relaunched normally without starting capture. This does not establish capture exclusion for every portal.

Installer `OpenInterview-AI-0.4.1-win-x64-setup.exe`: 125,857,430 bytes, SHA256 `d1aa169a0e81414dd0be6d570e00586f520a5295823a0d66566ef9bf40d9e9b3`. GitHub's uploaded asset digest matched the local file. The community installer remains unsigned.

## Automatic grounded answers 0.4.0 — 2026-11-26 IST

- Final PC questions enter a bounded FIFO after a 180 ms delay. Questions arriving during generation wait for the current answer; short follow-ups, duplicate turn IDs, repeated questions with distinct IDs, microphone opt-in, cancellation and session changes have dedicated coverage. Auto/context/memory settings persist; recording never starts automatically.
- All 70 web unit tests, 40 desktop unit tests and 20 Chrome workflows pass. Production build and both TypeScript workspaces pass. Private retrieval uses encrypted SQLite shards and returns at most 6500 source characters per query, while answer prompts separately reserve resume and conversation memory budgets.
- The real-provider desktop E2E sent synthetic PC speech through the actual AudioWorklet, realtime transcription, native private-source retrieval and OpenAI answer streaming. A project-specific answer used a synthetic private code fact, a spoken “Why?” used the first answer, and a fresh session after reload received that earlier response. Observed finalized-question→first-answer-token latency was 2327 ms, including local retrieval and the external provider. No physical microphone was opened.
- Windows setup exited 0 and installed version 0.4.0. All 318 installed web files match the tested export. Read-only checks confirmed the private resume, four project corpora, earlier Aster responses, enabled auto/context/memory preferences and a configured OpenAI answer model. Personal contents remain outside this repository and public build outputs; an encrypted workspace backup precedes import.
- The installed full-screen capture A-B-A test passed again (marker ratios 1.0 / 0.0 / 1.0; underlying synthetic background 1.0 while protected). This is the tested Windows full-monitor capture path, not a guarantee for every portal.

## Realtime audio 0.3.0 — 2026-11-26 IST

- Desktop capture now uses AudioWorklet 20 ms PCM16 packets at 24 kHz mono, separate PC/MIC realtime connections, `gpt-live-transcribe`, Aster's RMS .005 threshold, 300 ms preroll, 700 ms silence commits and 18-second turn limit. No MediaRecorder or four-second file gate is used by the desktop realtime path. Browser file transcription remains separately labeled.
- Typechecks and the complete production build pass. All 56 web unit tests, 38 desktop unit tests and 17 browser workflows pass. New coverage includes real-worklet resampling at 44.1/48/96 kHz, interleaved sources, readiness/queue limits, deltas before commits, out-of-order finals, consent, cancellation, repeated start/stop and stop-time drains.
- `tests/desktop/realtime-live.mjs` sent only synthetic Windows TTS PCM through the real vault-backed OpenAI transport. PC/MIC first partials arrived in 1917/2001 ms before manual commit; both final transcripts returned without error. This establishes actual provider streaming, beyond mocked sockets.
- `tests/desktop/realtime-ui.mjs` tested the full actual AudioWorklet→Electron IPC→OS vault→OpenAI desktop path. First partials arrived in 1486 ms (PC) and 1441 ms (MIC); automatic finalization returned both labeled transcripts. A repeated PC utterance with trailing silence trimmed was finalized by Stop, all capture tracks ended, and no MediaRecorder was constructed. Synthetic fixtures alone were uploaded; no private screen, microphone or candidate data was used.
- Observed latency depends on speech, server and network. Removing the fixed four-second batch wait does not imply zero latency. Existing screen-share protection and native window controls remain in place; installed-version checks are recorded after installation.
- Windows setup completed with exit 0; product/file version is 0.3.0. All 318 installed web files exactly match the tested export, including the PCM worklet. `tests/desktop/realtime-installed.mjs` verified the installed packaged bridge, vault and real provider with first partials at 1561 ms (PC) and 1636 ms (MIC), correct final transcripts, no errors and unchanged workspace history. The installed 0.3.0 overlay also passed full-monitor capture exclusion again: marker ratios 1.0 / 0.0 / 1.0, underlying synthetic desktop ratio 1.0 while protected.

## Shadow 0.2.0 follow-up — 2026-11-26 IST

- Frozen production build and both TypeScript workspaces pass. Web 44/44 and desktop 30/30 tests pass. All 15 Chromium browser workflows pass together in 59 seconds, including five new Shadow parity workflows and the original ten workflows.
- Actual Windows full-monitor WebRTC capture differential passes on the final source: 1920×1200, marker ratios unprotected 1.0 / protected 0.0 / unprotected again 1.0; underlying synthetic desktop ratio 1.0 with protection. This tests real capture output, not only the requested flag. See SHADOW_ASTER_PARITY.md and `tests/desktop/screen-share.mjs`.
- Real Chromium MediaRecorder/AudioContext synthetic PC/MIC files decode independently; audio-only recorder tracks, immediate capture release and no late uploads pass (`tests/desktop/audio-codec.mjs`).
- Actual sandboxed Electron + installed local Ollama streams a nonempty answer; Stop saves its partial response. Native close preserves the latest typed notes and completed session in encrypted SQLite, reloads Light, reopens Shadow from Light, and completes the coordinated Quit handshake (`tests/desktop/shadow-integration.mjs`). Uses an isolated profile and synthetic candidate data.
- Native smoke additionally verifies 10 shortcuts, mouse interaction recovery, all resize directions, DPI bounds stability, topmost, settings persistence and same-origin impostor IPC rejection. Small 560×440 and 390px layouts have no observed horizontal overflow or notes/form overlap.
- The 0.2.0 Windows setup completed with exit code 0 and installed product/file version 0.2.0. The same full-monitor capture differential then passed against the **installed packaged executable**, through normal Light→Shadow UI routing, with the same 1.0 / 0.0 / 1.0 marker ratios. Original window bounds were restored afterwards. Set `OPENINTERVIEW_INSTALLED_EXE` to run that test variant; it uses the normal local workspace without exporting its data.
- These checks do not constitute every meeting portal, all displays, actual private microphone testing, a two-hour soak or universal screen-capture invisibility. Aster realtime PCM/WASAPI and this implementation's four-second complete-file transcription differ.
- The matching web build reached Vercel READY from commit `082c25b53f22bb31fe7f7033070cc91d6ac068e8`, and all 15 workflows passed again against `https://openinterview-ai.vercel.app` in 2.2 minutes. Source is tagged `v0.2.0`; the Windows setup was uploaded with a GitHub SHA-256 digest matching local `18c318934daf5e54c7b1f5d3acb2f4557fdf3d77f3f8cf4bfb6d7251566f495a`.

## Verified implementation

| Check | Observed result |
| --- | --- |
| Web typecheck and static build | Passed; final image-integrated export 42 pages; conventional Python/TypeScript downloads also verified |
| Web core unit tests | 20 passed: rubric, resume extraction signals, context selection, state validation, credential redaction and vision adapters/consent/cancellation |
| Web browser workflow suite | 10 passed together after fixes (39.1 seconds); actual PDF/DOCX import/export, onboarding/documents/mock/history persistence, mentor two-turn retrieval and memory, key nonpersistence, JavaScript cases and infinite-loop timeout, Mermaid editing, 390px mobile layout, malformed-data recovery, actual WebM recording with mocked direct transcription; selected-image consent, extraction/edit/save/privacy/clear/cancel |
| Actual browser/account API lifecycle | Passed using isolated loopback services and invented fixtures: registration, cookie session, onboarding, consented profile sync with CSRF, server persistence, authenticated reload, logout and session revocation; zero page errors |
| API core/integration suite | 41 passed, one opt-in live test skipped in default run; provider/OAuth/billing fixtures are explicitly mocked |
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

Detailed browser/design evidence is in `apps/web/design/QA_DESIGN_REVIEW.md`. Desktop test/build evidence is in `apps/desktop/docs/VERIFICATION.md`. API test boundaries are in API.md. The image-integrated 42-page build passed. All ten browser workflows passed locally and again against the public production deployment (1.1 minutes). Final package results are appended below when their installed-app checks complete.

## Deployment checks

- Web: https://openinterview-ai.vercel.app — public HTML routes `/`, `/workspace/`, `/download/`, `/docs/`, `/privacy/` returned HTTP 200.
- API: https://openinterview-api.vercel.app — public health, capabilities, original question catalog and pricing returned HTTP 200. CORS explicitly permits the web origin.
- The public API intentionally reports `accountsReady:false`, `database:not configured`, and unavailable Google/billing/server inference. It does not store account data on an ephemeral serverless filesystem.
- Initial Vercel web configuration incorrectly combined its Next runtime preset with static `out`; the observed routes-manifest error was corrected by hosting the successful Next static export as a static project. This preserves the requested Next.js source.

## Limits of the evidence

Test adapters establish request/response and failure behavior, not live merchant/OAuth activation. Native device permissions, arbitrary meeting portals and long-running sessions have not been exhaustively tested. No two-hour soak test, independent penetration test, load test, macOS notarization or Linux installer verification is claimed. Small local models and deterministic rubric scores do not establish answer correctness.

Google/SMTP credentials, persistent cloud PostgreSQL, Razorpay merchant credentials/plans/webhook registration, server-owned cloud image/inference credentials and a separately audited multi-language code runner remain operator setup requirements. Windows community packages are unsigned. GitHub workflow activation is blocked by the publishing credential's missing `workflow` scope; workflow templates are supplied, while the actual validation above was run locally.

## Installed Windows application

The final NSIS installer completed with exit code 0 in the new per-user `Programs/OpenInterview AI` directory. All 316 installed web files matched the tested final export (tree SHA256 `938314728b0be98733aef1db060e1745fec13c10f5a4c92423eddce1ef4a396f`). Product name is OpenInterview AI, version 0.1.0.0; the community executable is unsigned.

Installed-app smoke exited 0: hydrated dashboard, Node isolation, invalid IPC rejection, DPAPI and encrypted SQLite roundtrips, CSP enforcement and isolated coding runner passed. Actual local inference emitted 39 chunks and cancellation worked; actual OpenAI streaming emitted three chunks in 2.124 seconds; synthetic image text extraction passed in 1.862 seconds. No private microphone or screen content was recorded.

Installer: `OpenInterview-AI-0.1.0-win-x64-setup.exe`, 125,751,249 bytes, SHA256 `c14d98515fc030af1ca77423da107ef30ea21a4ec5f4008967d844c1c19cada0`. Portable: `OpenInterview-AI-0.1.0-win-x64-portable.exe`, 115,822,363 bytes, SHA256 `bedb600d42fe2b8444002689320cb493585de88c6152a5ccae8c3bef598cbaee`; its actual launcher smoke exited 0. Sanitized native evidence is in `apps/desktop/docs/WINDOWS_SMOKE.json`.

Both binaries are published in the v0.1.0 release. GitHub's server-side SHA256 digests match the local files; public download HEAD requests returned HTTP 200 with exact sizes. SHA256SUMS.txt is publicly downloadable, and the live download page lists both real Windows files while listing no nonexistent Mac/Linux packages.

The installed application was relaunched on its dashboard; its visible native window and Start Menu shortcut were verified. No capture or conversation session was started. Later default-branch documentation commits record final artifact verification; the version tag preserves the runtime code freeze.
