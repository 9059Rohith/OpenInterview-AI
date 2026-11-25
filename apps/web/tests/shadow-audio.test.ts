import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ShadowAudioCapture, type ShadowAudioOptions, type ShadowAudioSource} from '../lib/shadow-audio';
import {deferred, mediaHarness, settle, SyntheticStream, SyntheticTrack} from './shadow-audio-harness';

function setup(overrides: Partial<ShadowAudioOptions> = {}) {
  const media = mediaHarness(); const transcripts: {text: string; source: ShadowAudioSource}[] = [];
  const uploads: {blob: Blob; source: ShadowAudioSource; signal: AbortSignal}[] = [];
  const errors: Error[] = []; const statuses: {status: string; pending: number}[] = [];
  const capture = new ShadowAudioCapture({
    environment: media.environment,
    transcribe: async (blob, source, signal) => { uploads.push({blob, source, signal}); return `Transcript ${source}`; },
    onTranscript: (text, source) => transcripts.push({text, source}),
    onError: error => errors.push(error), onStatus: (status, pending) => statuses.push({status, pending}),
    ...overrides,
  });
  return {...media, capture, transcripts, uploads, errors, statuses};
}

test('display chooser is invoked in the gesture before vault preparation or microphone access', async () => {
  const media = mediaHarness(); const chooser = deferred<MediaStream>();
  media.environment.getDisplayMedia = () => { media.events.push('display'); return chooser.promise; };
  const capture = new ShadowAudioCapture({environment: media.environment, transcribe: async () => '', onTranscript() {}});
  const starting = capture.start({pc: true, mic: true, prepare: async () => { media.events.push('vault'); }});
  assert.deepEqual(media.events, ['display', 'vault']);
  chooser.resolve(media.pc.asMedia()); await starting;
  assert.deepEqual(media.events, ['display', 'vault', 'microphone']); capture.cancel();
});

test('cancelled chooser never opens a microphone or uploads anything', async () => {
  const h = setup(); h.environment.getDisplayMedia = async () => { throw new DOMException('Chooser cancelled', 'NotAllowedError'); };
  await assert.rejects(h.capture.start({pc: true, mic: true}), /Chooser cancelled/);
  assert.equal(h.events.includes('microphone'), false); assert.equal(h.uploads.length, 0);
  assert.equal(h.statuses.at(-1)?.status, 'idle'); assert.equal(h.clock.tasks.size, 0);
});

test('sharing without an audio track rejects and releases the display video track', async () => {
  const h = setup(); const video = new SyntheticTrack('video', 'screen');
  h.environment.getDisplayMedia = async () => new SyntheticStream([video]).asMedia();
  await assert.rejects(h.capture.start({pc: true, mic: false}), /No PC audio/);
  assert.equal(video.readyState, 'ended'); assert.equal(h.recorders.length, 0);
});

test('PC-only never asks microphone permission and silent sources skip provider requests', async () => {
  const h = setup(); h.pc.getAudioTracks()[0].level = 0;
  await h.capture.start({pc: true, mic: false}); await h.clock.advance(12000); await h.capture.stop();
  assert.deepEqual(h.events, ['display']); assert.equal(h.uploads.length, 0);
  assert.ok(h.pc.getTracks().every(track => track.readyState === 'ended'));
  assert.equal(h.contexts[0].resumes, 1); assert.equal(h.contexts[0].closes, 1);
});

test('microphone-only never opens a display chooser and missing mic audio cleans up both sources', async () => {
  const micOnly = setup(); await micOnly.capture.start({pc: false, mic: true}); await micOnly.clock.advance(4000);
  assert.deepEqual(micOnly.events, ['microphone']); assert.deepEqual(micOnly.uploads.map(item => item.source), ['MIC']); micOnly.capture.cancel();
  const h = setup(); h.environment.getUserMedia = async () => new SyntheticStream([]).asMedia();
  await assert.rejects(h.capture.start({pc: true, mic: true}), /microphone did not provide/);
  assert.ok(h.pc.getTracks().every(track => track.readyState === 'ended'));
});

