import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAgent } from './agentEval.js';
import { EVAL_CASES } from './agentEval.cases.js';

// A perfect oracle: returns exactly the expected action (or nothing).
const perfect = (utterance) => {
  const c = EVAL_CASES.find((x) => x.utterance === utterance);
  if (!c || c.expect === null) return [];
  return [{ tool: c.expect.tool, args: c.expect.args || {} }];
};

test('perfect predictor scores 100% accuracy and 0% false actions', async () => {
  const r = await scoreAgent(perfect, EVAL_CASES);
  assert.equal(r.toolAccuracy, 1);
  assert.equal(r.argAccuracy, 1);
  assert.equal(r.falseActionRate, 0);
  assert.equal(r.destructiveFalseActionRate, 0);
});

test('a trigger-happy destructive predictor is caught by the false-action metrics', async () => {
  const trigger = () => [{ tool: 'clearAllBoxes', args: {} }];
  const r = await scoreAgent(trigger, EVAL_CASES);
  assert.equal(r.falseActionRate, 1);            // fires on every question
  assert.equal(r.destructiveFalseActionRate, 1); // and it's destructive
  assert.ok(r.toolAccuracy < 0.2);               // wrong tool almost everywhere
});

test('a wrong-tool predictor has low tool accuracy but no false actions', async () => {
  const wrongButQuiet = (utterance) => {
    const c = EVAL_CASES.find((x) => x.utterance === utterance);
    if (!c || c.expect === null) return []; // correctly silent on questions
    return [{ tool: 'applyFilter', args: {} }];
  };
  const r = await scoreAgent(wrongButQuiet, EVAL_CASES);
  assert.equal(r.falseActionRate, 0);
  assert.ok(r.toolAccuracy < 0.2);
});
