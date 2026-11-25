import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SpeechSessions} from '../src/speech-sessions.js';

class Session {
  cancelled = false;
  rejectStart?: (error: Error) => void;
  finishStop?: () => void;
  constructor(private pendingStart = false) {}
  start() { return this.pendingStart ? new Promise<void>((_resolve, reject) => { this.rejectStart = reject; }) : Promise.resolve(); }
  stop() { return new Promise<void>(resolve => { this.finishStop = resolve; }); }
  cancel() { this.cancelled = true; this.rejectStart?.(new Error('cancelled')); this.finishStop?.(); }
}

test('cancel/restart before old start rejection preserves replacement tracking and reload cleanup', async () => {
  const sessions = new SpeechSessions<object, Session>(), owner = {};
  const old = new Session(true), replacement = new Session();
  const started = sessions.start('same-id', owner, 'MIC', () => old);
  const rejected = assert.rejects(started, /cancelled/);
  sessions.cancel('same-id', owner);
  const restarted = sessions.start('same-id', owner, 'MIC', () => replacement);
  await Promise.all([rejected, restarted]);
  assert.equal(sessions.owned('same-id', owner).session, replacement);
  await assert.rejects(sessions.start('another-id', owner, 'MIC', () => new Session()), /already/);
  sessions.cancelOwned(owner);
  assert.equal(replacement.cancelled, true, 'replacement connection must close on reload/crash');
  assert.throws(() => sessions.owned('same-id', owner), /owned/);
});

test('cancel/restart while old stop drains cannot erase the new session', async () => {
  const sessions = new SpeechSessions<object, Session>(), owner = {};
  const old = new Session(), replacement = new Session();
  await sessions.start('same-id', owner, 'PC', () => old);
  const stopped = sessions.stop('same-id', owner);
  sessions.cancel('same-id', owner);
  const restarted = sessions.start('same-id', owner, 'PC', () => replacement);
  await Promise.all([stopped, restarted]);
  assert.equal(sessions.owned('same-id', owner).session, replacement);
  sessions.cancelAll();
  assert.equal(replacement.cancelled, true);
});

test('session IDs, sources, global capacity, and cancellation enforce window ownership', async () => {
  const sessions = new SpeechSessions<object, Session>(), owner = {}, other = {};
  const first = new Session();
  await sessions.start('one', owner, 'MIC', () => first);
  assert.throws(() => sessions.cancel('one', other), /owned/);
  await assert.rejects(sessions.stop('one', other), /owned/);
  sessions.cancelOwned(other);
  assert.equal(first.cancelled, false);
  await assert.rejects(sessions.start('one', other, 'PC', () => new Session()), /already/);
  await sessions.start('two', owner, 'PC', () => new Session());
  await sessions.start('three', other, 'MIC', () => new Session());
  await sessions.start('four', other, 'PC', () => new Session());
  await assert.rejects(sessions.start('five', {}, 'PC', () => { throw Error('must not construct'); }), /already/);
  sessions.cancelAll();
  assert.equal(first.cancelled, true);
});
