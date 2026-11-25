/** Independent, provenance-preserving audio capture. Each recorder lifetime creates
 * a complete media file; MediaRecorder timeslices are never uploaded as files.
 * stop() flushes the last voiced file and drains, cancel() discards and aborts.
 */
export type ShadowAudioSource = 'PC' | 'MIC';
export type ShadowAudioStatus = 'idle' | 'starting' | 'recording' | 'stopping';
export type ShadowAudioLevels = Record<ShadowAudioSource, number>;

export interface ShadowAudioEnvironment {
  getDisplayMedia: () => Promise<MediaStream>;
  getUserMedia: () => Promise<MediaStream>;
  createAudioStream: (tracks: MediaStreamTrack[]) => MediaStream;
  createRecorder: (stream: MediaStream) => MediaRecorder;
  createAudioContext: () => AudioContext;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
}
export interface ShadowAudioOptions {
  transcribe: (blob: Blob, source: ShadowAudioSource, signal: AbortSignal) => Promise<string>;
  onTranscript: (text: string, source: ShadowAudioSource, itemId?: string) => void;
  onLevels?: (levels: ShadowAudioLevels, voice: Record<ShadowAudioSource, boolean>) => void;
  onStatus?: (status: ShadowAudioStatus, pending: number) => void;
  onError?: (error: Error) => void;
  environment?: ShadowAudioEnvironment;
  chunkMs?: number;
  requestTimeoutMs?: number;
  stopTimeoutMs?: number;
  maxPendingChunks?: number;
  maxPendingBytes?: number;
}
type Timer = ReturnType<typeof globalThis.setTimeout>;
type Input = {source: ShadowAudioSource; audio: MediaStream; analyser?: AnalyserNode; node?: MediaStreamAudioSourceNode; samples?: Float32Array<ArrayBuffer>; voiced: boolean; recorder?: MediaRecorder; timer?: Timer; finish?: Promise<void>};
type Chunk = {blob: Blob; source: ShadowAudioSource};
type Run = {controller: AbortController; status: ShadowAudioStatus; captures: Set<MediaStream>; inputs: Input[]; context?: AudioContext; meter?: Timer; queue: Chunk[]; pendingBytes: number; processing: boolean; worker?: Promise<void>; stop?: Promise<void>};

function browserEnvironment(): ShadowAudioEnvironment {
  return {
    getDisplayMedia: () => navigator.mediaDevices.getDisplayMedia({video: true, audio: true}),
    getUserMedia: () => navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: false}),
    createAudioStream: tracks => new MediaStream(tracks),
    createRecorder: stream => {
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('This browser cannot record supported audio files. Use a current Chromium browser.');
      return new MediaRecorder(stream, {mimeType});
    },
    createAudioContext: () => new AudioContext(),
    setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis),
  };
}
const abortError = () => new DOMException('Audio capture was cancelled.', 'AbortError');
const stopTracks = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());

export class ShadowAudioCapture {
  private run?: Run;
  private readonly env: ShadowAudioEnvironment;
  constructor(private readonly options: ShadowAudioOptions) { this.env = options.environment ?? browserEnvironment(); }

