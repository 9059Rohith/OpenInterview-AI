import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedResponseText} from '../src/bounded-response.js';
import {checkedJson} from '../src/providers.js';

test('provider body without Content-Length stops at byte limit and cancels the remaining stream', async () => {
  let pulled = 0, cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) { pulled++; controller.enqueue(new Uint8Array(2_000_001)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(checkedJson('http://127.0.0.1:11434/api/tags', {}, (async () => response) as typeof fetch), /exceeded size limit/);
  assert.equal(cancelled, true);
  assert(pulled <= 3, 'an endless body must not be fully buffered');
  assert.equal(response.body!.locked, false);
});

test('bounded reader counts UTF-8 bytes and preserves code points split between packets', async () => {
  const bytes = new TextEncoder().encode('a€b');
  const response = () => new Response(new ReadableStream<Uint8Array>({start(controller) {
    controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2)); controller.close();
  }}));
  assert.equal(await boundedResponseText(response(), 5, 'too large'), 'a€b');
  await assert.rejects(boundedResponseText(response(), 4, 'too large'), /too large/);
});

test('oversized advertised body is cancelled without reading it', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({cancel() { cancelled = true; }}), {headers: {'content-length': '100'}});
  await assert.rejects(boundedResponseText(response, 10, 'too large'), /too large/);
  assert.equal(cancelled, true);
});
