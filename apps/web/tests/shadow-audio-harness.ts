// Synthetic media only. This harness never accesses browser devices or a provider.
import type {ShadowAudioEnvironment} from '../lib/shadow-audio';
export const deferred = <T>() => {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
export const settle = async () => { for (let n = 0; n < 15; n++) await Promise.resolve(); };
export class SyntheticTrack extends EventTarget {
  readyState = 'live'; stops = 0;
  constructor(readonly kind: 'audio' | 'video', readonly label: string, public level = .05) { super(); }
  stop() { this.stops++; this.readyState = 'ended'; }
  end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')); }
}
export class SyntheticStream {
  constructor(readonly tracks: SyntheticTrack[]) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  asMedia() { return this as unknown as MediaStream; }
}
export class SyntheticRecorder {
  state = 'inactive'; mimeType = 'audio/webm;codecs=opus'; starts = 0; stops = 0;
  ondataavailable?: (event: {data: Blob}) => void;
  onstop?: () => void; onerror?: () => void;
  constructor(readonly stream: SyntheticStream, readonly id: number) {}
  start() { this.starts++; this.state = 'recording'; }
  stop() {
    if (this.state !== 'recording') return;
    this.stops++; this.state = 'inactive';
    // EBML magic distinguishes complete fake files in lifecycle assertions.
    // Real browser/ffmpeg decoding is covered by the synthetic browser harness.
    this.ondataavailable?.({data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), `synthetic-recording-${this.id}`], {type: this.mimeType})});
    this.onstop?.();
  }
  asRecorder() { return this as unknown as MediaRecorder; }
}
export class SyntheticClock {
  now = 0; sequence = 0;
  tasks = new Map<number, {at: number; interval: number; callback: () => void}>();
  timeout = ((callback: () => void, delay: number) => this.add(callback, delay, 0)) as unknown as typeof globalThis.setTimeout;
  interval = ((callback: () => void, delay: number) => this.add(callback, delay, delay)) as unknown as typeof globalThis.setInterval;
  clear = ((id: number) => { this.tasks.delete(id); }) as unknown as typeof globalThis.clearTimeout;
  private add(callback: () => void, delay: number, interval: number) { const id = ++this.sequence; this.tasks.set(id, {at: this.now + delay, interval, callback}); return id; }
  async advance(milliseconds: number) {
    const end = this.now + milliseconds;
    for (;;) {
      const next = [...this.tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, task] = next; this.now = task.at;
      if (task.interval) task.at += task.interval; else this.tasks.delete(id);
      task.callback(); await settle();
    }
    this.now = end; await settle();
  }
}
export function mediaHarness() {
  const clock = new SyntheticClock();
  const pc = new SyntheticStream([new SyntheticTrack('audio', 'PC'), new SyntheticTrack('video', 'screen')]);
  const mic = new SyntheticStream([new SyntheticTrack('audio', 'MIC')]);
  const recorders: SyntheticRecorder[] = []; const events: string[] = [];
  const contexts: {resumes: number; closes: number}[] = [];
  const environment: ShadowAudioEnvironment = {
    getDisplayMedia: () => { events.push('display'); return Promise.resolve(pc.asMedia()); },
    getUserMedia: () => { events.push('microphone'); return Promise.resolve(mic.asMedia()); },
    createAudioStream: tracks => new SyntheticStream(tracks as unknown as SyntheticTrack[]).asMedia(),
    createRecorder: stream => { const recorder = new SyntheticRecorder(stream as unknown as SyntheticStream, recorders.length); recorders.push(recorder); return recorder.asRecorder(); },
    createAudioContext: () => {
      const counts = {resumes: 0, closes: 0}; contexts.push(counts);
      return {
        resume: async () => { counts.resumes++; }, close: async () => { counts.closes++; },
        createAnalyser: () => ({fftSize: 512, track: undefined as SyntheticTrack | undefined, disconnect() {}, getFloatTimeDomainData(samples: Float32Array) { samples.fill(this.track?.level ?? 0); }}),
        createMediaStreamSource: (stream: MediaStream) => ({connect(analyser: {track: SyntheticTrack}) { analyser.track = (stream as unknown as SyntheticStream).getAudioTracks()[0]; }, disconnect() {}}),
      } as unknown as AudioContext;
    },
    setTimeout: clock.timeout, clearTimeout: clock.clear, setInterval: clock.interval, clearInterval: clock.clear,
  };
  return {environment, pc, mic, clock, recorders, events, contexts};
}
