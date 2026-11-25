# Desktop verification — 2026-11-25

Electron 45.5.0 Windows x64 was downloaded from the official Electron GitHub release and SHA256-verified against the installed npm package's published checksums: `20155c8b8aa5b1f575f3757bdf21490e0bac2f19a65a26ce9ba99bcf9f2c69bd`.

| Check | Evidence / status |
| --- | --- |
| TypeScript / bundled main+preload | `npm run typecheck -w apps/desktop` and `npm run build -w apps/desktop` pass |
| Unit/integration fixtures | 27 tests pass: navigation, traversal, IPC payloads, external hosts, CRLF-safe CSP hashes, unreadable vault ciphertext, encrypted SQLite reopen, runtime detection, all five provider adapters/stream parsers, request cancellation after partial output, audio consent/MIME/encoding, transcription and image validation/adapters |
| Actual Electron startup | Final NSIS-installed application passed the complete smoke with exit 0. Full exported dashboard hydrated; renderer `require` and `process` are undefined; narrow bridge is present |
| Actual OS encryption | Windows DPAPI encryption/decryption roundtrip passed; ciphertext contains no plaintext sentinel; status exposes provider IDs only |
| Actual encrypted SQLite | Record put/get/delete through renderer IPC passed; reopen/ciphertext checks pass in tests |
| CSP enforcement | Injected untrusted inline script blocked in actual packaged Electron |
| Actual coding sandbox | Static runner iframe executed two-sum in a dedicated worker. Network fetch was blocked, Node/DOM globals were unavailable, and iframe origin was opaque (`null`) |
| Missing-workspace behavior | Meaningful setup page rendered in packaged shell; smoke intentionally exited 1 because no web export was bundled during this early pipeline check |
| Real OpenAI text adapter | Coordinator ran the actual `generate()` adapter against `gpt-4.1-mini`: 54 tokens, 5.74 seconds, synthetic interview-preparation prompt. Key remained in process memory; no credential is in fixtures or repository |
| Actual cloud streaming bridge | Final installed `--smoke-cloud-ai` passed through renderer/main/vault/OpenAI using a synthetic maximum-64-token prompt: 2.124 seconds, 3 cumulative text events. Credential re-seeding was done with the correct product Local State profile after an external helper profile mismatch was detected |
| Real cloud speech | Coordinator ran the actual `speech.ts` adapter on a synthetic WAV against OpenAI: exact expected sentence recognized in 2.004 seconds. No private microphone audio was recorded. Fixture consent, cancellation and error handling also pass |
| Ollama | Real `qwen2.5:0.5b` adapter streaming passed: synthetic FIFO prompt in 2.106 seconds, 19 events; real adapter cancellation passed after 1 event. Final installed renderer/main bridge also passed generation with 39 cumulative events and real cancellation |
| Actual image bridge | Final installed `--smoke-vision` sent a synthetic canvas containing `OPENINTERVIEW FIFO 42` to `gpt-4.1-mini`; expected text was recognized in 1.862 seconds. No screen or private image was captured |
| Native audio acquisition | Permission defaults are restrictive and controls are implemented. No private microphone or screen audio was captured during shell verification |
| Windows installer | Final `OpenInterview-AI-0.1.0-win-x64-setup.exe` is 125,751,249 bytes; SHA256 `c14d98515fc030af1ca77423da107ef30ea21a4ec5f4008967d844c1c19cada0`. Silent per-user installation succeeded with exit 0 into `LOCALAPPDATA/Programs/OpenInterview AI`. Product metadata is OpenInterview AI 0.1.0.0; Authenticode reports NotSigned |
| Installed web integrity | All 316 installed web resource files exactly matched the final exported web build, including the Python/TypeScript filename fix. Tree SHA256 `938314728b0be98733aef1db060e1745fec13c10f5a4c92423eddce1ef4a396f` |
| Windows portable | Final portable target is still compressing; publish only after its executable and checksum are generated. Early shell-only products under `release/shell-check` must not be published |
| macOS/Linux | Build configuration and CI example supplied; not generated or smoke-tested on this Windows host |

Known desktop limitations: local offline speech models are not bundled. Audio transcription and image analysis use explicit OpenAI cloud consent and the user's vault key; desktop image providers other than OpenAI are unsupported. The synchronous safeStorage API is supported in pinned Electron 45 but must migrate before Electron 46. Unsigned releases lack Authenticode/notarization. Desktop workspace data uses the encrypted SQLite bridge; browser-only local storage follows the web workspace's policy. macOS/Linux targets have not been built on this Windows host.
