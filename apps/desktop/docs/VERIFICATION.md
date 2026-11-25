# Desktop verification — 2026-11-25

Electron 45.5.0 Windows x64 was downloaded from the official Electron GitHub release and SHA256-verified against the installed npm package's published checksums: `20155c8b8aa5b1f575f3757bdf21490e0bac2f19a65a26ce9ba99bcf9f2c69bd`.

| Check | Evidence / status |
| --- | --- |
| TypeScript / bundled main+preload | `npm run typecheck -w apps/desktop` and `npm run build -w apps/desktop` pass |
| Unit/integration fixtures | Navigation, traversal, IPC payloads, external hosts, vault, encrypted SQLite reopen, runtime detection, all five provider adapters, request cancellation, audio consent/MIME/encoding and transcription fixtures |
| Actual Electron startup | Passed in both development executable and packaged ASAR application; renderer `require` and `process` are undefined; narrow bridge is present |
| Actual OS encryption | Windows DPAPI encryption/decryption roundtrip passed; ciphertext contains no plaintext sentinel; status exposes provider IDs only |
| Actual encrypted SQLite | Record put/get/delete through renderer IPC passed; reopen/ciphertext checks pass in tests |
| CSP enforcement | Injected untrusted inline script blocked in actual packaged Electron |
| Missing-workspace behavior | Meaningful setup page rendered in packaged shell; smoke intentionally exited 1 because no web export was bundled during this early pipeline check |
| Real OpenAI text adapter | Coordinator ran the actual `generate()` adapter against `gpt-4.1-mini`: 54 tokens, 5.74 seconds, synthetic interview-preparation prompt. Key remained in process memory; no credential is in fixtures or repository |
| Real cloud speech | Awaiting coordinator's synthetic-audio check; fixture adapter, consent, cancellation and error handling pass |
| Ollama | Service/model setup is coordinated separately; fixture model discovery and local adapter behavior tested. Do not infer real local inference from fixtures |
| Native audio acquisition | Permission defaults are restrictive and controls are implemented. No private microphone or screen audio was captured during shell verification |
| Windows distributables | Early shell-only NSIS/portable pipeline under `release/shell-check` is for build verification only and must not be published. Final product packages await exported web UI |
| macOS/Linux | Build configuration and CI example supplied; not generated or smoke-tested on this Windows host |

Known desktop limitations: cloud provider answers are asynchronous complete responses rather than token streams (`providerStreaming:false`). Local offline speech models are not bundled. Audio transcription uses explicit OpenAI cloud consent and the user's vault key. The synchronous safeStorage API is supported in pinned Electron 45 but must migrate before Electron 46. Unsigned releases lack Authenticode/notarization. Source-installed and packaged web data should use the encrypted SQLite bridge; browser-only local storage follows the web workspace's policy.
