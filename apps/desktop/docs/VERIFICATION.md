# Desktop verification — 2026-11-25

Electron 45.5.0 Windows x64 was downloaded from the official Electron GitHub release and SHA256-verified against the installed npm package's published checksums: `20155c8b8aa5b1f575f3757bdf21490e0bac2f19a65a26ce9ba99bcf9f2c69bd`.

| Check | Evidence / status |
| --- | --- |
| TypeScript / bundled main+preload | `npm run typecheck -w apps/desktop` and `npm run build -w apps/desktop` pass |
| Unit/integration fixtures | 27 tests pass: navigation, traversal, IPC payloads, external hosts, CRLF-safe CSP hashes, unreadable vault ciphertext, encrypted SQLite reopen, runtime detection, all five provider adapters/stream parsers, request cancellation after partial output, audio consent/MIME/encoding, transcription and image validation/adapters |
| Actual Electron startup | Full exported dashboard hydrated in actual Electron; renderer `require` and `process` are undefined; narrow bridge is present. Early packaged ASAR shell also passed isolation checks |
| Actual OS encryption | Windows DPAPI encryption/decryption roundtrip passed; ciphertext contains no plaintext sentinel; status exposes provider IDs only |
| Actual encrypted SQLite | Record put/get/delete through renderer IPC passed; reopen/ciphertext checks pass in tests |
| CSP enforcement | Injected untrusted inline script blocked in actual packaged Electron |
| Actual coding sandbox | Static runner iframe executed two-sum in a dedicated worker. Network fetch was blocked, Node/DOM globals were unavailable, and iframe origin was opaque (`null`) |
| Missing-workspace behavior | Meaningful setup page rendered in packaged shell; smoke intentionally exited 1 because no web export was bundled during this early pipeline check |
| Real OpenAI text adapter | Coordinator ran the actual `generate()` adapter against `gpt-4.1-mini`: 54 tokens, 5.74 seconds, synthetic interview-preparation prompt. Key remained in process memory; no credential is in fixtures or repository |
| Actual cloud streaming bridge | Optional `--smoke-cloud-ai` passed through renderer/main/vault/OpenAI using a synthetic maximum-64-token prompt: 2.178 seconds. Credential re-seeding was done with the correct product Local State profile after an external helper profile mismatch was detected |
| Real cloud speech | Coordinator ran the actual `speech.ts` adapter on a synthetic WAV against OpenAI: exact expected sentence recognized in 2.004 seconds. No private microphone audio was recorded. Fixture consent, cancellation and error handling also pass |
| Ollama | Real `qwen2.5:0.5b` adapter streaming passed: synthetic FIFO prompt in 2.106 seconds, 19 events; real adapter cancellation passed after 1 event. Actual renderer/main bridge `--smoke-local-ai` also passed generation with 18 events and cancellation |
| Actual image bridge | `--smoke-vision` sent a synthetic canvas containing `OPENINTERVIEW FIFO 42` to `gpt-4.1-mini`; expected text was recognized in 2.051 seconds. No screen or private image was captured |
| Native audio acquisition | Permission defaults are restrictive and controls are implemented. No private microphone or screen audio was captured during shell verification |
| Windows distributables | Early shell-only NSIS/portable pipeline under `release/shell-check` is for build verification only and must not be published. Final product packages await exported web UI |
| macOS/Linux | Build configuration and CI example supplied; not generated or smoke-tested on this Windows host |

Known desktop limitations: local offline speech models are not bundled. Audio transcription and image analysis use explicit OpenAI cloud consent and the user's vault key; desktop image providers other than OpenAI are unsupported. The synchronous safeStorage API is supported in pinned Electron 45 but must migrate before Electron 46. Unsigned releases lack Authenticode/notarization. Desktop workspace data uses the encrypted SQLite bridge; browser-only local storage follows the web workspace's policy. macOS/Linux targets have not been built on this Windows host.
