# OpenInterview AI desktop

The Electron application visibly hosts the same exported React/Next.js workspace as the website. Light Mode and Shadow Mode are user controlled. It never installs background recording, process disguise, screen-share hiding or capture evasion. The application data directory is `%APPDATA%/OpenInterview AI` on Windows, independent of Aster.

## Development and packaging

From repository root, `npm install`, `npm run build -w apps/web`, `npm run build -w apps/desktop`, then `npm run start -w apps/desktop`. For hot reload, start the Next.js web server on localhost:3000 and run `npm run dev -w apps/desktop`.

Run `npm run typecheck -w apps/desktop`, `npm run test -w apps/desktop`, and `npm run smoke -w apps/desktop`. The smoke test starts actual Electron, checks the exposed bridge, checks sandboxed renderer Node isolation, and writes a sanitized `smoke-result.json` in the application's data directory. It fails if the exported workspace is absent. It doesn't record audio, call a paid provider or download a model.

Windows: `npm run dist:win -w apps/desktop` creates an unsigned x64 per-user NSIS installer and portable executable under `apps/desktop/release`. No admin installation is required. Files are community builds without Authenticode; Windows may show an unrecognized-publisher prompt. macOS: `npm run dist:mac -w apps/desktop` on macOS creates arm64/x64 DMGs, unsigned unless release signing is configured. Linux: `npm run dist:linux -w apps/desktop` on Linux creates x64 AppImage/deb. macOS/Linux artifacts are build targets, not downloads until generated on those hosts. A CI matrix example is in `ci-build.yml.example`; the coordinator may copy it to `.github/workflows`.

## Settings and network boundaries

- `OPENINTERVIEW_DESKTOP_URL`: optional explicit HTTPS deployment replacing packaged UI. Only this origin can navigate and call the bridge. Packaged local UI is the default.
- `OPENINTERVIEW_COMPATIBLE_BASE_URL`: administrator-set HTTPS OpenAI-compatible API base (for example `https://provider.example/v1`). The renderer cannot choose arbitrary API origins. Set once before launching. API keys are stored via the vault and sent directly to this endpoint.
- `OPENINTERVIEW_API_URL`: optional additional HTTPS API origin permitted by renderer CSP. Desktop local API health checks always use `http://127.0.0.1:8000/health`.
- Cloud BYOK request origins are exactly `api.openai.com`, `generativelanguage.googleapis.com`, and `api.anthropic.com`. HTTP redirects are rejected. Ollama uses only `http://127.0.0.1:11434`.

Provider calls return complete responses asynchronously with a 120-second timeout and AbortController cancellation. `providerStreaming:false` is reported honestly; token streaming is not yet implemented. Ollama model downloads stream progress events and are cancellable. The app does not retry paid requests automatically because retrying can incur duplicate cost.

## Audio

Call `requestMediaAccess()` from the visible microphone action before `getUserMedia({audio:true})`. A native dialog grants audio permission for 30 seconds; video permission is refused. Recording tracks must be visibly managed and stopped by the React workspace. `getDisplayMedia` requires a user gesture and shows a native source selector; system audio is supplied on Windows only. No automatic capture is requested. OS capabilities and source support can vary.

For desktop cloud transcription, `transcribeAudio({base64,mime,consent:true,requestId?,language?})` sends an audio chunk directly to `https://api.openai.com/v1/audio/transcriptions` with the encrypted-vault OpenAI key. The selected model is `gpt-4o-mini-transcribe`. The workspace must explain cloud processing and obtain explicit consent before sending; the method refuses missing consent. The maximum chunk is 10 MB and supported audio MIME types are WebM, WAV, Ogg, MP4, MP3 and FLAC. Use an audio-only stream for system-audio chunks; video containers are rejected. Audio exists only in memory in this shell and is never logged or saved by it. Cancellation uses the same `cancelRequest({requestId})` method. Cloud provider pricing, retention and account permissions apply. Offline speech recognition is not bundled; browser speech recognition, when available, follows browser service capabilities.

## Storage and privacy

Credentials are encrypted with Electron safeStorage: DPAPI on Windows, Keychain on macOS, and an OS secret store on Linux. The `basic_text`/unknown Linux fallback is rejected; there is no plaintext fallback. Credentials cannot be read through the bridge. Local SQLite record values are independently encrypted with the same OS vault. Record keys and update timestamps are visible, so do not encode private content into record keys. The app refuses encrypted record writes if the vault is unavailable. Guest browser data follows the web workspace's separate local storage policy until migrated via the SQLite bridge.

This uses the synchronous safeStorage API supported in Electron 45; it is deprecated upstream and should migrate to the asynchronous API before upgrading to Electron 46. DPAPI protects against other OS users, not arbitrary apps already running as the same user. Unsigned macOS builds can trigger repeated Keychain prompts. Full-disk encryption remains recommended. Imported files are limited to 20 MB and selected with native dialogs. Exports only write text formats selected by a native save dialog. No arbitrary path, shell command, URL fetch or generic IPC method is exposed.

## Local models

Install Ollama from https://ollama.com/download and start it. The app probes service version, checks PATH and standard install locations for the executable without running a shell, lists models, confirms downloads, reports byte progress, tests response latency, loads/unloads models with `keep_alive`, and confirms removals. When the service is unreachable, the result distinguishes a detected installed runtime from a runtime not found in those locations. Custom locations outside PATH may need manual setup. No bundled runtime or model is included. RAM guidance is a coarse heuristic rather than a guarantee. CPU/GPU support follows the installed Ollama runtime. A new model requires disk space and a network download.

## Bridge additions

The base methods follow `docs/CONTRACT.md`. Additional methods are `providerModels({provider})`, `transcribeAudio({base64,mime,consent:true,requestId?,language?})`, `cancelRequest({requestId})`, `ollamaControl({model,action:'start'|'stop'|'test'})`, `requestMediaAccess()`, `storeGet({key})`, `storePut({key,value})`, `storeDelete({key})`. Requests may provide a safe alphanumeric UUID-style `requestId` to cancel in flight. Provider results are `{text,provider,model,requestId,elapsedMs,usage}`. `providerModels()` returns `{id,name?}[]`; `ollamaModels()` returns the Ollama model array. Progress events are `{type:'ollama-pull',requestId,model,status,total?,completed?}`; subscribe via `onEvent(callback)` and call its disposer on unmount. File selection returns `{name,mime,content,encoding:'utf8'|'base64'}` or null. Exports return `{saved,name?}`.

External documentation/source/setup links are limited to exact known HTTPS provider/documentation hosts and require a native Open browser confirmation. Unknown external destinations receive a clear blocked state. Downloads generated by the workspace use a native save dialog and safe extension allowlist, including PDF/DOCX, text and code. User code execution uses the separate `/runner.html` sandbox with no network and no bridge; only that iframe permits dynamic evaluation. The main workspace CSP never permits dynamic evaluation in packaged builds.