test('microphone denial releases an already selected PC share', async () => {
  const h = setup(); h.environment.getUserMedia = async () => { throw new DOMException('Microphone denied', 'NotAllowedError'); };
  await assert.rejects(h.capture.start({pc: true, mic: true}), /Microphone denied/);
  assert.ok(h.pc.getTracks().every(track => track.readyState === 'ended')); assert.equal(h.clock.tasks.size, 0);
});

test('simultaneous PC and MIC remain separate, labeled and audio-only', async () => {
  const levels: {PC: number; MIC: number}[] = [];
  const h = setup({onLevels: next => levels.push(next)}); h.mic.getAudioTracks()[0].level = .15;
  await h.capture.start({pc: true, mic: true}); await h.clock.advance(4000);
  assert.deepEqual(h.uploads.map(item => item.source), ['PC', 'MIC']);
  assert.deepEqual(h.transcripts.map(item => item.source), ['PC', 'MIC']);
  assert.ok(levels.some(level => level.MIC > level.PC && level.PC > 0));
  assert.ok(h.recorders.every(recorder => recorder.stream.getTracks().every(track => track.kind === 'audio')));
  assert.notEqual(h.recorders[0].stream.getAudioTracks()[0], h.recorders[1].stream.getAudioTracks()[0]);
  h.capture.cancel(); assert.ok([...h.pc.getTracks(), ...h.mic.getTracks()].every(track => track.readyState === 'ended'));
});