  /** Call directly from the click handler: the chooser opens before any await,
   * vault IPC or microphone permission. PC-only never requests a microphone. */
  async start(selection: {pc: boolean; mic: boolean; prepare?: () => Promise<void>}): Promise<void> {
    this.cancel();
    if (!selection.pc && !selection.mic) throw new Error('Select PC audio or microphone before listening.');
    const run: Run = {controller: new AbortController(), status: 'starting', captures: new Set(), inputs: [], queue: [], pendingBytes: 0, processing: false};
    this.run = run;
    this.report(run);
    const acquire = (promise: Promise<MediaStream>) => promise.then(stream => {
      if (!this.current(run)) { stopTracks(stream); throw abortError(); }
      run.captures.add(stream);
      return stream;
    });
    try {
      // Keep this invocation ahead of every await and unrelated permission call.
      const pc = selection.pc ? acquire(this.env.getDisplayMedia()) : undefined;
      const [pcStream] = await Promise.all([pc, selection.prepare?.()]);
      if (!this.current(run)) throw abortError();
      if (pcStream && !pcStream.getAudioTracks().length) throw new Error('No PC audio was shared. Choose a tab or screen with audio sharing enabled.');
      const micStream = selection.mic ? await acquire(this.env.getUserMedia()) : undefined;
      if (!this.current(run)) throw abortError();
      if (micStream && !micStream.getAudioTracks().length) throw new Error('The selected microphone did not provide an audio track.');
      try { run.context = this.env.createAudioContext(); await run.context.resume(); }
      catch { void run.context?.close().catch(() => {}); run.context = undefined; }
      if (!this.current(run)) throw abortError();
      for (const [source, capture] of [['PC', pcStream], ['MIC', micStream]] as const) {
        if (!capture) continue;
        if (capture.getTracks().some(track => track.readyState === 'ended')) throw new Error(`${source} audio sharing ended before recording started.`);
        const audio = this.env.createAudioStream(capture.getAudioTracks());
        let analyser: AnalyserNode | undefined; let node: MediaStreamAudioSourceNode | undefined;
        try {
          if (run.context) { analyser = run.context.createAnalyser(); analyser.fftSize = 512; node = run.context.createMediaStreamSource(audio); node.connect(analyser); }
        } catch { node?.disconnect(); analyser = undefined; node = undefined; }
        run.inputs.push({source, audio, analyser, node, samples: analyser ? new Float32Array(analyser.fftSize) : undefined, voiced: false});
        // Video is never passed to the recorder, but remains owned and stopped.
        for (const track of capture.getTracks()) track.addEventListener('ended', () => {
          if (this.current(run) && run.status === 'recording') this.fail(run, new Error(`${source} audio source ended. Restart listening to select a source.`));
        }, {once: true});
      }
      run.status = 'recording';
      run.meter = this.env.setInterval(() => this.measure(run), 100);
      this.measure(run);
      for (const input of run.inputs) this.record(run, input);
      this.report(run);
    } catch (error) {
      if (this.current(run)) this.cancel();
      throw error;
    }
  }

  /** Graceful Stop accepts the final voiced chunk, then finishes pending work.
   * No transcript callback or upload occurs after this promise resolves.
   * Use cancel() for immediate cancellation, navigation and unmount. */
  stop(): Promise<void> {
    const run = this.run;
    if (!run) return Promise.resolve();
    if (run.stop) return run.stop;
    if (run.status === 'starting') { this.cancel(); return Promise.resolve(); }
    this.measure(run); // Include voice in a short final file before stopping the meter.
    run.status = 'stopping'; this.report(run);
    if (run.meter) this.env.clearInterval(run.meter);
    run.stop = (async () => {
      let timeout: Timer | undefined;
      let cancelled: (() => void) | undefined;
      try {
        for (const input of run.inputs) {
          if (input.timer) this.env.clearTimeout(input.timer);
          if (input.recorder?.state === 'recording') input.recorder.stop();
        }
        // Release audio and the display's video track immediately on Stop.
        run.captures.forEach(stopTracks);
        const drain = (async () => {
          await Promise.all(run.inputs.map(input => input.finish));
          while (this.current(run) && run.worker) await run.worker;
        })();
        const cancellation = new Promise<void>(resolve => {
          cancelled = () => resolve();
          if (run.controller.signal.aborted) resolve();
          else run.controller.signal.addEventListener('abort', cancelled, {once: true});
        });
        const deadline = new Promise<void>(resolve => { timeout = this.env.setTimeout(() => {
          this.fail(run, new Error('Finishing transcription timed out. The remaining audio was discarded.')); resolve();
        }, this.options.stopTimeoutMs ?? 35000); });
        await Promise.race([drain, cancellation, deadline]);
      } finally {
        if (timeout) this.env.clearTimeout(timeout);
        if (cancelled) run.controller.signal.removeEventListener('abort', cancelled);
        if (this.current(run)) this.cancel();
      }
    })();
    return run.stop;
  }

  cancel(): void {
    const run = this.run;
    if (!run) return;
    this.run = undefined;
    run.controller.abort();
    if (run.meter) this.env.clearInterval(run.meter);
    for (const input of run.inputs) {
      if (input.timer) this.env.clearTimeout(input.timer);
      const recorder = input.recorder;
      if (recorder?.state === 'recording') recorder.stop();
      input.node?.disconnect(); input.analyser?.disconnect();
    }
    run.captures.forEach(stopTracks); run.queue.length = 0;
    void run.context?.close().catch(() => {});
    this.options.onLevels?.({PC: 0, MIC: 0}, {PC: false, MIC: false});
    this.options.onStatus?.('idle', 0);
  }

