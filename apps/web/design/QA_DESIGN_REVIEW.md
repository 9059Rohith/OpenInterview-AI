# Web implementation and visual review

## Evidence and comparison

The original built-in Image Gen concepts are `dashboard-concept.png` and `landing-concept.png`. The standalone generated preparation illustration is `../public/preparation-staircase.png`. Current browser captures are `browser-dashboard.png`, `browser-landing.png`, `browser-mobile.png` and `browser-design.png` in this directory.

Both concept images and both final desktop browser captures were opened with `view_image` and compared directly. The implementation retains the neutral near-black canvas, chartreuse accent, quiet hairline borders, diamond brand, editorial headline, rising paper illustration, three dashboard actions, right preparation/focus rail, broad question panel, paired product modes and code-native product preview. The landing page expands into the required capability, local-AI, pricing, FAQ and open-source sections without compressing all content into the concept's single screenshot. Required company/reports/provider/profile navigation adds items to the conceptual sidebar. Every number in the implemented dashboard is derived from actual local activity.

Intentional copy corrections preserve the product contract: original educational questions are described as original rather than verified real-company questions; Shadow Mode is transparent and permitted-use, with its preview explicitly showing microphone off; paid services are described as configuration-dependent. AI output and deterministic rubric signals carry distinct labels.

Desktop screenshots were captured at 1536 × 1024; mobile at 390 × 844. Browser tests found and fixed a real min-content overflow in the mobile coding problem panel. The latest mobile measurement is `scrollWidth = innerWidth = 390`. No page runtime errors were observed in the inspected dashboard/design/landing flows. Mermaid rendering, including subsequent source edits, was inspected visually and exercised automatically.

## Verification

- `npm run build --workspace=@openinterview/web`: successful Next.js 16.4.6 static export, 41 pages. Final export configured `NEXT_PUBLIC_API_URL=https://openinterview-api.vercel.app`.
- `npm run typecheck --workspace=@openinterview/web`: passed, also checked during the production build.
- `npm run test --workspace=@openinterview/web`: 12 passing substantive unit tests for parsing, provenance, rubric bounds/semantics, context budgeting/deduplication, interview sequencing, resume matching, fixed provider origins, empty initial state, nested backup validation and memory-key expiry.
- `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e --workspace=@openinterview/web`: Chrome used because the Chrome DevTools browser tool was blocked by an existing profile lock and the newly installed Playwright expected a missing headless-shell revision. Existing installed Chrome avoided an unnecessary browser download.
- Eight complete flows passed together in 22.6 seconds: profile/document/mock/history persistence; actual JavaScript test execution and infinite-loop timeout; question filters/bookmark/roadmap/Mermaid edits; Shadow Mode no automatic capture and manual transcript; mobile navigation/theme/public pricing; two mentor responses with persistent conversation retrieval and no serialized key; actual PDF/DOCX browser parsing and PDF export; malformed saved-data recovery without overwriting original data.
- A ninth focused browser test passed in 9.7 seconds: a real MediaRecorder WebM chunk from a synthetic oscillator audio stream was produced, direct OpenAI transcription was mocked at the provider boundary, the returned transcript appeared, and explicit stop restored microphone-off state. This tests the actual recording/upload pipeline, not real transcription accuracy.
- Desktop owner independently verified the real Electron static export, strict CSP, encrypted persistence and isolated runner execution.

The browser tests use synthetic candidate data and synthetic non-secret credentials. No real user resume or API key is included in fixtures, captured output or source. Provider text/audio tests using intercepted responses are explicitly test adapters; they do not establish live provider accuracy.

## Practical limits

Live account creation, OAuth, verified billing, headshot generation and other cloud operations depend on their actual server configuration and account entitlements. The workspace displays capabilities and useful setup states. JavaScript is executed locally; other language execution requires the configured isolated API runner. Browser storage is not encrypted; desktop records use its encrypted bridge. Browser speech can use the browser vendor's service, while direct audio mode requires an OpenAI key and explicit provider consent. The six-second audio pipeline uses an energy-based activity gate, not speaker diarization. Context retrieval is bounded local ranking, not model training.

Image OCR/understanding is an integration follow-up owned by the coordinator/API agent after this web-core handoff. The existing image document flow remains an honest local preview and editable text context until that integration is added.
