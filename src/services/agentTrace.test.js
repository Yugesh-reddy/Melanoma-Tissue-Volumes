import test from 'node:test';
import assert from 'node:assert/strict';
import { logTurn, getTraces, clearTraces, exportTraces } from './agentTrace.js';

test('logTurn records and getTraces returns a copy', () => {
  clearTraces();
  logTurn({ userText: 'hi', actions: [] });
  const a = getTraces();
  assert.equal(a.length, 1);
  assert.equal(a[0].userText, 'hi');
  assert.ok(typeof a[0].ts === 'number');
  a.push({}); // mutating the returned array must not affect the buffer
  assert.equal(getTraces().length, 1);
});

test('ring buffer is capped at 200', () => {
  clearTraces();
  for (let i = 0; i < 250; i += 1) logTurn({ userText: `m${i}` });
  const a = getTraces();
  assert.equal(a.length, 200);
  assert.equal(a[a.length - 1].userText, 'm249'); // newest kept
  assert.equal(a[0].userText, 'm50');             // oldest dropped
});

test('exportTraces returns valid JSON', () => {
  clearTraces();
  logTurn({ userText: 'x', actions: [{ tool: 'enableChannels', ok: true }] });
  const parsed = JSON.parse(exportTraces());
  assert.equal(parsed[0].actions[0].tool, 'enableChannels');
});
