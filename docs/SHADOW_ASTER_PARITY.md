# Shadow and Aster verification

Version 0.2.0 follows the subsequent request for Aster-style desktop Shadow controls. The original MASTER_SPEC.md is retained as historical input; the later request adds native overlay capture exclusion.

The Windows overlay uses a frameless transparent window, 930×790 default logical size, 560×440 minimum, independent 70% background transparency and fully opaque text. It supports drag, eight resize grips, scroll/page controls, answer/transcript tabs, answer history, copy/stop, local session memory and resume/document context, notes, explicit screen selection, compact mode, configurable topmost and encrypted settings. Normal close and Quit await final audio processing and workspace flush. Light reloads the encrypted workspace when Shadow closes; its suspended renderer cannot overwrite Shadow changes.

Shortcuts: Ctrl+Alt+Space show/hide and recover mouse interaction; Ctrl+Alt+C click-through; Ctrl+Alt+O compact; Ctrl+Alt+arrows move; Ctrl+Alt+Enter answer; Ctrl+Alt+S selected screen; Ctrl+Alt+L listening. Tray controls recover an off-screen/hidden/click-through window.

## Actual capture result

`node tests/desktop/screen-share.mjs` launches the real sandboxed overlay in an isolated test profile, places an opaque synthetic marker inside it and captures the primary **entire monitor** using a separate WebRTC getDisplayMedia receiver. A synthetic blue window covers the desktop. Full desktop frames are never saved or uploaded; only scalar color ratios are persisted in ignored `.local/screen-share-result.json`.

On the tested Windows machine, the 1920×1200 stream contained the marker with protection off (ratio 1.0), contained the underlying blue background with protection on (marker 0.0, blue 1.0), and contained the marker again when protection was disabled (1.0). Protection is restored afterwards. These positive controls rule out a blank video or an accidentally obscured overlay.

This verifies the tested Windows WebRTC monitor-capture path. It does not verify Zoom, Teams, Meet, OBS, every custom interview portal, every monitor, remote desktops or external cameras. Electron's Windows content-protection API requests WDA_EXCLUDEFROMCAPTURE; the runtime UI says **requested**, not guaranteed. Browser Shadow cannot provide native capture exclusion. Microsoft explicitly does not present display affinity as guaranteed security protection.

Sources: [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window#setcontentprotectionenable), [Microsoft SetWindowDisplayAffinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity).

## Audio and remaining differences

PC and MIC can run simultaneously with separate provenance, RMS meters, bounded queues, cancellation, valid independent files and a final-word drain. Stop immediately releases capture tracks and allows at most 35 seconds to finish pending transcription. Cancel discards pending work immediately. Auto-answer is opt-in, limited to detected computer questions; microphone questions require an additional setting. Selected-screen analysis previews the chosen image and requires explicit provider consent.

`node tests/desktop/audio-codec.mjs` uses synthetic oscillator streams with Chromium's real MediaRecorder and decoder. Independent PC/MIC WebM files decode, video never enters audio recorders, all tracks end on Stop and no late upload occurs. Unit tests additionally cover denial, silent/no-audio sources, failed devices, broken recorders, hung requests, queue limits and repeated start/stop.

Aster uses Windows WASAPI and realtime PCM transcription with partial deltas. This implementation uses chooser-selected computer audio and complete four-second HTTP transcription files; latency and device routing differ. It is not a byte-for-byte Aster clone. No two-hour soak or universal portal compatibility is claimed.
