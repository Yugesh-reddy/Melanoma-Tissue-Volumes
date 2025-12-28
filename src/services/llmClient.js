// Provider-aware LLM client for Tissue Intelligence.
//
// Dispatches on the active provider in llmConfig:
//   - 'gemini'  → Google Generative Language API (SSE)
//   - 'local'   → any OpenAI-compatible /chat/completions endpoint (SSE)
//
// Two entry points share one low-level streamer:
//   - streamAnalysis(): the structured, sectioned report for an opened context
//   - streamChat():     free-form follow-up Q&A, grounded in the same data
//
// Grounding builders are pure string functions (unit-tested) so the LLM only
// ever explains numbers the deterministic engines already computed.

import { getConfig } from './llmConfig.js';
import { buildToolCatalogPrompt } from './agentTools.js';

export { AVAILABLE_MODELS } from './llmConfig.js';

const fmt = (v) => (typeof v === 'number' ? v.toFixed(2) : 'n/a');
const fmtPct = (p) => `${Math.round(p * 100)}%`;
const fmt3 = (v) => (typeof v === 'number' ? v.toFixed(3) : 'n/a');

// --- system prompts --------------------------------------------------------

const BASE_RULES =
  'Ground every claim in the provided numbers; do NOT invent findings the engine did not compute. ' +
  'This is exploratory research support, not a clinical or diagnostic conclusion, and marker assignments require expert validation.';

const ANALYSIS_SYSTEM = {
  region:
    'You are a research-support assistant for multiplexed (CyCIF) tissue imaging of melanoma samples. ' +
    'A deterministic engine has ALREADY scored a user-drawn 3D sub-volume: candidate cell-population phenotypes (with proportions), a tumor-microenvironment immunophenotype, a checkpoint/exhaustion flag, a proliferation index, and dominant markers, plus raw per-marker statistics. ' +
    'EXPLAIN these computed findings biologically using markdown with these section headers: ' +
    '**Summary** — one or two sentences on what this region most likely is. ' +
    '**Cell populations** — interpret the scored phenotypes and what their co-occurrence implies. ' +
    '**Microenvironment & therapy relevance** — interpret the TME class, checkpoint signal (PD1/PDL1/LAG3/FOXP3) and proliferation; note immunotherapy relevance only if the checkpoint signal supports it. ' +
    '**Caveats** — limitations. Be concise; use bullet lists where helpful; refer to relative expression as values in 0–1. ' +
    BASE_RULES,
  orientation:
    'You are a research-support assistant for 3D structural/orientation analysis of multiplexed melanoma tissue. ' +
    'A deterministic engine computed, for each visible marker, a principal-axis unit vector and a coherence value in 0–1 (1 = highly aligned/anisotropic, 0 = isotropic / no preferred direction). ' +
    'EXPLAIN the structural organization using markdown: **Summary**, **Per-marker alignment**, **Interpretation** (what aligned vs isotropic structures suggest, e.g. collagen fiber tracts, vascular channels), **Caveats**. ' +
    BASE_RULES,
  graph:
    'You are a research-support assistant interpreting per-marker intensity distributions (mean/median/spread/quartiles) for a user-selected melanoma tissue region. ' +
    'EXPLAIN what the distributions imply using markdown: **Summary**, **Notable markers** (high/variable/bimodal-looking), **Interpretation**, **Caveats**. ' +
    BASE_RULES
};

const CHAT_SYSTEM = {
  region:
    'You are a concise research-support assistant for multiplexed melanoma tissue imaging. Answer the user\'s questions about the analyzed 3D sub-volume described in the grounding data. ' +
    BASE_RULES,
  orientation:
    'You are a concise research-support assistant for 3D tissue structural-orientation analysis. Answer questions about the per-marker principal directions and coherence in the grounding data. ' +
    BASE_RULES,
  graph:
    'You are a concise research-support assistant for tissue marker-intensity distributions. Answer questions about the per-marker statistics in the grounding data. ' +
    BASE_RULES,
  general:
    'You are the app-wide research-support assistant for a 3D multiplexed-imaging melanoma viewer. ' +
    'Help the user explore the data, answer questions, and take actions on their behalf using the available tools (channels, regions, camera, panels). ' +
    'When the user asks you to do something a tool covers, DO IT via an action block rather than only describing it. ' +
    BASE_RULES
};

// --- grounding builders (pure) ---------------------------------------------