test('every uploaded chunk has its own recorder lifetime and complete file header', async () => {
  const h = setup(); await h.capture.start({pc: true, mic: false}); await h.clock.advance(12000);
  assert.equal(h.uploads.length, 3); assert.equal(h.recorders.length, 4);
  for (let index = 0; index < h.uploads.length; index++) {
    const data = new Uint8Array(await h.uploads[index].blob.arrayBuffer());
    assert.deepEqual([...data.slice(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
    assert.match(await h.uploads[index].blob.text(), new RegExp(`synthetic-recording-${index}$`));
    assert.equal(h.recorders[index].starts, 1); assert.equal(h.recorders[index].stops, 1);
  }
  h.capture.cancel();
});

test('Stop releases all tracks immediately, flushes final words and resolves after drain', async () => {
  const response = deferred<string>(); const h = setup({transcribe: () => response.promise});
  await h.capture.start({pc: true, mic: false}); await h.clock.advance(300);
  const stopping = h.capture.stop(); let finished = false; void stopping.then(() => { finished = true; });
  assert.ok(h.pc.getTracks().every(track => track.readyState === 'ended'));
  assert.equal(h.statuses.at(-1)?.status, 'stopping'); assert.equal(finished, false);
  response.resolve(' final words '); await stopping;
  assert.deepEqual(h.transcripts, [{text: 'final words', source: 'PC'}]);
  const count = h.transcripts.length; await h.clock.advance(60000);
  assert.equal(h.transcripts.length, count); assert.equal(h.statuses.at(-1)?.status, 'idle'); assert.equal(h.clock.tasks.size, 0);
});

test('cancel aborts in-flight work, drops final chunk and suppresses late transcripts', async () => {
  const response = deferred<string>(); let requestSignal: AbortSignal | undefined;
  const h = setup({transcribe: (_blob, _source, signal) => { requestSignal = signal; return response.promise; }});
  await h.capture.start({pc: true, mic: false}); await h.clock.advance(4000); h.capture.cancel();
  assert.equal(requestSignal?.aborted, true); response.resolve('stale question?'); await settle();
  assert.equal(h.transcripts.length, 0); assert.equal(h.clock.tasks.size, 0); assert.equal(h.errors.length, 0);
});

test('transcription requests stay sequential and graceful Stop drains queued sources in order', async () => {
  const responses = [deferred<string>(), deferred<string>(), deferred<string>(), deferred<string>()];
  let requested = 0; const sources: string[] = [];
  const h = setup({transcribe: (_blob, source) => { sources.push(source); return responses[requested++].promise; }});
  await h.capture.start({pc: true, mic: true}); await h.clock.advance(4300);
  assert.equal(requested, 1); const stopping = h.capture.stop();
  assert.equal(requested, 1); assert.equal(h.statuses.at(-1)?.pending, 4);
  for (let n = 0; n < responses.length; n++) { assert.equal(requested, n + 1); responses[n].resolve(`segment ${n}`); await settle(); }
  await stopping; assert.deepEqual(sources, ['PC', 'MIC', 'PC', 'MIC']);
  assert.deepEqual(h.transcripts.map(item => item.text), ['segment 0', 'segment 1', 'segment 2', 'segment 3']);
  const calls = requested; await h.clock.advance(60000); assert.equal(requested, calls);
});

test('Stop during pending chooser releases late tracks without starting a recorder', async () => {
  const h = setup(); const chooser = deferred<MediaStream>(); h.environment.getDisplayMedia = () => chooser.promise;
  const starting = h.capture.start({pc: true, mic: false}); const rejected = assert.rejects(starting, {name: 'AbortError'});
  await h.capture.stop(); chooser.resolve(h.pc.asMedia()); await rejected;
  assert.ok(h.pc.getTracks().every(track => track.readyState === 'ended')); assert.equal(h.recorders.length, 0);
});

test('credential failure also releases a chooser stream that arrives later', async () => {
  const h = setup(); const chooser = deferred<MediaStream>(); h.environment.getDisplayMedia = () => chooser.promise;
  await assert.rejects(h.capture.start({pc: true, mic: false, prepare: async () => { throw new Error('Connect credential'); }}), /Connect credential/);
  chooser.resolve(h.pc.asMedia()); await settle();
  assert.ok(h.pc.getTracks().every(track => track.readyState === 'ended')); assert.equal(h.clock.tasks.size, 0);
});

test('a selected source ending stops both inputs and aborts transcription safely', async () => {
  const response = deferred<string>(); let signal: AbortSignal | undefined;
  const h = setup({transcribe: (_blob, _source, next) => { signal = next; return response.promise; }});
  await h.capture.start({pc: true, mic: true}); await h.clock.advance(4000); h.pc.getTracks()[1].end();
  assert.match(h.errors[0].message, /PC audio source ended/); assert.equal(signal?.aborted, true);
  assert.ok([...h.pc.getTracks(), ...h.mic.getTracks()].every(track => track.readyState === 'ended'));
  response.resolve('old'); await settle(); assert.equal(h.transcripts.length, 0);
});

test('recorder errors release every capture and do not upload malformed final data', async () => {
  const h = setup(); await h.capture.start({pc: true, mic: true}); h.recorders[0].onerror?.(); await settle();
  assert.match(h.errors[0].message, /PC audio recording failed/); assert.equal(h.uploads.length, 0);
  assert.ok([...h.pc.getTracks(), ...h.mic.getTracks()].every(track => track.readyState === 'ended')); assert.equal(h.clock.tasks.size, 0);
});

test('network timeout stops capture even if the provider ignores abort', async () => {
  const h = setup({transcribe: () => new Promise(() => {}), requestTimeoutMs: 1000});
  await h.capture.start({pc: true, mic: false}); await h.clock.advance(5000);
  assert.match(h.errors[0].message, /timed out/); assert.equal(h.statuses.at(-1)?.status, 'idle');
  assert.ok(h.pc.getTracks().every(track => track.readyState === 'ended')); assert.equal(h.clock.tasks.size, 0);
});

test('Stop has a deadline even when a broken recorder never sends its final stop event', async () => {
  const h = setup({stopTimeoutMs: 1000}); await h.capture.start({pc: true, mic: false});
  h.recorders[0].stop = function () { this.state = 'inactive'; };
  const stopping = h.capture.stop(); await h.clock.advance(1000); await stopping;
  assert.match(h.errors[0].message, /Finishing transcription timed out/); assert.equal(h.clock.tasks.size, 0);
  assert.ok(h.pc.getTracks().every(track => track.readyState === 'ended'));
});

test('cancel during a stuck graceful stop resolves immediately and suppresses late callbacks', async () => {
  const h = setup(); await h.capture.start({pc: true, mic: false});
  h.recorders[0].stop = function () { this.state = 'inactive'; };
  const stopping = h.capture.stop(); h.capture.cancel(); await stopping;
  h.recorders[0].onstop?.(); await settle(); assert.equal(h.transcripts.length, 0); assert.equal(h.clock.tasks.size, 0);
});

test('network rejection safely stops both capture and pending work', async () => {
  const h = setup({transcribe: async () => { throw new Error('Provider unavailable'); }});
  await h.capture.start({pc: true, mic: true}); await h.clock.advance(4000);
  assert.match(h.errors[0].message, /Provider unavailable/); assert.equal(h.errors.length, 1);
  assert.ok([...h.pc.getTracks(), ...h.mic.getTracks()].every(track => track.readyState === 'ended'));
});

test('slow provider is bounded and queue overflow aborts instead of growing memory', async () => {
  const h = setup({transcribe: () => new Promise(() => {}), maxPendingChunks: 2, requestTimeoutMs: 60000});
  await h.capture.start({pc: true, mic: false}); await h.clock.advance(12000);
  assert.match(h.errors[0].message, /queue reached its limit/);
  assert.ok(h.statuses.every(item => item.pending <= 2)); assert.equal(h.clock.tasks.size, 0);
  assert.ok(h.pc.getTracks().every(track => track.readyState === 'ended'));
});

test('recorded file size is bounded before enqueue', async () => {
  const h = setup({maxPendingBytes: 8}); await h.capture.start({pc: true, mic: false}); await h.clock.advance(4000);
  assert.match(h.errors[0].message, /memory limit/); assert.equal(h.uploads.length, 0); assert.equal(h.clock.tasks.size, 0);
});

test('unavailable audio metering falls back to complete audio rather than discarding it', async () => {
  const h = setup(); h.environment.createAudioContext = () => { throw new Error('No AudioContext'); };
  await h.capture.start({pc: true, mic: false}); await h.clock.advance(4000);
  assert.equal(h.uploads.length, 1); assert.equal(h.transcripts[0].source, 'PC'); h.capture.cancel();
});

test('a failed recorder start releases tracks and closes its audio context', async () => {
  const h = setup(); h.environment.createRecorder = () => { throw new Error('Recorder unsupported'); };
  await assert.rejects(h.capture.start({pc: true, mic: true}), /Recorder unsupported/);
  assert.ok([...h.pc.getTracks(), ...h.mic.getTracks()].every(track => track.readyState === 'ended'));
  assert.equal(h.contexts[0].closes, 1); assert.equal(h.clock.tasks.size, 0);
});

test('repeated start and stop cancels old results and owns only the latest session', async () => {
  const oldResponse = deferred<string>(); let requests = 0;
  const h = setup({transcribe: async () => ++requests === 1 ? oldResponse.promise : 'new session'});
  await h.capture.start({pc: true, mic: false}); await h.clock.advance(4000);
  const fresh = new SyntheticStream([new SyntheticTrack('audio', 'PC'), new SyntheticTrack('video', 'screen')]);
  h.environment.getDisplayMedia = async () => fresh.asMedia();
  await h.capture.start({pc: true, mic: false}); oldResponse.resolve('old session'); await settle();
  await h.clock.advance(4000); assert.deepEqual(h.transcripts, [{text: 'new session', source: 'PC'}]);
  h.capture.cancel(); assert.ok(fresh.getTracks().every(track => track.readyState === 'ended'));
  for (let n = 0; n < 5; n++) {
    const stream = new SyntheticStream([new SyntheticTrack('audio', 'PC'), new SyntheticTrack('video', 'screen')]);
    h.environment.getDisplayMedia = async () => stream.asMedia();
    await h.capture.start({pc: true, mic: false}); await h.capture.stop();
    assert.ok(stream.getTracks().every(track => track.readyState === 'ended')); assert.equal(h.clock.tasks.size, 0);
  }
  assert.ok(h.contexts.every(context => context.closes === 1));
});
