import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PcmTurnDetector, pcmToBase64} from '../lib/pcm-stream';
import {StreamingPcmResampler} from '../public/pcm-capture-worklet.js';
import {ShadowRealtimeAudioCapture, type ShadowRealtimeAudioOptions, type ShadowRealtimeBridge, type ShadowRealtimeEnvironment, type ShadowSpeechEvent} from '../lib/shadow-realtime-audio';
import {deferred, settle, SyntheticClock, SyntheticStream, SyntheticTrack} from './shadow-audio-harness';

const pcm = (milliseconds = 20, level = .05) => new Int16Array(milliseconds * 24).fill(Math.trunc(level * 32767));
const concatenate = (chunks: Int16Array[]) => Int16Array.from(chunks.flatMap(chunk => [...chunk]));

test('actual worklet resampler preserves arbitrary 44.1/48/96 kHz packet boundaries and stereo mixing', () => {
  for (const rate of [24000, 44100, 48000, 96000]) {
    const frames = rate + 137;
    const left = Float32Array.from({length: frames}, (_, i) => Math.sin(i * 2 * Math.PI * 430 / rate) * .2);
    const right = Float32Array.from({length: frames}, (_, i) => Math.cos(i * 2 * Math.PI * 700 / rate) * .4);
    const batch = new StreamingPcmResampler(rate);
    const expected = concatenate([batch.push([left, right]), batch.flush()]);
    const streaming = new StreamingPcmResampler(rate);
    const chunks: Int16Array[] = [];
    for (let at = 0; at < frames; at += 137) chunks.push(streaming.push([left.subarray(at, at + 137), right.subarray(at, at + 137)]));
    chunks.push(streaming.flush());
    const actual = concatenate(chunks);
    assert.equal(actual.length, Math.ceil(frames * 24000 / rate));
    assert.deepEqual(actual, expected, `${rate} Hz conversion changed at a render quantum boundary`);
    assert.equal(actual[0], Math.trunc((left[0] + right[0]) / 2 * 32767));
  }
});

test('resampler sanitizes nonfinite input, clips PCM16 and retains a single final sample', () => {
  const resampler = new StreamingPcmResampler(24000);
  assert.deepEqual([...concatenate([resampler.push([new Float32Array([Infinity, NaN, -2, 2, .5])]), resampler.flush()])], [0, 0, -32768, 32767, 16383]);
  assert.equal(resampler.flush().length, 0);
  assert.throws(() => new StreamingPcmResampler(0), /sample rate/);
  assert.equal(pcmToBase64(new Int16Array([-32768, 32767])), 'AID/fw==');
});

test('VAD streams the first speech packet with exactly 300 ms pre-roll, and commits after 700 ms silence', () => {
  const vad = new PcmTurnDetector();
  for (let n = 0; n < 40; n++) assert.deepEqual(vad.push(pcm(20, 0)), []);
  const speech = vad.push(pcm());
  assert.equal(speech.filter(event => event.kind === 'append').reduce((sum, event) => sum + (event.kind === 'append' ? event.pcm.length : 0), 0), 7200);
  assert.equal(speech.at(-1)?.kind, 'append');
  for (let n = 0; n < 34; n++) assert.deepEqual(vad.push(pcm(20, 0)).map(event => event.kind), ['append']);
  assert.deepEqual(vad.push(pcm(20, 0)).map(event => event.kind), ['append', 'commit']);
  assert.deepEqual(vad.finish(), []);
});

test('Aster minimum is total turn duration, max turn is 18 s, Stop flushes >=100 ms only', () => {
  const short = new PcmTurnDetector();
  short.push(pcm(20));
  for (let n = 0; n < 34; n++) short.push(pcm(20, 0));
  assert.deepEqual(short.push(pcm(20, 0)).map(event => event.kind), ['append', 'commit']);
  const vad = new PcmTurnDetector();
  for (let n = 0; n < 899; n++) assert.ok(vad.push(pcm()).every(event => event.kind === 'append'));
  assert.deepEqual(vad.push(pcm()).map(event => event.kind), ['append', 'commit']);
  for (const duration of [20, 80, 100, 120]) {
    const final = new PcmTurnDetector(); final.push(pcm(duration));
    assert.deepEqual(final.finish(), [{kind: duration >= 100 ? 'commit' : 'clear'}]);
    assert.deepEqual(final.finish(), []);
  }
});

