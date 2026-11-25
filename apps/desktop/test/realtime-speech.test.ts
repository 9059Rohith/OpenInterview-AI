import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {ClientOptions} from 'ws';
import {
  RealtimeSpeechSession, type RealtimeSpeechEvent, type RealtimeSpeechSocket,
  PCM_PACKET_MAX_BYTES, REALTIME_MAX_BUFFERED_BYTES, REALTIME_MAX_EVENT_BYTES,
  REALTIME_READY_TIMEOUT_MS, REALTIME_DRAIN_TIMEOUT_MS,
} from '../src/realtime-speech.js';

class FakeSocket extends EventEmitter {
  readyState = 0;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  terminated = false;
  closed = false;
  deferSends = false;
  callbacks: ((error?: Error) => void)[] = [];
  open() { this.readyState = 1; this.emit('open'); }
  event(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
  send(data: string, callback: (error?: Error) => void) {
    this.sent.push(JSON.parse(data));
    if (this.deferSends) this.callbacks.push(callback);
    else callback();
  }
  close() { this.closed = true; this.readyState = 3; this.emit('close'); }
  terminate() { this.terminated = true; this.readyState = 3; this.emit('close'); }
}

const audio = Buffer.alloc(9_600).toString('base64');
function fixture(language?: string) {
  const socket = new FakeSocket();
  const events: RealtimeSpeechEvent[] = [];
  let handshake: {url: string; options: ClientOptions} | undefined;
  const session = new RealtimeSpeechSession({key: 'synthetic-key-never-rendered', language,
    onEvent: event => events.push(event),
    socketFactory: (url, options) => { handshake = {url, options}; return socket as unknown as RealtimeSpeechSocket; },
  });
  async function ready() {
    const started = session.start();
    socket.open();
    socket.event({type: 'session.updated'});
    await started;
  }
  return {session, socket, events, ready, get handshake() { return handshake; }};
}

test('fixed authenticated session negotiates true live Aster transcription before sending PCM', async () => {
  const f = fixture('en');
  await assert.rejects(f.session.append(audio), /not ready/);
  await f.ready();
  assert.equal(f.handshake!.url, 'wss://api.openai.com/v1/realtime?intent=transcription');
  assert.deepEqual(f.handshake!.options.headers, {Authorization: 'Bearer synthetic-key-never-rendered'});
  assert.equal(f.handshake!.options.maxPayload, REALTIME_MAX_EVENT_BYTES);
  assert.equal(f.handshake!.options.followRedirects, false);
  assert.deepEqual(f.socket.sent[0], {type: 'session.update', session: {type: 'transcription', audio: {input: {
    format: {type: 'audio/pcm', rate: 24000}, transcription: {model: 'gpt-live-transcribe', languages: ['en']}, turn_detection: null,
  }}}});
  await f.session.append(audio);
  assert.deepEqual(f.socket.sent[1], {type: 'input_audio_buffer.append', audio});
  await f.session.commit();
  assert.deepEqual(f.socket.sent[2], {type: 'input_audio_buffer.commit'});
  assert.equal(JSON.stringify(f.events).includes('synthetic-key'), false);
  f.session.cancel();
});

test('audio validation prevents malformed, odd, noncanonical, oversized, and short-turn packets', async () => {
  const f = fixture(); await f.ready();
  for (const invalid of ['', '!!!=', 'AA==', 'AB==', Buffer.alloc(PCM_PACKET_MAX_BYTES + 2).toString('base64')]) {
    await assert.rejects(f.session.append(invalid), /PCM/);
  }
  await f.session.commit();
  assert.equal(f.socket.sent.length, 1, 'empty commit is omitted');
  await f.session.append(Buffer.alloc(960).toString('base64'));
  await assert.rejects(f.session.commit(), /100 ms/);
  await f.session.clear();
  await f.session.commit();
  assert.deepEqual(f.socket.sent.at(-1), {type: 'input_audio_buffer.clear'});
  f.session.cancel();
  assert.throws(() => new RealtimeSpeechSession({key: 'key\nheader', onEvent() {}}), /API key/);
  assert.throws(() => new RealtimeSpeechSession({key: 'key', language: 'english', onEvent() {}}), /Language/);
});

test('readiness requires configuration acknowledgement and times out without leaking errors', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture();
  const started = f.session.start();
  const rejected = assert.rejects(started, /timed out/);
  f.socket.event({type: 'session.updated'}); // An acknowledgement before our update cannot establish readiness.
  t.mock.timers.tick(REALTIME_READY_TIMEOUT_MS);
  await rejected;
  assert.equal(f.socket.terminated, true);
  assert.equal(f.events.filter(event => event.kind === 'error').length, 1);
  f.socket.emit('error', new Error('private-key-and-provider-body'));
  assert.equal(JSON.stringify(f.events).includes('private-key'), false);
});

