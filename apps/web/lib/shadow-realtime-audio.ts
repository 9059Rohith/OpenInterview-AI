import {PcmTurnDetector, pcmToBase64, type PcmTurnEvent} from './pcm-stream';
import type {ShadowAudioLevels, ShadowAudioSource, ShadowAudioStatus} from './shadow-audio';

export type ShadowSpeechEvent = {
  type?: string;
  requestId: string;
  source: ShadowAudioSource;
  kind: 'partial' | 'final' | 'error' | 'status';
  itemId?: string;
  text?: string;
  message?: string;
};
export interface ShadowRealtimeBridge {
  speechStart(request: {requestId: string; source: ShadowAudioSource; consent: true; language?: string}): Promise<unknown>;
  speechAppend(request: {requestId: string; base64: string}): Promise<unknown>;
  speechCommit(request: {requestId: string; discard?: boolean}): Promise<unknown>;
  /** Resolves after all final events for committed turns have been delivered. */
  speechStop(request: {requestId: string}): Promise<unknown>;
  speechCancel(request: {requestId: string}): Promise<unknown>;
  onSpeechEvent(listener: (event: ShadowSpeechEvent) => void): () => void;
}
export interface ShadowRealtimeEnvironment {
  getDisplayMedia(): Promise<MediaStream>;
  getUserMedia(): Promise<MediaStream>;
  createAudioStream(tracks: MediaStreamTrack[]): MediaStream;
  createAudioContext(): AudioContext;
  createWorklet(context: AudioContext): AudioWorkletNode;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  randomId(): string;
}
export interface ShadowRealtimeAudioOptions {
  bridge: ShadowRealtimeBridge;
  onTranscript(text: string, source: ShadowAudioSource, itemId?: string): void;
  /** Accumulated draft text, not a delta; cleared after the corresponding final. */
  onPartial?(text: string, source: ShadowAudioSource): void;
  onLevels?(levels: ShadowAudioLevels, voice: Record<ShadowAudioSource, boolean>): void;
  onStatus?(status: ShadowAudioStatus, pending: number): void;
  onError?(error: Error): void;
  onSpeechEvent?(event: ShadowSpeechEvent): void;
  environment?: ShadowRealtimeEnvironment;
  language?: string;
  workletUrl?: string;
  requestTimeoutMs?: number;
  stopTimeoutMs?: number;
  maxPendingPackets?: number;
  maxPendingBytes?: number;
}
type Timer = ReturnType<typeof globalThis.setTimeout>;
type Input = {
  source: ShadowAudioSource;
  requestId: string;
  detector: PcmTurnDetector;
  node?: MediaStreamAudioSourceNode;
  worklet?: AudioWorkletNode;
  drained: Promise<void>;
  resolveDrained(): void;
  isDrained: boolean;
  queue: PcmTurnEvent[];
  pendingBytes: number;
  pendingCount: number;
  worker?: Promise<void>;
  partials: Map<string, string>;
  finals: Set<string>;
};
type Run = {
  controller: AbortController;
  status: ShadowAudioStatus;
  captures: Set<MediaStream>;
  inputs: Input[];
  context?: AudioContext;
  close?: Promise<void>;
  unsubscribe?: () => void;
  endedListeners: {track: MediaStreamTrack; listener: () => void}[];
  stop?: Promise<void>;
};
const abortError = () => new DOMException('Audio capture was cancelled.', 'AbortError');
const asError = (value: unknown) => value instanceof Error ? value : new Error(String(value));
const stopTracks = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());

function browserEnvironment(): ShadowRealtimeEnvironment {
  return {
    getDisplayMedia: () => navigator.mediaDevices.getDisplayMedia({video: true, audio: true}),
    getUserMedia: () => navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: false}),
    createAudioStream: tracks => new MediaStream(tracks),
    createAudioContext: () => new AudioContext(),
    createWorklet: context => new AudioWorkletNode(context, 'shadow-pcm-capture', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCountMode: 'max'}),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    randomId: () => crypto.randomUUID(),
  };
}

/** Desktop streaming capture: PC and MIC each have their own PCM graph, VAD,
 * ordered queue and realtime connection. No MediaRecorder/files or chunk timer. */
export class ShadowRealtimeAudioCapture {
  private run?: Run;
  private readonly env: ShadowRealtimeEnvironment;
  constructor(private readonly options: ShadowRealtimeAudioOptions) { this.env = options.environment ?? browserEnvironment(); }