  private current(run: Run) { return this.run === run && !run.controller.signal.aborted; }
  private report(run: Run) { if (this.current(run)) this.options.onStatus?.(run.status, run.queue.length + Number(run.processing)); }
  private fail(run: Run, error: Error) {
    if (!this.current(run)) return;
    this.cancel(); this.options.onError?.(error);
  }
  private measure(run: Run) {
    if (!this.current(run) || run.status !== 'recording') return;
    const levels: ShadowAudioLevels = {PC: 0, MIC: 0}; const voice = {PC: false, MIC: false};
    for (const input of run.inputs) {
      // If the browser cannot meter audio, record rather than silently lose it.
      if (!input.analyser || !input.samples) { input.voiced = true; continue; }
      input.analyser.getFloatTimeDomainData(input.samples);
      let energy = 0; for (const value of input.samples) energy += value * value;
      const rms = Math.sqrt(energy / input.samples.length);
      levels[input.source] = Number.isFinite(rms) ? rms : 0;
      voice[input.source] = rms > .005;
      input.voiced ||= voice[input.source];
    }
    this.options.onLevels?.(levels, voice);
  }
  private record(run: Run, input: Input) {
    if (!this.current(run) || run.status !== 'recording') return;
    input.voiced = !input.analyser;
    const chunks: BlobPart[] = [];
    let bytes = 0;
    const recorder = this.env.createRecorder(input.audio); input.recorder = recorder;
    input.finish = new Promise(resolve => {
      recorder.ondataavailable = event => {
        if (!this.current(run)) return;
        bytes += event.data.size;
        if (bytes > (this.options.maxPendingBytes ?? 16 * 1024 * 1024)) { this.fail(run, new Error('Recorded audio exceeded the memory limit. Restart listening.')); return; }
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => { this.fail(run, new Error(`${input.source} audio recording failed. Restart listening.`)); resolve(); };
      recorder.onstop = () => {
        if (input.timer) this.env.clearTimeout(input.timer);
        const voiced = input.voiced;
        if (this.current(run)) {
          const blob = new Blob(chunks, {type: recorder.mimeType || 'audio/webm'});
          if (voiced && blob.size) this.enqueue(run, {blob, source: input.source});
          if (this.current(run) && run.status === 'recording') {
            try { this.record(run, input); } catch (error) { this.fail(run, error instanceof Error ? error : new Error(String(error))); }
          }
        }
        resolve();
      };
    });
    recorder.start(); // No timeslice: stop emits a complete independently decodable file.
    input.timer = this.env.setTimeout(() => {
      if (this.current(run) && recorder.state === 'recording') recorder.stop();
    }, this.options.chunkMs ?? 4000);
  }
  private enqueue(run: Run, chunk: Chunk) {
    if (run.queue.length + Number(run.processing) >= (this.options.maxPendingChunks ?? 4) || run.pendingBytes + chunk.blob.size > (this.options.maxPendingBytes ?? 16 * 1024 * 1024)) {
      this.fail(run, new Error('Transcription is too slow. The audio queue reached its limit; restart listening.')); return;
    }
    run.queue.push(chunk); run.pendingBytes += chunk.blob.size;
    if (!run.worker) {
      run.worker = this.pump(run).finally(() => { run.worker = undefined; });
    }
    this.report(run);
  }
  private async pump(run: Run) {
    while (this.current(run) && run.queue.length) {
      const chunk = run.queue.shift()!; run.processing = true; this.report(run);
      const request = new AbortController();
      const abort = () => request.abort(); run.controller.signal.addEventListener('abort', abort, {once: true});
      let timer: Timer | undefined;
      try {
        const cancelled = new Promise<never>((_, reject) => request.signal.addEventListener('abort', () => reject(abortError()), {once: true}));
        const timeout = new Promise<never>((_, reject) => { timer = this.env.setTimeout(() => {
          reject(new Error('Transcription timed out. Restart listening to reconnect.')); request.abort();
        }, this.options.requestTimeoutMs ?? 30000); });
        const text = await Promise.race([this.options.transcribe(chunk.blob, chunk.source, request.signal), timeout, cancelled]);
        if (this.current(run) && text.trim()) this.options.onTranscript(text.trim(), chunk.source);
      } catch (error) {
        if (this.current(run)) this.fail(run, error instanceof Error ? error : new Error(String(error)));
      } finally {
        if (timer) this.env.clearTimeout(timer);
        run.controller.signal.removeEventListener('abort', abort);
        run.pendingBytes -= chunk.blob.size; run.processing = false; this.report(run);
      }
    }
  }
}