class FakeWorklet {
  closed = 0; disconnected = 0; connected = 0;
  onprocessorerror: (() => void) | null = null;
  port = {
    onmessage: null as ((event: {data: unknown}) => void) | null,
    postMessage: (message: {type: string}) => {
      if (message.type === 'stop') queueMicrotask(() => { this.emit(pcm(5)); this.port.onmessage?.({data: {type: 'drained'}}); });
    },
    close: () => { this.closed++; },
  };
  connect() { this.connected++; }
  disconnect() { this.disconnected++; }
  emit(samples: Int16Array) { this.port.onmessage?.({data: {type: 'pcm', buffer: samples.buffer}}); }
}

function harness(overrides: Partial<ShadowRealtimeAudioOptions> = {}) {
  const clock = new SyntheticClock();
  const pc = new SyntheticStream([new SyntheticTrack('audio', 'PC'), new SyntheticTrack('video', 'screen')]);
  const mic = new SyntheticStream([new SyntheticTrack('audio', 'MIC')]);
  const events: string[] = [];
  const worklets: FakeWorklet[] = [];
  const transcripts: {text: string; source: string}[] = [];
  const partials: {text: string; source: string}[] = [];
  const errors: Error[] = [];
  const calls: {kind: string; requestId: string; base64?: string; source?: string; discard?: boolean; language?: string}[] = [];
  const statuses: {status: string; pending: number}[] = [];
  const context = {resumes: 0, closes: 0, disconnects: 0};
  let sequence = 0;
  let listener: ((event: ShadowSpeechEvent) => void) | undefined;
  const environment: ShadowRealtimeEnvironment = {
    getDisplayMedia: () => { events.push('display'); return Promise.resolve(pc.asMedia()); },
    getUserMedia: () => { events.push('microphone'); return Promise.resolve(mic.asMedia()); },
    createAudioStream: tracks => new SyntheticStream(tracks as unknown as SyntheticTrack[]).asMedia(),
    createAudioContext: () => ({
      resume: async () => { context.resumes++; }, close: async () => { context.closes++; },
      audioWorklet: {addModule: async () => { events.push('module'); }}, destination: {},
      createMediaStreamSource: () => ({connect() {}, disconnect() { context.disconnects++; }}),
    }) as unknown as AudioContext,
    createWorklet: () => { const worklet = new FakeWorklet(); worklets.push(worklet); return worklet as unknown as AudioWorkletNode; },
    setTimeout: clock.timeout, clearTimeout: clock.clear, randomId: () => `capture-${++sequence}`,
  };
  const bridge: ShadowRealtimeBridge = {
    speechStart: async request => { calls.push({kind: 'start', ...request}); },
    speechAppend: async request => { calls.push({kind: 'append', ...request}); },
    speechCommit: async request => { calls.push({kind: 'commit', ...request}); },
    speechStop: async request => { calls.push({kind: 'stop', ...request}); },
    speechCancel: async request => { calls.push({kind: 'cancel', ...request}); },
    onSpeechEvent: callback => { listener = callback; return () => { listener = undefined; }; },
  };
  const capture = new ShadowRealtimeAudioCapture({
    bridge, environment,
    onTranscript: (text, source) => transcripts.push({text, source}),
    onPartial: (text, source) => partials.push({text, source}),
    onError: error => errors.push(error),
    onStatus: (status, pending) => statuses.push({status, pending}),
    ...overrides,
  });
  const emit = (event: ShadowSpeechEvent) => listener?.(event);
  return {clock, pc, mic, environment, bridge, events, worklets, transcripts, partials, errors, calls, statuses, context, capture, emit};
}

