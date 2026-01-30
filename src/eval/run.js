// Eval runner. By default it runs a "perfect oracle" predictor as a smoke test
// so the harness output format is visible:  node src/eval/run.js
//
// To evaluate a REAL model, provide a predict function that calls the LLM and
// returns parsed+validated actions per utterance, e.g.:
//
//   import { extractActions } from '../services/actionParser.js';
//   import { validateToolCall } from '../services/agentTools.js';
//   const predict = async (utterance) => {
//     const reply = await callYourModel(utterance);          // returns assistant text
//     return extractActions(reply).actions
//       .map((a) => validateToolCall(a.tool, a.args))
//       .filter((v) => v.ok)
//       .map((v, i) => ({ tool: extractActions(reply).actions[i].tool, args: v.args }));
//   };
//
// then: scoreAgent(predict, EVAL_CASES).

import { scoreAgent, formatReport } from './agentEval.js';
import { EVAL_CASES } from './agentEval.cases.js';

const perfect = (utterance) => {
  const c = EVAL_CASES.find((x) => x.utterance === utterance);
  if (!c || c.expect === null) return [];
  return [{ tool: c.expect.tool, args: c.expect.args || {} }];
};

const main = async () => {
  const report = await scoreAgent(perfect, EVAL_CASES);
  console.log('=== Agent eval (perfect-oracle smoke test) ===');
  console.log(formatReport(report));
  console.log('\nReplace `perfect` with a model-backed predict() to evaluate a real provider.');
};

main();