export const buildRegionGrounding = (summary, engine) => {
  const lines = [];
  lines.push(
    `Region dimensions (voxels): ${summary.dimensions.x} x ${summary.dimensions.y} x ${summary.dimensions.z} (volume ${summary.volume}).`
  );
  if (summary.activeRegionGroups && summary.activeRegionGroups.length > 0) {
    lines.push(`Active marker groups in view: ${summary.activeRegionGroups.join(', ')}.`);
  }
  lines.push('');

  if (engine) {
    const { tme, checkpoint, proliferation, topPhenotypes, drivers } = engine;
    lines.push('=== ENGINE FINDINGS (explain these; do not contradict) ===');
    lines.push(
      `Tumor-microenvironment class: ${tme.label} (${tme.cls}); immune index=${fmt(tme.immuneIndex)}, tumor index=${fmt(tme.tumorIndex)}, immune-to-tumor balance=${fmt(tme.immuneToTumor)}.`
    );
    lines.push('');
    lines.push('Scored cell populations (relative score 0–1, proportion of called populations):');
    if (topPhenotypes && topPhenotypes.length > 0) {
      topPhenotypes.forEach((p) => {
        lines.push(
          `- ${p.label}: score=${fmt(p.score)}, proportion=${fmtPct(p.proportion)} (markers: ${p.presentMarkers.join(', ') || 'n/a'})`
        );
      });
    } else {
      lines.push('- (no population cleared the presence threshold; region is biologically quiet or only structural channels were active)');
    }
    lines.push('');
    lines.push(
      `Checkpoint/exhaustion: ${checkpoint.flagged
        ? 'FLAGGED — ' + checkpoint.markers.map((m) => `${m.name}=${fmt(m.value)}`).join(', ')
        : 'not flagged'}.`
    );
    lines.push(`Proliferation: ${proliferation.level} (index=${fmt(proliferation.index)}).`);
    if (drivers && drivers.length > 0) {
      lines.push('');
      lines.push(
        'Dominant markers (relative expression): ' +
          drivers.map((d) => `${d.name}=${fmt(d.relativeExpression)}`).join(', ') + '.'
      );
    }
    lines.push('');
  }

  lines.push('=== RAW PER-MARKER STATISTICS (intensity units), sorted by mean ===');
  if (!summary.markers || summary.markers.length === 0) {
    lines.push('(no marker data available)');
  } else {
    summary.markers.forEach((m) => {
      lines.push(
        `- ${m.name}: relExpr=${fmt(m.relativeExpression)}, mean=${m.mean.toFixed(1)}, median=${m.median.toFixed(1)}, ` +
          `std=${m.std.toFixed(1)}, q1=${m.q1.toFixed(1)}, q3=${m.q3.toFixed(1)}`
      );
    });
  }
  return lines.join('\n');
};

export const buildOrientationGrounding = (directionStats) => {
  const lines = [];
  lines.push('=== PER-MARKER PRINCIPAL-DIRECTION ANALYSIS ===');
  lines.push('Each marker: principal-axis unit vector (x,y,z), coherence 0–1 (1=aligned/anisotropic, 0=isotropic), dominant axis.');
  lines.push('');
  if (!directionStats || directionStats.length === 0) {
    lines.push('(no visible channels with enough signal to compute a direction)');
  } else {
    directionStats.forEach((d) => {
      lines.push(
        `- ${d.name}: direction=(${fmt3(d.direction.x)}, ${fmt3(d.direction.y)}, ${fmt3(d.direction.z)}), ` +
          `coherence=${fmt(d.coherence)}, dominant axis=${d.dominantAxis}`
      );
    });
  }
  return lines.join('\n');
};

export const buildGraphGrounding = (summary) => {
  const lines = [];
  lines.push(
    `Charted region dimensions (voxels): ${summary.dimensions.x} x ${summary.dimensions.y} x ${summary.dimensions.z} (volume ${summary.volume}).`
  );
  lines.push('');
  lines.push('=== PER-MARKER INTENSITY DISTRIBUTION (sorted by mean) ===');
  if (!summary.markers || summary.markers.length === 0) {
    lines.push('(no marker data available)');
  } else {
    summary.markers.forEach((m) => {
      lines.push(
        `- ${m.name}: relExpr=${fmt(m.relativeExpression)}, mean=${m.mean.toFixed(1)}, median=${m.median.toFixed(1)}, ` +
          `std=${m.std.toFixed(1)}, q1=${m.q1.toFixed(1)}, q3=${m.q3.toFixed(1)}`
      );
    });
  }
  return lines.join('\n');
};

// --- low-level streaming ---------------------------------------------------

// Shared SSE line pump: feeds each complete `data:` line's payload to onPayload.
const pumpSSE = async (response, onPayload) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      onPayload(payload);
    }
  }
};

