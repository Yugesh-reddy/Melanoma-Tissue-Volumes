// Live agent eval against a real OpenAI-compatible endpoint (e.g. Ollama / gpt-oss).
//
// Usage:
//   LLM_BASE_URL=https://ollama.com/v1 LLM_MODEL=gpt-oss:120b LLM_API_KEY=sk-... \
//     node src/eval/run-live.js
//
//   # local Ollama (no key):
//   LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=gpt-oss:120b node src/eval/run-live.js
//
// It sends each labeled utterance to the model with the real tool catalog,
// parses + validates the reply exactly like the app, and reports tool accuracy,
// arg accuracy, and the false-action / destructive-false-action rates.

import { scoreAgent, formatReport, formatMarkdown } from './agentEval.js';
import { EVAL_CASES } from './agentEval.cases.js';
import { extractActions } from '../services/actionParser.js';
import { validateToolCall, buildToolCatalogPrompt } from '../services/agentTools.js';

const BASE_URL = (process.env.LLM_BASE_URL || 'http://localhost:11434/v1').replace(/\/$/, '');
const MODEL = process.env.LLM_MODEL || 'gpt-oss:120b';
const API_KEY = process.env.LLM_API_KEY || '';

// Rate-limit controls (needed for hosted free tiers that cap requests/minute).
//   LLM_RPM=4         → throttle to ~4 requests/minute (0 = no throttle, local).
//   LLM_MAX_RETRIES=6 → retries on HTTP 429, honoring the server's retryDelay.
const RPM = Number(process.env.LLM_RPM || 0);
const MIN_INTERVAL_MS = RPM > 0 ? Math.ceil(60000 / RPM) : 0;
const MAX_RETRIES = Number(process.env.LLM_MAX_RETRIES || 6);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Pull a suggested wait out of a 429 body ("retry in 56.9s" / "retryDelay":"56s").
const parseRetryMs = (body) => {
  const m = /retry in ([\d.]+)s/i.exec(body) || /"retryDelay":\s*"(\d+)s"/.exec(body);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : 0;
};
let lastCallAt = 0;

const SYSTEM =
  'You are the app-wide assistant for a 3D multiplexed-imaging melanoma viewer. ' +
  'Help the user explore the data, answer questions, and take actions on their behalf. ' +
  'When the user asks you to DO something a tool covers, emit the action block; if they only ' +
  'ask a question, answer it and emit NO action block.\n\n' +
  buildToolCatalogPrompt();

const callModel = async (utterance) => {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  const body = JSON.stringify({
    model: MODEL,
    stream: false,
    temperature: 0,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: utterance }]
  });

  for (let attempt = 0; ; attempt++) {
    // Client-side throttle to stay under the provider's RPM.
    if (MIN_INTERVAL_MS > 0) {
      const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
    }
    lastCallAt = Date.now();

    let res;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, { method: 'POST', headers, body });
    } catch (e) {
      // Transient network blip — retry with backoff rather than aborting the run.
      if (attempt < MAX_RETRIES) {
        const waitMs = Math.min(2000 * 2 ** attempt, 30000);
        console.error(`  network error (${e.message}) — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
        continue;
      }
      throw e;
    }
    if (res.ok) {
      const json = await res.json();
      return json?.choices?.[0]?.message?.content || '';
    }

    const errBody = await res.text().catch(() => '');
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const waitMs = Math.min(parseRetryMs(errBody) || 2000 * 2 ** attempt, 70000) + 500;
      console.error(`  429 rate-limited — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`${res.status} ${errBody}`);
  }
};

// Parse + validate exactly like the app's pipeline.
const predict = async (utterance) => {
  const reply = await callModel(utterance);
  return extractActions(reply).actions
    .filter((a) => !a.error && a.tool)
    .map((a) => {
      const v = validateToolCall(a.tool, a.args);
      return v.ok ? { tool: a.tool, args: v.args } : null;
    })
    .filter(Boolean);
};

const main = async () => {
  console.log(`Evaluating ${MODEL} at ${BASE_URL} over ${EVAL_CASES.length} cases…\n`);
  const report = await scoreAgent(predict, EVAL_CASES);
  console.log(formatReport(report));
  const misses = report.perCase.filter((c) => !c.pass);
  if (misses.length) {
    console.log('\nMisses:');
    misses.forEach((m) => console.log(`  [${m.slice}] "${m.utterance}"  expected ${m.expect ?? '∅'} got ${JSON.stringify(m.got)}`));
  }
  // Paste-ready table for the project doc (§7.9).
  console.log('\n--- Markdown (copy into §7.9) ---\n');
  console.log(formatMarkdown(report, { model: MODEL }));
};

main().catch((err) => {
  console.error('Eval failed:', err.message);
  console.error('Check LLM_BASE_URL / LLM_MODEL / LLM_API_KEY.');
  process.exit(1);
});
