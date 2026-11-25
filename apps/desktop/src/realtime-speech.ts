import WebSocket, {type ClientOptions, type RawData} from 'ws';

export const PCM_PACKET_MAX_BYTES = 24 * 1024;
export const REALTIME_MAX_BUFFERED_BYTES = 256 * 1024;
export const REALTIME_MAX_EVENT_BYTES = 2 * 1024 * 1024;
export const REALTIME_READY_TIMEOUT_MS = 25_000;
export const REALTIME_DRAIN_TIMEOUT_MS = 6_000;
export const REALTIME_TRANSCRIPTION_MODEL = 'gpt-live-transcribe';
const ENDPOINT = 'wss://api.openai.com/v1/realtime?intent=transcription';
const MAX_TURNS = 64;
const MAX_TEXT = 100_000;

export type RealtimeSpeechEvent = {
  kind: 'partial' | 'final' | 'error' | 'status';
  itemId?: string;
  text?: string;
  message?: string;
};
export type RealtimeSpeechSocket = Pick<WebSocket, 'on' | 'send' | 'close' | 'terminate' | 'readyState' | 'bufferedAmount'>;
export type RealtimeSpeechOptions = {
  key: string;
  language?: string;
  onEvent: (event: RealtimeSpeechEvent) => void;
  socketFactory?: (url: string, options: ClientOptions) => RealtimeSpeechSocket;
};

/** Main-process only. The API key is used solely in the fixed OpenAI handshake. */
export class RealtimeSpeechSession {
  private socket?: RealtimeSpeechSocket;
  private state: 'new' | 'starting' | 'ready' | 'stopping' | 'closed' = 'new';
  private startPromise?: Promise<void>;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private readyTimer?: ReturnType<typeof setTimeout>;
  private drainTimer?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private stopPromise?: Promise<void>;
  private stopResolve?: () => void;
  private failure?: string;
  private updateSent = false;
  private uncommittedBytes = 0;
  private outstandingTurns = 0;
  private unacknowledgedTurns = 0;
  private order: string[] = [];
  private partials = new Map<string, string>();
  private completed = new Map<string, string>();
  private emitted = new Set<string>();
  private sends = new Set<(error: Error) => void>();

