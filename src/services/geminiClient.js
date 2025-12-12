// Minimal browser-side Google Gemini client for the AI Analysis panel.
//
// There is no backend: the user pastes their own Gemini API key, which we keep
// in localStorage and send directly from the browser (as a query param to the
// Generative Language API). This suits a personal/research tool but the key is
// visible to anyone with access to the browser, so we surface that caveat in
// the UI.

const KEY_STORAGE = 'mtv_gemini_api_key';
const MODEL_STORAGE = 'mtv_gemini_model';

export const DEFAULT_MODEL = 'gemini-2.0-flash';
export const AVAILABLE_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-flash'
];

export const getApiKey = () => localStorage.getItem(KEY_STORAGE) || '';
export const setApiKey = (key) => {
  if (key) localStorage.setItem(KEY_STORAGE, key);
  else localStorage.removeItem(KEY_STORAGE);
};

export const getModel = () => localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL;
export const setModel = (model) => localStorage.setItem(MODEL_STORAGE, model);

const SYSTEM_PROMPT = `You are a research-support assistant for multiplexed (CyCIF) tissue imaging of melanoma samples.
A deterministic analysis engine has ALREADY scored a user-drawn 3D sub-volume: it computed candidate cell-population phenotypes (with proportions), a tumor-microenvironment immunophenotype, a checkpoint/exhaustion flag, a proliferation index, and the dominant markers. You are also given the raw per-marker statistics.
Your job is to EXPLAIN these computed findings biologically — do NOT invent phenotypes the engine did not score. Ground every claim in the provided numbers and markers.
Cover, using markdown with these section headers:
**Summary** — one or two sentences on what this region most likely is.
**Cell populations** — interpret the scored phenotypes and what their co-occurrence implies.
**Microenvironment & therapy relevance** — interpret the TME class, checkpoint signal (PD1/PDL1/LAG3/FOXP3) and proliferation; note immunotherapy relevance only if the checkpoint signal supports it.
**Caveats** — note this is exploratory research support, not a clinical/diagnostic conclusion, and that marker assignments require expert validation.
Be concise. Use bullet lists where helpful. Refer to relative expression as values in 0–1.`;

const fmtPct = (p) => `${Math.round(p * 100)}%`;
const fmt = (v) => (typeof v === 'number' ? v.toFixed(2) : 'n/a');

const buildUserMessage = (summary, engine) => {
  const lines = [];
  lines.push(`Region dimensions (voxels): ${summary.dimensions.x} x ${summary.dimensions.y} x ${summary.dimensions.z} (volume ${summary.volume}).`);
  if (summary.activeRegionGroups && summary.activeRegionGroups.length > 0) {
    lines.push(`Active marker groups in view: ${summary.activeRegionGroups.join(', ')}.`);
  }
  lines.push('');

  if (engine) {
    const { tme, checkpoint, proliferation, topPhenotypes, drivers } = engine;

    lines.push('=== ENGINE FINDINGS (explain these; do not contradict) ===');
    lines.push(`Tumor-microenvironment class: ${tme.label} (${tme.cls}); immune index=${fmt(tme.immuneIndex)}, tumor index=${fmt(tme.tumorIndex)}, immune-to-tumor balance=${fmt(tme.immuneToTumor)}.`);

    lines.push('');
    lines.push('Scored cell populations (relative score 0–1, proportion of called populations):');
    if (topPhenotypes && topPhenotypes.length > 0) {
      topPhenotypes.forEach((p) => {
        lines.push(`- ${p.label}: score=${fmt(p.score)}, proportion=${fmtPct(p.proportion)} (markers: ${p.presentMarkers.join(', ') || 'n/a'})`);
      });
    } else {
      lines.push('- (no population cleared the presence threshold; region is biologically quiet or only structural channels were active)');
    }

    lines.push('');
    lines.push(`Checkpoint/exhaustion: ${checkpoint.flagged
      ? 'FLAGGED — ' + checkpoint.markers.map((m) => `${m.name}=${fmt(m.value)}`).join(', ')
      : 'not flagged'}.`);
    lines.push(`Proliferation: ${proliferation.level} (index=${fmt(proliferation.index)}).`);

    if (drivers && drivers.length > 0) {
      lines.push('');
      lines.push('Dominant markers (relative expression): ' +
        drivers.map((d) => `${d.name}=${fmt(d.relativeExpression)}`).join(', ') + '.');
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

/**
 * Stream an analysis of `summary` from Google Gemini.
 *
 * @param {Object} params
 * @param {Object} params.summary - output of computeRegionSummary
 * @param {(token: string) => void} params.onToken - called with each text delta
 * @param {AbortSignal} [params.signal] - to cancel the request
 * @returns {Promise<void>}
 */
export const streamAnalysis = async ({ summary, engine, onToken, signal }) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No Gemini API key set. Open settings and paste your key.');
  }

  const model = getModel();
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent` +
    `?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildUserMessage(summary, engine) }] }],
      generationConfig: { temperature: 0.3 }
    })
  });

  if (!response.ok) {
    let detail = '';
    try {
      const errJson = await response.json();
      detail = errJson?.error?.message || '';
    } catch {
      detail = await response.text().catch(() => '');
    }
    if (response.status === 400 || response.status === 403) {
      throw new Error(`Gemini rejected the request (${response.status}). Check the API key in settings. ${detail}`);
    }
    if (response.status === 429) {
      throw new Error('Rate limited or quota exceeded (429). ' + detail);
    }
    throw new Error(`Gemini request failed (${response.status}). ${detail}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // keep the trailing partial line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const parts = json?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (part?.text) onToken(part.text);
          }
        }
      } catch {
        // ignore keep-alive / partial chunks
      }
    }
  }
};