const streamGemini = async ({ cfg, system, messages, onToken, signal }) => {
  const { apiKey, model } = cfg.gemini;
  if (!apiKey) throw new Error('No Gemini API key set. Open Settings and paste your key.');

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent` +
    `?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature: 0.3 }
      })
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Network error reaching Gemini. Check your connection.');
  }

  if (!response.ok) {
    let detail = '';
    try {
      const errJson = await response.json();
      detail = errJson?.error?.message || '';
    } catch {
      detail = await response.text().catch(() => '');
    }
    if (response.status === 400 || response.status === 403) {
      throw new Error(`Gemini rejected the request (${response.status}). Check the API key in Settings. ${detail}`);
    }
    if (response.status === 429) throw new Error('Rate limited or quota exceeded (429). ' + detail);
    throw new Error(`Gemini request failed (${response.status}). ${detail}`);
  }

  await pumpSSE(response, (payload) => {
    try {
      const json = JSON.parse(payload);
      const parts = json?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) parts.forEach((p) => p?.text && onToken(p.text));
    } catch {
      // ignore keep-alive / partial chunks
    }
  });
};

const streamLocal = async ({ cfg, system, messages, onToken, signal }) => {
  const { baseUrl, model, apiKey } = cfg.local;
  if (!baseUrl || !model) throw new Error('Local model not configured. Set a base URL and model name in Settings.');

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model,
        stream: true,
        temperature: 0.3,
        messages: [{ role: 'system', content: system }, ...messages]
      })
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`Can't reach local model at ${baseUrl}. Is the server running?`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Local model request failed (${response.status}). ${detail}`);
  }

  await pumpSSE(response, (payload) => {
    try {
      const json = JSON.parse(payload);
      const delta = json?.choices?.[0]?.delta?.content;
      if (delta) onToken(delta);
    } catch {
      // ignore partial chunks
    }
  });
};

const streamCompletion = ({ system, messages, onToken, signal }) => {
  const cfg = getConfig();
  const args = { cfg, system, messages, onToken, signal };
  return cfg.provider === 'local' ? streamLocal(args) : streamGemini(args);
};

// --- public API ------------------------------------------------------------

/**
 * Stream the initial structured report for an opened context.
 * @param {Object} p
 * @param {'region'|'orientation'|'graph'} p.kind
 * @param {string} p.grounding - output of a build*Grounding() function
 */
export const streamAnalysis = ({ kind, grounding, onToken, signal }) =>
  streamCompletion({
    system: ANALYSIS_SYSTEM[kind] || ANALYSIS_SYSTEM.region,
    messages: [{ role: 'user', content: grounding }],
    onToken,
    signal
  });

/**
 * Pure function that composes the system prompt for a chat thread.
 * Exported for testing and reuse.
 * @param {Object} p
 * @param {'region'|'orientation'|'graph'} p.kind
 * @param {string} p.grounding - the active context this thread is about
 * @param {Array<{title:string,kind:string,grounding:string}>} [p.peers] - other open contexts, available for cross-region comparison
 */
export const composeChatSystem = ({ kind, grounding, peers = [], systemState = '' }) => {
  let system =
    `${CHAT_SYSTEM[kind] || CHAT_SYSTEM.region}\n\n` +
    `=== GROUNDING DATA (the active context this thread is about) ===\n${grounding}`;

  if (systemState) {
    system +=
      `\n\n=== CURRENT APP STATE (live; use this to answer "what am I looking at" and to avoid redundant actions) ===\n` +
      systemState;
  }

  if (peers.length > 0) {
    const peerBlocks = peers
      .map((p) => `--- ${p.title} (${p.kind}) ---\n${p.grounding}`)
      .join('\n\n');
    system +=
      `\n\n=== OTHER OPEN CONTEXTS (data from the user's other selected regions/views) ===\n` +
      `When the user asks to compare with another region by name (e.g. "Box 1"), use the matching context below. ` +
      `Only use these numbers — do not say the data is missing if a matching context is present.\n\n` +
      peerBlocks;
  }

  system += `\n\n${buildToolCatalogPrompt()}`;
  return system;
};

/**
 * Stream a free-form chat reply. Grounding is injected into the system prompt
 * so it conditions the answer without appearing as a chat bubble.
 * @param {Object} p
 * @param {'region'|'orientation'|'graph'} p.kind
 * @param {string} p.grounding - the active context this thread is about
 * @param {Array<{title:string,kind:string,grounding:string}>} [p.peers] - other open contexts, available for cross-region comparison
 * @param {Array<{role:'user'|'assistant',content:string}>} p.messages - prior turns
 */
export const streamChat = ({ kind, grounding, peers = [], systemState = '', messages, onToken, signal }) =>
  streamCompletion({
    system: composeChatSystem({ kind, grounding, peers, systemState }),
    messages,
    onToken,
    signal
  });