  constructor(private readonly options: RealtimeSpeechOptions) {
    if (!options.key || /[\r\n]/.test(options.key)) throw new Error('OpenAI API key is required');
    if (options.language !== undefined && !/^[a-z]{2}$/.test(options.language)) {
      throw new Error('Language must be a two-letter ISO code');
    }
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.state !== 'new') return Promise.reject(new Error('Transcription session is closed'));
    this.state = 'starting';
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyTimer = setTimeout(() => this.fail('Transcription connection timed out. Restart listening.'), REALTIME_READY_TIMEOUT_MS);
    this.emit({kind: 'status', message: 'Connecting to live transcription'});
    try {
      this.socket = (this.options.socketFactory ?? ((url, options) => new WebSocket(url, options)))(ENDPOINT, {
        headers: {Authorization: `Bearer ${this.options.key}`},
        maxPayload: REALTIME_MAX_EVENT_BYTES,
        handshakeTimeout: REALTIME_READY_TIMEOUT_MS,
        followRedirects: false,
        perMessageDeflate: false,
      });
      this.socket.on('open', () => this.opened());
      this.socket.on('message', (data: RawData, binary: boolean) => this.received(data, binary));
      this.socket.on('error', () => this.fail('Live transcription connection failed. Check your connection and API access.'));
      this.socket.on('close', () => {
        if (this.closeTimer) clearTimeout(this.closeTimer);
        if (this.state !== 'closed') this.fail('Transcription connection closed. Restart listening.');
      });
    } catch {
      this.fail('Could not open live transcription. Check your connection and API access.');
    }
    return this.startPromise;
  }

  async append(base64PCM: string): Promise<void> {
    this.assertReady();
    if (typeof base64PCM !== 'string' || !base64PCM.length || base64PCM.length > Math.ceil(PCM_PACKET_MAX_BYTES / 3) * 4 ||
        base64PCM.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64PCM)) {
      throw new Error('Invalid PCM audio packet');
    }
    const pcm = Buffer.from(base64PCM, 'base64');
    if (!pcm.length || pcm.length % 2 !== 0 || pcm.length > PCM_PACKET_MAX_BYTES || pcm.toString('base64') !== base64PCM) {
      throw new Error('Expected a nonempty PCM16 audio packet below 24 KB');
    }
    this.uncommittedBytes += pcm.length;
    await this.send({type: 'input_audio_buffer.append', audio: base64PCM});
  }

  async commit(): Promise<void> {
    this.assertReady();
    if (!this.uncommittedBytes) return;
    if (this.uncommittedBytes < 4_800) throw new Error('A speech turn needs at least 100 ms of audio');
    if (this.outstandingTurns >= MAX_TURNS) {
      this.fail('Live transcription is falling behind. Stop and restart listening.');
      throw new Error(this.failure!);
    }
    this.uncommittedBytes = 0;
    this.outstandingTurns++;
    this.unacknowledgedTurns++;
    await this.send({type: 'input_audio_buffer.commit'});
  }

  async clear(): Promise<void> {
    this.assertReady();
    this.uncommittedBytes = 0;
    await this.send({type: 'input_audio_buffer.clear'});
  }

  /** Capture must flush and commit the last qualified turn before calling stop. */
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.state === 'closed') return Promise.resolve();
    if (this.state !== 'ready') {
      this.cancel();
      return Promise.resolve();
    }
    this.state = 'stopping';
    this.stopPromise = new Promise<void>(resolve => { this.stopResolve = resolve; });
    this.drainTimer = setTimeout(() => {
      this.emit({kind: 'error', message: 'Timed out waiting for the last speech transcript. Some final text may be missing.'});
      this.finish();
    }, REALTIME_DRAIN_TIMEOUT_MS);
    this.maybeDrained();
    return this.stopPromise;
  }

  cancel(): void {
    if (this.state === 'closed') return;
    this.finish(new Error('Live transcription cancelled'), true);
  }

  private assertReady(): void {
    if (this.state !== 'ready') throw new Error(this.failure ?? 'Live transcription is not ready');
  }

  private opened(): void {
    if (this.state !== 'starting') return;
    this.updateSent = true;
    const transcription = {model: REALTIME_TRANSCRIPTION_MODEL, ...(this.options.language ? {languages: [this.options.language]} : {})};
    void this.send({type: 'session.update', session: {type: 'transcription', audio: {input: {
      format: {type: 'audio/pcm', rate: 24000}, transcription, turn_detection: null,
    }}}}).catch(() => {});
  }

  private send(event: object): Promise<void> {
    const socket = this.socket;
    const payload = JSON.stringify(event);
    if (!socket || socket.readyState !== WebSocket.OPEN || this.state === 'closed') {
      return Promise.reject(new Error(this.failure ?? 'Live transcription connection is unavailable'));
    }
    if (socket.bufferedAmount + Buffer.byteLength(payload) > REALTIME_MAX_BUFFERED_BYTES || this.sends.size >= 128) {
      this.fail('Audio connection is too slow. Stop and restart listening.');
      return Promise.reject(new Error(this.failure!));
    }
    return new Promise<void>((resolve, reject) => {
      const rejectSend = (error: Error) => { this.sends.delete(rejectSend); reject(error); };
      this.sends.add(rejectSend);
      try {
        socket.send(payload, error => {
          if (!this.sends.delete(rejectSend)) return;
          if (error) {
            this.fail('Could not send live audio. Restart listening.');
            reject(new Error(this.failure!));
          } else resolve();
          this.maybeDrained();
        });
      } catch {
        this.fail('Could not send live audio. Restart listening.');
      }
    });
  }

  private received(data: RawData, binary: boolean): void {
    if (this.state === 'closed') return;
    const bytes = Array.isArray(data) ? data.reduce((sum, part) => sum + part.byteLength, 0) : data.byteLength;
    if (binary || bytes > REALTIME_MAX_EVENT_BYTES) {
      this.fail('Live transcription returned an invalid or oversized event.');
      return;
    }
    let event: Record<string, unknown>;
    try {
      const raw = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      event = parsed as Record<string, unknown>;
    } catch {
      this.fail('Live transcription returned an invalid event.');
      return;
    }
    if (event.type === 'session.updated' || event.type === 'transcription_session.updated') {
      if (this.state === 'starting' && this.updateSent) {
        this.state = 'ready';
        if (this.readyTimer) clearTimeout(this.readyTimer);
        this.readyResolve?.();
        this.readyResolve = this.readyReject = undefined;
        this.emit({kind: 'status', message: 'Live transcription ready'});
      }
      return;
    }
    if (event.type === 'error') {
      this.fail('OpenAI rejected live transcription. Check your API key, quota, and model access.');
      return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.failed') {
      this.fail('A speech turn could not be transcribed. Restart listening.');
      return;
    }
    if (event.type !== 'input_audio_buffer.committed' && event.type !== 'conversation.item.input_audio_transcription.delta' &&
        event.type !== 'conversation.item.input_audio_transcription.completed') return;
    const id = event.item_id;
    if (typeof id !== 'string' || !id.length || id.length > 256) {
      this.fail('Live transcription returned an invalid speech item.');
      return;
    }
    if (this.emitted.has(id)) return;
    if (event.type === 'input_audio_buffer.committed') {
      if (!this.order.includes(id)) {
        if (!this.unacknowledgedTurns) { this.fail('Live transcription returned an unexpected speech turn.'); return; }
        this.unacknowledgedTurns--;
        this.order.push(id);
      }
    } else if (event.type === 'conversation.item.input_audio_transcription.delta') {
      if (this.completed.has(id)) return;
      if (typeof event.delta !== 'string') { this.fail('Live transcription returned invalid text.'); return; }
      const text = (this.partials.get(id) ?? '') + event.delta;
      if (text.length > MAX_TEXT) { this.fail('Live transcription speech text exceeded its limit.'); return; }
      this.partials.set(id, text);
      this.emit({kind: 'partial', itemId: id, text});
    } else {
      if (typeof event.transcript !== 'string' || event.transcript.length > MAX_TEXT) {
        this.fail('Live transcription returned invalid text.'); return;
      }
      this.completed.set(id, event.transcript);
      this.partials.delete(id);
    }
    if (this.partials.size > MAX_TURNS || this.completed.size > MAX_TURNS) {
      this.fail('Live transcription returned too many pending speech turns.'); return;
    }
    this.emitCompleted();
  }

  private emitCompleted(): void {
    while (this.order.length && this.completed.has(this.order[0]) && this.state !== 'closed') {
      const itemId = this.order.shift()!;
      const text = this.completed.get(itemId)!.trim();
      this.completed.delete(itemId);
      this.partials.delete(itemId);
      this.outstandingTurns--;
      this.emitted.add(itemId);
      if (this.emitted.size > 128) this.emitted.delete(this.emitted.values().next().value!);
      if (text) this.emit({kind: 'final', itemId, text});
      this.emit({kind: 'partial', itemId, text: ''});
    }
    this.maybeDrained();
  }

  private maybeDrained(): void {
    if (this.state === 'stopping' && this.outstandingTurns === 0 && this.sends.size === 0) this.finish();
  }

  private emit(event: RealtimeSpeechEvent): void {
    if (this.state === 'closed') return;
    try { this.options.onEvent(event); } catch { /* UI consumers cannot break the audio connection. */ }
  }

  private fail(message: string): void {
    if (this.state === 'closed') return;
    this.failure = message;
    this.emit({kind: 'error', message});
    this.finish(new Error(message), true);
  }

  private finish(error?: Error, abort = false): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.readyReject?.(error ?? new Error('Live transcription stopped'));
    this.readyResolve = this.readyReject = undefined;
    for (const reject of [...this.sends]) reject(error ?? new Error('Live transcription stopped'));
    this.order = [];
    this.partials.clear();
    this.completed.clear();
    this.emitted.clear();
    if (this.socket) {
      try {
        if (abort) this.socket.terminate();
        else {
          this.socket.close(1000);
          if (this.socket.readyState !== WebSocket.CLOSED) {
            const socket = this.socket;
            this.closeTimer = setTimeout(() => { try { socket.terminate(); } catch {} }, 250);
            this.closeTimer.unref();
          }
        }
      } catch { /* Already disconnected. */ }
    }
    this.stopResolve?.();
    this.stopResolve = undefined;
  }
}