test('gesture opens PC chooser before preparation; mic starts only after preparation; each source streams independently', async () => {
  const h = harness({language: 'hi'});
  const prepare = deferred<void>();
  const starting = h.capture.start({pc: true, mic: true, prepare: () => { h.events.push('vault'); return prepare.promise; }});
  assert.deepEqual(h.events, ['display', 'vault']);
  prepare.resolve(); await starting;
  assert.deepEqual(h.events, ['display', 'vault', 'microphone', 'module']);
  assert.deepEqual(h.calls.map(call => [call.kind, call.source, call.language]), [['start', 'PC', 'hi'], ['start', 'MIC', 'hi']]);
  h.worklets[0].emit(pcm()); h.worklets[1].emit(pcm()); await settle();
  assert.deepEqual(h.calls.filter(call => call.kind === 'append').map(call => call.requestId), ['capture-1', 'capture-2']);
  assert.equal(h.calls.filter(call => call.kind === 'append').every(call => Buffer.from(call.base64!, 'base64').length === 960), true);
  assert.equal(h.calls.some(call => call.kind === 'commit'), false);
  h.capture.cancel();
  assert.ok([...h.pc.getTracks(), ...h.mic.getTracks()].every(track => track.readyState === 'ended'));
  assert.equal(h.context.closes, 1); assert.equal(h.clock.tasks.size, 0);
});

test('PC-only skips mic; Stop releases tracks immediately and drains final PCM, commit and transcript before resolving', async () => {
  const h = harness(); const final = deferred<void>(); const draining = deferred<void>();
  h.bridge.speechStop = async request => { h.calls.push({kind: 'stop', ...request}); draining.resolve(); await final.promise; h.emit({requestId: request.requestId, source: 'PC', kind: 'final', itemId: 'last', text: ' final words '}); };
  await h.capture.start({pc: true, mic: false});
  for (let n = 0; n < 6; n++) h.worklets[0].emit(pcm());
  const stopping = h.capture.stop();
  assert.ok(h.pc.getTracks().every(track => track.readyState === 'ended'));
  assert.equal(h.events.includes('microphone'), false);
  await draining.promise;
  assert.equal(h.calls.filter(call => call.kind === 'append').length, 7);
  assert.deepEqual(h.calls.slice(-2).map(call => call.kind), ['commit', 'stop']);
  assert.deepEqual(h.transcripts, []);
  final.resolve(); await stopping;
  assert.deepEqual(h.transcripts, [{text: 'final words', source: 'PC'}]);
  assert.equal(h.worklets[0].closed, 1); assert.equal(h.worklets[0].disconnected, 1);
  assert.equal(h.context.closes, 1); assert.equal(h.clock.tasks.size, 0);
  h.emit({requestId: 'capture-1', source: 'PC', kind: 'final', text: 'stale'});
  assert.equal(h.transcripts.length, 1);
});

test('cancel suppresses stale callbacks and immediately resolves a stuck graceful stop', async () => {
  const h = harness(); h.bridge.speechAppend = () => new Promise(() => {});
  await h.capture.start({pc: true, mic: false});
  h.worklets[0].emit(pcm(120));
  const stopping = h.capture.stop(); h.capture.cancel(); await stopping;
  h.emit({requestId: 'capture-1', source: 'PC', kind: 'final', text: 'stale'});
  assert.equal(h.transcripts.length, 0); assert.equal(h.errors.length, 0); assert.equal(h.clock.tasks.size, 0);
  assert.equal(h.context.closes, 1); assert.equal(h.worklets[0].closed, 1);
});

test('partial drafts are accumulated by item, finals deduplicate, and sources never cross', async () => {
  const h = harness(); await h.capture.start({pc: true, mic: true});
  h.emit({requestId: 'capture-1', source: 'MIC', kind: 'final', text: 'wrong source'});
  h.emit({requestId: 'capture-1', source: 'PC', kind: 'partial', itemId: 'a', text: 'first'});
  h.emit({requestId: 'capture-1', source: 'PC', kind: 'partial', itemId: 'b', text: 'second'});
  assert.equal(h.partials.at(-1)?.text, 'first second');
  h.emit({requestId: 'capture-1', source: 'PC', kind: 'final', itemId: 'a', text: 'first done'});
  assert.equal(h.partials.at(-1)?.text, 'second');
  h.emit({requestId: 'capture-1', source: 'PC', kind: 'final', itemId: 'a', text: 'duplicate'});
  assert.deepEqual(h.transcripts, [{text: 'first done', source: 'PC'}]); h.capture.cancel();
});

