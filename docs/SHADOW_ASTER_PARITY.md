# Shadow and Aster verification

The 0.4 update enables automatic completed-PC-question answers with a 180 ms queue delay, bounded backlog, distinct-turn deduplication and short follow-ups. Answer context combines the current resume, relevant project-source passages, the current conversation and retrieved earlier responses. AI suggestions remain labeled as unverified conversation memory. Private source libraries live in encrypted SQLite shards rather than in public assets or the editable workspace record. Auto/context/memory preferences persist; recording and provider-processing controls remain visible and no audio starts on launch. See VALIDATION.md for full real-provider and installed-data checks.

Version 0.2.0 follows the subsequent request for Aster-style desktop Shadow controls. The original MASTER_SPEC.md is retained as historical input; the later request adds native overlay capture exclusion.

The Windows overlay uses a frameless transparent window, 930×790 default logical size, 560×440 minimum, independent 70% background transparency and fully opaque text. It supports drag, eight resize grips, scroll/page controls, answer/transcript tabs, answer history, copy/stop, local session memory and resume/document context, notes, explicit screen selection, compact mode, configurable topmost and encrypted settings. Normal close and Quit await final audio processing and workspace flush. Light reloads the encrypted workspace when Shadow closes; its suspended renderer cannot overwrite Shadow changes.

Shortcuts: Ctrl+Alt+Space show/hide and recover mouse interaction; Ctrl+Alt+C click-through; Ctrl+Alt+O compact; Ctrl+Alt+arrows move; Ctrl+Alt+Enter answer; Ctrl+Alt+S selected screen; Ctrl+Alt+L listening. Tray controls recover an off-screen/hidden/click-through window.

## Actual capture result

`node tests/desktop/screen-share.mjs` launches the real sandboxed overlay in an isolated test profile, places an opaque synthetic marker inside it and captures the primary **entire monitor** using a separate WebRTC getDisplayMedia receiver. A synthetic blue window covers the desktop. Full desktop frames are never saved or uploaded; only scalar color ratios are persisted in ignored `.local/screen-share-result.json`.

On the tested Windows machine, the 1920×1200 stream contained the marker with protection off (ratio 1.0), contained the underlying blue background with protection on (marker 0.0, blue 1.0), and contained the marker again when protection was disabled (1.0). Protection is restored afterwards. These positive controls rule out a blank video or an accidentally obscured overlay.

The identical test also passed after installing 0.2.0, against the packaged installed executable through the normal Light→Shadow handoff. Set `OPENINTERVIEW_INSTALLED_EXE` to the installed executable for this variant. The test restores original window bounds and never exports workspace contents; its scalar report is `.local/screen-share-installed-result.json`.

This verifies the tested Windows WebRTC monitor-capture path. It does not verify Zoom, Teams, Meet, OBS, every custom interview portal, every monitor, remote desktops or external cameras. Electron's Windows content-protection API requests WDA_EXCLUDEFROMCAPTURE; the runtime UI says **requested**, not guaranteed. Browser Shadow cannot provide native capture exclusion. Microsoft explicitly does not present display affinity as guaranteed security protection.

Sources: [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window#setcontentprotectionenable), [Microsoft SetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity).

## Audio and remaining differences

The 0.3 desktop implementation streams selected PC and MIC audio over independent realtime connections. AudioWorklet capture sends small PCM frames without waiting for a complete four-second recording file. The main process owns the provider credential and WebSocket; the renderer sends bounded audio frames through the isolated bridge. The UI shows incremental, separately labeled PC/MIC transcripts, and only completed speech enters session memory or triggers question detection and opt-in auto-answer. Microphone questions require an additional auto-answer setting. Selected-screen analysis previews the chosen image and requires explicit provider consent.

Stop releases the selected capture tracks immediately, sends remaining PCM, and drains final speech before saving or switching sessions. Cancel discards pending work and detaches event listeners. Request IDs, source labels and item IDs correlate events, so stopped sessions and simultaneous sources cannot overwrite one another. PC-only selection does not request microphone permission; the computer-audio chooser is opened directly from the Start gesture. The UI explicitly identifies desktop realtime streaming. Realtime still depends on initial connection readiness, speech pause detection and provider/network latency; it does not promise zero latency.

`node tests/desktop/audio-codec.mjs` uses synthetic oscillator streams with Chromium's real MediaRecorder and decoder. Independent PC/MIC WebM files decode, video never enters audio recorders, all tracks end on Stop and no late upload occurs. Unit tests additionally cover denial, silent/no-audio sources, failed devices, broken recorders, hung requests, queue limits and repeated start/stop.

Aster uses Windows WASAPI; this implementation uses chooser-selected computer audio with realtime PCM transcription and partial deltas. Device routing therefore still differs. Browser Shadow and desktop versions without the realtime bridge retain complete four-second HTTP transcription files, explicitly labeled in the UI. Browser speech recognition remains a separately selected microphone option. The previously installed and capture-tested 0.2.0 executable does not gain realtime from a source change; a rebuilt/reinstalled desktop is required. It is not a byte-for-byte Aster clone. No two-hour soak or universal portal compatibility is claimed.

Version 0.3.0 has now been built and installed successfully. Actual installed PC/MIC realtime tests returned partials at 1561/1636 ms and final transcripts without changing saved workspace history. All 318 installed web files match the tested export. Installed full-screen capture exclusion also passed again. See VALIDATION.md for exact evidence and test boundaries.