test('incremental text appears before commit and finals follow commit order despite completion races', async () => {
  const f = fixture(); await f.ready();
  await f.session.append(audio);
  f.socket.event({type: 'conversation.item.input_audio_transcription.delta', item_id: 'one', delta: 'Hel'});
  f.socket.event({type: 'conversation.item.input_audio_transcription.delta', item_id: 'one', delta: 'lo'});
  assert.equal(f.events.at(-1)?.text, 'Hello');
  await f.session.commit();
  await f.session.append(audio); await f.session.commit();
  f.socket.event({type: 'input_audio_buffer.committed', item_id: 'one'});
  // A completion may precede its own commit acknowledgement, but must not be emitted then.
  f.socket.event({type: 'conversation.item.input_audio_transcription.completed', item_id: 'two', transcript: 'Second'});
  f.socket.event({type: 'input_audio_buffer.committed', item_id: 'two', previous_item_id: 'one'});
  assert.equal(f.events.some(event => event.kind === 'final'), false);
  f.socket.event({type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: ' First '});
  assert.deepEqual(f.events.filter(event => event.kind === 'final'), [
    {kind: 'final', itemId: 'one', text: 'First'}, {kind: 'final', itemId: 'two', text: 'Second'},
  ]);
  f.socket.event({type: 'conversation.item.input_audio_transcription.completed', item_id: 'one', transcript: 'Duplicate'});
  assert.equal(f.events.filter(event => event.kind === 'final').length, 2);
  await f.session.stop();
});

test('stop drains outstanding turns then closes and suppresses all late callbacks', async () => {
  const f = fixture(); await f.ready();
  await f.session.append(audio); await f.session.commit();
  let stopped = false;
  const stop = f.session.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  await assert.rejects(f.session.append(audio), /not ready/);
  f.socket.event({type: 'input_audio_buffer.committed', item_id: 'last'});
  f.socket.event({type: 'conversation.item.input_audio_transcription.completed', item_id: 'last', transcript: 'Last words'});
  await stop;
  assert.equal(f.socket.closed, true);
  assert.equal(f.events.filter(event => event.kind === 'final').length, 1);
  const count = f.events.length;
  f.socket.event({type: 'conversation.item.input_audio_transcription.delta', item_id: 'late', delta: 'Late'});
  f.socket.emit('error', new Error('secret'));
  assert.equal(f.events.length, count);
});

test('stop timeout is bounded and cancellation immediately aborts starting or draining sessions', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture(); await f.ready();
  await f.session.append(audio); await f.session.commit();
  const stop = f.session.stop();
  t.mock.timers.tick(REALTIME_DRAIN_TIMEOUT_MS);
  await stop;
  assert.match(f.events.at(-1)!.message!, /last speech transcript/);
  assert.equal(f.socket.closed, true);
  const connecting = fixture();
  const start = connecting.session.start();
  const rejected = assert.rejects(start, /cancelled/);
  connecting.session.cancel();
  await rejected;
  assert.equal(connecting.socket.terminated, true);
  const draining = fixture(); await draining.ready();
  await draining.session.append(audio); await draining.session.commit();
  const drain = draining.session.stop();
  const count = draining.events.length;
  draining.session.cancel(); await drain;
  draining.socket.event({type: 'error', error: {message: 'secret'}});
  assert.equal(draining.events.length, count);
});

test('socket buffering and pending sends are bounded, including cancellation of hung writes', async () => {
  const f = fixture(); await f.ready();
  f.socket.bufferedAmount = REALTIME_MAX_BUFFERED_BYTES;
  await assert.rejects(f.session.append(audio), /too slow/);
  assert.equal(f.socket.terminated, true);
  const hung = fixture(); await hung.ready(); hung.socket.deferSends = true;
  const write = hung.session.append(audio);
  const rejected = assert.rejects(write, /cancelled/);
  hung.session.cancel(); await rejected;
  hung.socket.callbacks[0]();
  assert.equal(hung.socket.terminated, true);
  const stalled = fixture(); await stalled.ready(); stalled.socket.deferSends = true;
  const writes = Array.from({length: 129}, () => stalled.session.append(audio));
  const results = await Promise.allSettled(writes);
  assert.equal(stalled.socket.callbacks.length, 128);
  assert.equal(results.every(result => result.status === 'rejected'), true);
  assert.equal(stalled.socket.terminated, true);
});

test('provider errors, malformed events, oversize messages, and transport errors stay sanitized', async () => {
  const cases: ((socket: FakeSocket) => void)[] = [
    socket => socket.event({type: 'error', error: {message: 'sk-secret-token arbitrary upstream message'}}),
    socket => socket.event({type: 'conversation.item.input_audio_transcription.failed', error: {message: 'sk-secret-token'}}),
    socket => socket.emit('message', Buffer.from('sk-secret-token broken JSON'), false),
    socket => socket.emit('message', Buffer.alloc(REALTIME_MAX_EVENT_BYTES + 1), false),
    socket => socket.emit('message', Buffer.from('{}'), true),
    socket => socket.emit('error', new Error('sk-secret-token socket detail')),
  ];
  for (const trigger of cases) {
    const f = fixture(); await f.ready(); trigger(f.socket);
    assert.equal(f.socket.terminated, true);
    assert.equal(f.events.filter(event => event.kind === 'error').length, 1);
    assert.equal(JSON.stringify(f.events).includes('sk-secret-token'), false);
    await f.session.stop();
  }
});