test('a blocked source cannot delay the other source and queue overflow errors instead of dropping PCM', async () => {
  const h = harness({maxPendingPackets: 3});
  h.bridge.speechAppend = async request => { h.calls.push({kind: 'append', ...request}); if (request.requestId === 'capture-1') await new Promise(() => {}); };
  await h.capture.start({pc: true, mic: true});
  h.worklets[0].emit(pcm()); h.worklets[1].emit(pcm()); await settle();
  assert.equal(h.calls.filter(call => call.kind === 'append').length, 2);
  h.worklets[0].emit(pcm()); h.worklets[0].emit(pcm()); h.worklets[0].emit(pcm()); await settle();
  assert.match(h.errors[0]?.message ?? '', /queue reached its limit/);
  assert.ok([...h.pc.getTracks(), ...h.mic.getTracks()].every(track => track.readyState === 'ended'));
  assert.equal(h.clock.tasks.size, 0); assert.equal(h.context.closes, 1);
});

test('source ending, worklet errors, request timeout and stop deadline clean up all owned resources', async () => {
  for (const failure of ['ended', 'worklet', 'timeout', 'stop-timeout']) {
    const h = harness({requestTimeoutMs: 1000, stopTimeoutMs: 1000});
    await h.capture.start({pc: true, mic: true});
    if (failure === 'ended') h.pc.getTracks()[1].end();
    if (failure === 'worklet') h.worklets[0].onprocessorerror?.();
    if (failure === 'timeout') { h.bridge.speechAppend = () => new Promise(() => {}); h.worklets[0].emit(pcm()); await h.clock.advance(1000); }
    if (failure === 'stop-timeout') { h.worklets[0].port.postMessage = () => {}; const stopping = h.capture.stop(); await h.clock.advance(1000); await stopping; }
    await settle();
    assert.equal(h.errors.length, 1, failure);
    assert.ok([...h.pc.getTracks(), ...h.mic.getTracks()].every(track => track.readyState === 'ended'), failure);
    assert.equal(h.context.closes, 1, failure); assert.equal(h.clock.tasks.size, 0, failure);
    assert.ok(h.worklets.every(worklet => worklet.closed === 1 && worklet.disconnected === 1), failure);
  }
});

test('late chooser and credential failures release late captures without requesting a microphone', async () => {
  for (const credentialFailure of [false, true]) {
    const h = harness(); const chooser = deferred<MediaStream>(); h.environment.getDisplayMedia = () => chooser.promise;
    const starting = h.capture.start({pc: true, mic: true, prepare: credentialFailure ? async () => { throw new Error('Connect credential'); } : undefined});
    const rejection = assert.rejects(starting, credentialFailure ? /Connect credential/ : {name: 'AbortError'});
    if (credentialFailure) await rejection; else await h.capture.stop();
    chooser.resolve(h.pc.asMedia()); await rejection; await settle();
    assert.ok(h.pc.getTracks().every(track => track.readyState === 'ended'));
    assert.equal(h.events.includes('microphone'), false); assert.equal(h.worklets.length, 0); assert.equal(h.clock.tasks.size, 0);
  }
});

test('missing audio and failed setup release all tracks', async () => {
  const noAudio = harness();
  noAudio.environment.getDisplayMedia = async () => new SyntheticStream([new SyntheticTrack('video', 'screen')]).asMedia();
  await assert.rejects(noAudio.capture.start({pc: true, mic: false}), /No PC audio/);
  const h = harness(); h.environment.createWorklet = () => { throw new Error('Worklet failed'); };
  await assert.rejects(h.capture.start({pc: true, mic: true}), /Worklet failed/);
  assert.ok([...h.pc.getTracks(), ...h.mic.getTracks()].every(track => track.readyState === 'ended'));
  assert.equal(h.context.closes, 1); assert.equal(h.clock.tasks.size, 0);
});
