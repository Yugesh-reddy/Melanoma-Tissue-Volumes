import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionRegistry } from './actionRegistry.js';

test('runs a registered tool and returns its result', async () => {
  const reg = createActionRegistry();
  let applied = null;
  reg.register({
    setColor: (args) => { applied = args.color; return { message: `color ${args.color}` }; }
  });
  const res = await reg.run('setColor', { color: 'cyan' });
  assert.equal(res.ok, true);
  assert.equal(res.message, 'color cyan');
  assert.equal(applied, 'cyan');
});

test('unknown tool returns a graceful error result', async () => {
  const reg = createActionRegistry();
  const res = await reg.run('nope', {});
  assert.equal(res.ok, false);
  assert.match(res.message, /not available/i);
});

test('executor throw is caught and reported', async () => {
  const reg = createActionRegistry();
  reg.register({ boom: () => { throw new Error('kaboom'); } });
  const res = await reg.run('boom', {});
  assert.equal(res.ok, false);
  assert.match(res.message, /kaboom/);
});

test('unregister removes tools', async () => {
  const reg = createActionRegistry();
  reg.register({ x: () => ({ message: 'x' }) });
  reg.unregister(['x']);
  const res = await reg.run('x', {});
  assert.equal(res.ok, false);
});

test('run carries the executor undo through', async () => {
  const reg = createActionRegistry();
  let undone = false;
  reg.register({ t: () => ({ message: 'ok', undo: () => { undone = true; } }) });
  const res = await reg.run('t', {});
  res.undo();
  assert.equal(undone, true);
});