  async start(selection: {pc: boolean; mic: boolean; prepare?: () => Promise<void>}): Promise<void> {
    this.cancel();
    if (!selection.pc && !selection.mic) throw new Error('Select PC audio or microphone before listening.');
    const run: Run = {controller: new AbortController(), status: 'starting', captures: new Set(), inputs: [], endedListeners: []};
    this.run = run;
    this.report(run);
    const acquire = (promise: Promise<MediaStream>) => promise.then(stream => {
      if (!this.current(run)) { stopTracks(stream); throw abortError(); }
      run.captures.add(stream);
      return stream;
    });
    try {
      // This must remain synchronous and precede vault IPC and microphone access.
      const pc = selection.pc ? acquire(this.env.getDisplayMedia()) : undefined;
      const [pcStream] = await Promise.all([pc, selection.prepare?.()]);
      if (!this.current(run)) throw abortError();
      if (pcStream && !pcStream.getAudioTracks().length) throw new Error('No PC audio was shared. Choose a tab or screen with audio sharing enabled.');
      const micStream = selection.mic ? await acquire(this.env.getUserMedia()) : undefined;
      if (!this.current(run)) throw abortError();
      if (micStream && !micStream.getAudioTracks().length) throw new Error('The selected microphone did not provide an audio track.');
      run.context = this.env.createAudioContext();
      await this.deadline(run, Promise.all([run.context.resume(), run.context.audioWorklet.addModule(this.options.workletUrl ?? '/pcm-capture-worklet.js')]), 'Audio processing did not start.');
      run.unsubscribe = this.options.bridge.onSpeechEvent(event => this.receive(run, event));
      await Promise.all(([['PC', pcStream], ['MIC', micStream]] as const).map(async ([source, stream]) => {
        if (!stream) return;
        if (stream.getTracks().some(track => track.readyState === 'ended')) throw new Error(`${source} audio sharing ended before recording started.`);
        let resolveDrained!: () => void;
        const input: Input = {source, requestId: this.env.randomId(), detector: new PcmTurnDetector(), drained: new Promise(resolve => { resolveDrained = resolve; }), resolveDrained: () => resolveDrained(), isDrained: false, queue: [], pendingBytes: 0, pendingCount: 0, partials: new Map(), finals: new Set()};
        run.inputs.push(input);
        for (const track of stream.getTracks()) {
          const listener = () => { if (this.current(run) && run.status !== 'stopping') this.fail(run, new Error(`${source} audio source ended. Restart listening to select a source.`)); };
          run.endedListeners.push({track, listener});
          track.addEventListener('ended', listener, {once: true});
        }
        await this.deadline(run, this.options.bridge.speechStart({requestId: input.requestId, source, consent: true, language: this.options.language}), `${source} transcription connection timed out.`);
        if (!this.current(run)) throw abortError();
        input.node = run.context!.createMediaStreamSource(this.env.createAudioStream(stream.getAudioTracks()));
        input.worklet = this.env.createWorklet(run.context!);
        input.worklet.port.onmessage = event => this.packet(run, input, event.data);
        input.worklet.onprocessorerror = () => this.fail(run, new Error(`${source} audio processing failed. Restart listening.`));
        input.node.connect(input.worklet);
        input.worklet.connect(run.context!.destination);
      }));
      if (!this.current(run)) throw abortError();
      run.status = 'recording';
      this.report(run);
    } catch (error) {
      if (this.current(run)) this.cancel();
      throw error;
    }
  }

  /** Stop releases every device immediately; its promise includes PCM and final transcript drain. */
  stop(): Promise<void> {
    const run = this.run;
    if (!run) return Promise.resolve();
    if (run.stop) return run.stop;
    if (run.status === 'starting') { this.cancel(); return Promise.resolve(); }
    run.status = 'stopping';
    this.report(run);
    run.captures.forEach(stopTracks);
    for (const input of run.inputs) input.worklet?.port.postMessage({type: 'stop'});
    run.stop = (async () => {
      try {
        await this.deadline(run, (async () => {
          await Promise.all(run.inputs.map(async input => {
            await input.drained;
            for (const event of input.detector.finish()) this.enqueue(run, input, event);
            while (input.worker && this.current(run)) await input.worker;
            if (this.current(run)) await this.options.bridge.speechStop({requestId: input.requestId});
          }));
        })(), 'Finishing transcription timed out. Restart listening.', this.options.stopTimeoutMs ?? 15000);
      } catch (error) { if (this.current(run)) this.fail(run, asError(error)); }
      finally {
        if (this.current(run)) this.cancel();
        await run.close;
      }
    })();
    return run.stop;
  }

  cancel(): void {
    const run = this.run;
    if (!run) return;
    this.run = undefined;
    run.controller.abort();
    run.unsubscribe?.();
    for (const {track, listener} of run.endedListeners) track.removeEventListener('ended', listener);
    run.captures.forEach(stopTracks);
    for (const input of run.inputs) {
      input.queue = [];
      input.detector.reset();
      input.partials.clear();
      input.resolveDrained();
      input.node?.disconnect();
      if (input.worklet) {
        input.worklet.onprocessorerror = null;
        input.worklet.port.onmessage = null;
        input.worklet.port.close();
        input.worklet.disconnect();
      }
      void this.options.bridge.speechCancel({requestId: input.requestId}).catch(() => {});
      this.options.onPartial?.('', input.source);
    }
    run.close = run.context?.close().catch(() => {});
    this.options.onLevels?.({PC: 0, MIC: 0}, {PC: false, MIC: false});
    this.options.onStatus?.('idle', 0);
  }

