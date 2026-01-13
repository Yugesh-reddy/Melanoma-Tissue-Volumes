import test from 'node:test';
import assert from 'node:assert/strict';
import { extractActions } from './actionParser.js';

test('extracts a single action block and strips it from text', () => {
  const input = 'Enabling immune markers.\n```action\n{"tool":"enableChannels","args":{"markers":["CD8a","CD4"]}}\n```\nDone.';
  const { cleanText, actions } = extractActions(input);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tool, 'enableChannels');
  assert.deepEqual(actions[0].args, { markers: ['CD8a', 'CD4'] });
  assert.ok(!cleanText.includes('```action'));
  assert.ok(cleanText.includes('Enabling immune markers.'));
  assert.ok(cleanText.includes('Done.'));
});

test('extracts multiple blocks in order', () => {
  const input = '```action\n{"tool":"addChannel","args":{"marker":"PDL1"}}\n```\n```action\n{"tool":"applyFilter","args":{}}\n```';
  const { actions } = extractActions(input);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].tool, 'addChannel');
  assert.equal(actions[1].tool, 'applyFilter');
});

test('malformed JSON is flagged, not thrown', () => {
  const input = '```action\n{not json}\n```';
  const { actions } = extractActions(input);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].error, true);
  assert.equal(actions[0].tool, null);
});

test('no blocks returns original text and empty actions', () => {
  const { cleanText, actions } = extractActions('just prose');
  assert.equal(cleanText, 'just prose');
  assert.deepEqual(actions, []);
});