  private current(run: Run) { return this.run === run && !run.controller.signal.aborted; }
  private report(run: Run) { if (this.current(run)) this.options.onStatus?.(run.status, run.inputs.reduce((sum, input) => sum + input.pendingCount, 0)); }
  private fail(run: Run, error: Error) { if (this.current(run)) { this.cancel(); this.options.onError?.(error); } }

  private packet(run: Run, input: Input, data: {type?: string; buffer?: ArrayBuffer; message?: string}): void {
    if (!this.current(run) || input.isDrained) return;
    if (data.type === 'drained') { input.isDrained = true; input.resolveDrained(); return; }
    if (data.type === 'error') { this.fail(run, new Error(data.message ?? `${input.source} audio processing failed.`)); return; }
    if (data.type !== 'pcm' || !(data.buffer instanceof ArrayBuffer)) return;
    if (data.buffer.byteLength % 2 || data.buffer.byteLength > 24576) { this.fail(run, new Error('Invalid PCM audio packet. Restart listening.')); return; }
    for (const event of input.detector.push(new Int16Array(data.buffer))) this.enqueue(run, input, event);
    if (!this.current(run)) return;
    const levels: ShadowAudioLevels = {PC: 0, MIC: 0};
    const voice = {PC: false, MIC: false};
    for (const source of run.inputs) { levels[source.source] = source.detector.level; voice[source.source] = source.detector.voice; }
    this.options.onLevels?.(levels, voice);
  }

  private enqueue(run: Run, input: Input, event: PcmTurnEvent): void {
    if (!this.current(run)) return;
    const bytes = event.kind === 'append' ? event.pcm.byteLength : 0;
    if (input.pendingCount >= (this.options.maxPendingPackets ?? 100) || input.pendingBytes + bytes > (this.options.maxPendingBytes ?? 256 * 1024)) {
      this.fail(run, new Error(`${input.source} transcription is too slow. The audio queue reached its limit; restart listening.`));
      return;
    }
    input.queue.push(event);
    input.pendingBytes += bytes;
    input.pendingCount++;
    if (!input.worker) input.worker = this.pump(run, input).finally(() => { input.worker = undefined; });
    this.report(run);
  }

  private async pump(run: Run, input: Input): Promise<void> {
    while (this.current(run) && input.queue.length) {
      const event = input.queue.shift()!;
      try {
        const task = event.kind === 'append'
          ? this.options.bridge.speechAppend({requestId: input.requestId, base64: pcmToBase64(event.pcm)})
          : this.options.bridge.speechCommit({requestId: input.requestId, ...(event.kind === 'clear' ? {discard: true} : {})});
        await this.deadline(run, task, `${input.source} transcription connection timed out.`);
      } catch (error) { if (this.current(run)) this.fail(run, asError(error)); }
      finally {
        input.pendingBytes -= event.kind === 'append' ? event.pcm.byteLength : 0;
        input.pendingCount--;
        this.report(run);
      }
    }
  }

  private receive(run: Run, event: ShadowSpeechEvent): void {
    if (!this.current(run)) return;
    const input = run.inputs.find(value => value.requestId === event.requestId && value.source === event.source);
    if (!input) return;
    const item = event.itemId ?? 'current';
    if (event.kind === 'error') { this.fail(run, new Error(event.message ?? 'Realtime transcription failed.')); return; }
    if (event.kind === 'partial') {
      if (input.finals.has(item)) return;
      input.partials.set(item, event.text ?? '');
      this.options.onPartial?.([...input.partials.values()].filter(Boolean).join(' '), input.source);
    } else if (event.kind === 'final') {
      if (event.itemId && input.finals.has(item)) return;
      if (event.itemId) input.finals.add(item);
      // Bound deduplication metadata even during an indefinitely long session.
      if (input.finals.size > 512) input.finals.delete(input.finals.values().next().value!);
      input.partials.delete(item);
      const text = event.text?.trim();
      if (text) this.options.onTranscript(text, input.source, event.itemId);
      this.options.onPartial?.([...input.partials.values()].filter(Boolean).join(' '), input.source);
    }
    this.options.onSpeechEvent?.(event);
  }

  private deadline<T>(run: Run, task: Promise<T>, message: string, milliseconds = this.options.requestTimeoutMs ?? 25000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.current(run)) { void task.catch(() => {}); reject(abortError()); return; }
      let timer: Timer | undefined;
      const cleanup = () => { if (timer !== undefined) this.env.clearTimeout(timer); run.controller.signal.removeEventListener('abort', aborted); };
      const aborted = () => { cleanup(); reject(abortError()); };
      run.controller.signal.addEventListener('abort', aborted, {once: true});
      timer = this.env.setTimeout(() => { cleanup(); reject(new Error(message)); }, milliseconds);
      task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }
}
