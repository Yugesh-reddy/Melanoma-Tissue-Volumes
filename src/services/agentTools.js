// Declarative catalog of the actions the agent may take, plus a prompt builder
// that teaches the model the exact tool names, argument shapes, and the action
// block format. Single source of truth for what the AI is allowed to do.
//
// Each tool also carries a `schema` (arg validation), an optional `requireOneOf`
// (at least one of these args must be present), and a `destructive` flag. The
// schema is enforced by validateToolCall() BEFORE any executor runs — this is
// the central defense layer (correctness + prompt-injection hardening).

export const REGION_GROUP_NAMES = [
  'Tumor / Epithelial',
  'Immune (T/B/Myeloid)',
  'Stroma',
  'Stress / Metabolism',
  'Checkpoint / Crosstalk',
  'Proliferation / Cell State'
];

// type → predicate
const TYPE_CHECKS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  'string[]': (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')
};

export const TOOL_CATALOG = [
  { name: 'enableChannels', args: '{ "markers": ["CD8a", "CD4"] }', description: 'Turn on (make visible) channels by marker name.',
    schema: { markers: { type: 'string[]', required: true } } },
  { name: 'disableChannels', args: '{ "markers": ["MITF"] }', description: 'Hide channels by marker name.',
    schema: { markers: { type: 'string[]', required: true } } },
  { name: 'addChannel', args: '{ "marker": "PDL1", "color": "#ff00ff" }', description: 'Add a channel by marker name (color optional hex).',
    schema: { marker: { type: 'string', required: true }, color: { type: 'string' } } },
  { name: 'setThreshold', args: '{ "marker": "SOX10", "min": 5000, "max": 30000 }', description: 'Set a channel intensity min/max threshold.',
    schema: { marker: { type: 'string', required: true }, min: { type: 'number', min: 0 }, max: { type: 'number', min: 0 } } },
  { name: 'setChannelColor', args: '{ "marker": "MART1", "color": "#00ffff" }', description: 'Recolor a channel (hex).',
    schema: { marker: { type: 'string', required: true }, color: { type: 'string', required: true } } },
  { name: 'isolateChannel', args: '{ "marker": "SOX10" }', description: 'Show ONLY this marker; hide all other channels.',
    schema: { marker: { type: 'string' }, markers: { type: 'string[]' } }, requireOneOf: ['marker', 'markers'] },
  { name: 'showAllChannels', args: '{}', description: 'Make every channel visible.', schema: {} },
  { name: 'removeChannel', args: '{ "marker": "MITF" }', description: 'Remove a channel from the list entirely.',
    schema: { marker: { type: 'string', required: true } }, destructive: true },
  { name: 'resetThreshold', args: '{ "marker": "SOX10" }', description: 'Reset a channel threshold back to auto (full range).',
    schema: { marker: { type: 'string', required: true } } },
  { name: 'applyFilter', args: '{}', description: 'Apply the current threshold settings to the view.', schema: {} },
  { name: 'selectRegions', args: '{ "groups": ["Tumor / Epithelial", "Immune (T/B/Myeloid)"] }', description: 'Select one or more region groups (reloads panels).',
    schema: { groups: { type: 'string[]', required: true } } },
  { name: 'deselectRegions', args: '{ "groups": ["Stroma"] }', description: 'Deselect region groups.',
    schema: { groups: { type: 'string[]', required: true } } },
  { name: 'setRegionMode', args: '{ "mode": "two" }', description: 'Switch region mode: "single" | "two" | "three".',
    schema: { mode: { type: 'string', required: true, enum: ['single', 'two', 'three'] } } },
  { name: 'resetRegions', args: '{}', description: 'Clear all region selections.', schema: {}, destructive: true },
  { name: 'resetCamera', args: '{ "panel": "direction" }', description: 'Reset the camera in a 3D panel ("local" or "direction") to its default view.',
    schema: { panel: { type: 'string', enum: ['local', 'direction'] } } },
  { name: 'setView', args: '{ "panel": "direction", "orientation": "top" }', description: 'Orient a 3D panel camera: "top" | "front" | "side" | "iso".',
    schema: { panel: { type: 'string', enum: ['local', 'direction'] }, orientation: { type: 'string', enum: ['top', 'front', 'side', 'iso'] } } },
  { name: 'focusCamera', args: '{ "panel": "direction" }', description: 'Frame/fit the content in a 3D panel to fill the view.',
    schema: { panel: { type: 'string', enum: ['local', 'direction'] } } },
  { name: 'maximizePanel', args: '{ "panel": "direction" }', description: 'Open/expand a bottom panel full-screen: "local" | "graph" | "direction".',
    schema: { panel: { type: 'string', required: true, enum: ['local', 'graph', 'direction'] } } },
  { name: 'restorePanel', args: '{}', description: 'Restore panels from the maximized/expanded state.', schema: {} },
  { name: 'switchBox', args: '{ "box": 2 }', description: 'Switch the active Box tab in Local View (1-based, matches the "Box N" labels).',
    schema: { box: { type: 'number', min: 1 }, index: { type: 'number', min: 0 } }, requireOneOf: ['box', 'index'] },
  { name: 'closeBox', args: '{ "box": 2 }', description: 'Close a Box tab in Local View (1-based). Removes that selection.',
    schema: { box: { type: 'number', min: 1 }, index: { type: 'number', min: 0 } }, requireOneOf: ['box', 'index'], destructive: true },
  { name: 'clearAllBoxes', args: '{}', description: 'Close all Box tabs in Local View (clear all selections).', schema: {}, destructive: true },
  { name: 'setGraphView', args: '{ "view": "violin" }', description: 'Switch the Graph Panel visualization: "cells" | "bar" | "violin".',
    schema: { view: { type: 'string', required: true, enum: ['cells', 'composition', 'bar', 'violin'] } } },
  { name: 'getRegionStats', args: '{ "box": 2 }', description: 'READ-ONLY: return a box\'s computed stats (TME, top phenotypes, top markers). Use this to decide what to do, then act with [[continue]].',
    schema: { box: { type: 'number', min: 1 }, index: { type: 'number', min: 0 } }, requireOneOf: ['box', 'index'], readOnly: true }
];

const TOOL_BY_NAME = new Map(TOOL_CATALOG.map((t) => [t.name, t]));

export const getTool = (name) => TOOL_BY_NAME.get(name) || null;
export const isDestructive = (name) => !!(TOOL_BY_NAME.get(name)?.destructive);
export const isReadOnly = (name) => !!(TOOL_BY_NAME.get(name)?.readOnly);

// Per-context tool allowlist (defense): non-general threads (a box/orientation/
// graph context) may not invoke app-wide destructive tools. The general
// assistant may use everything.
const CONTEXT_DENY = {
  region: ['clearAllBoxes', 'resetRegions'],
  orientation: ['clearAllBoxes', 'resetRegions'],
  graph: ['clearAllBoxes', 'resetRegions']
};
export const isToolAllowed = (kind, tool) => !(CONTEXT_DENY[kind]?.includes(tool));

/**
 * Validate (and lightly coerce) a tool call against the catalog schema BEFORE
 * dispatch. Unknown tools are rejected; unknown args are stripped (never passed
 * to an executor); types/enums/ranges/required/requireOneOf are enforced.
 * @returns {{ ok: boolean, errors: string[], args: object }}
 */
export const validateToolCall = (tool, rawArgs = {}) => {
  const entry = TOOL_BY_NAME.get(tool);
  if (!entry) return { ok: false, errors: [`Unknown tool "${tool}"`], args: {} };

  const schema = entry.schema || {};
  const errors = [];
  const args = {}; // only schema-declared keys survive (strips injected extras)
  const source = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};

  for (const [key, spec] of Object.entries(schema)) {
    let v = source[key];

    if (v === undefined || v === null) {
      if (spec.required) errors.push(`Missing required "${key}"`);
      continue;
    }

    // Gentle coercion: "2" → 2 for numbers; "X" → ["X"] for string arrays.
    if (spec.type === 'number' && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) v = Number(v);
    if (spec.type === 'string[]' && typeof v === 'string') v = [v];

    if (!TYPE_CHECKS[spec.type]?.(v)) { errors.push(`"${key}" must be of type ${spec.type}`); continue; }
    if (spec.enum && !spec.enum.includes(v)) { errors.push(`"${key}" must be one of: ${spec.enum.join(', ')}`); continue; }
    if (spec.min != null && v < spec.min) { errors.push(`"${key}" must be >= ${spec.min}`); continue; }
    if (spec.max != null && v > spec.max) { errors.push(`"${key}" must be <= ${spec.max}`); continue; }

    args[key] = v;
  }

  if (entry.requireOneOf && !entry.requireOneOf.some((k) => args[k] !== undefined)) {
    errors.push(`Provide one of: ${entry.requireOneOf.join(', ')}`);
  }

  return { ok: errors.length === 0, errors, args };
};

// --- native tool-calling definitions ---------------------------------------
// Convert the catalog schema into JSON-Schema parameters, then into the OpenAI
// `tools` shape. Native tool calls are normalized back into ```action``` blocks
// downstream, so the rest of the pipeline (validation, allowlist, confirm, loop,
// trace) is transport-agnostic.

const JSON_TYPE = { string: 'string', number: 'number', boolean: 'boolean', 'string[]': 'array' };

const toJsonSchemaProp = (spec) => {
  const p = { type: JSON_TYPE[spec.type] || 'string' };
  if (spec.type === 'string[]') p.items = { type: 'string' };
  if (spec.enum) p.enum = spec.enum;
  if (spec.min != null) p.minimum = spec.min;
  if (spec.max != null) p.maximum = spec.max;
  return p;
};

const toParameters = (entry) => {
  const properties = {};
  const required = [];
  Object.entries(entry.schema || {}).forEach(([k, spec]) => {
    properties[k] = toJsonSchemaProp(spec);
    if (spec.required) required.push(k);
  });
  return { type: 'object', properties, required };
};

export const buildOpenAITools = () => TOOL_CATALOG.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: toParameters(t) }
}));

export const buildToolCatalogPrompt = () => {
  const lines = [];
  lines.push('=== ACTIONS YOU CAN TAKE ===');
  lines.push('You can change the app, not just describe it. When the user asks you to do');
  lines.push('something you have a tool for, DO IT by emitting a fenced block exactly like:');
  lines.push('```action');
  lines.push('{"tool":"<toolName>","args":{ ... }}');
  lines.push('```');
  lines.push('Emit one block per action; put a short sentence of prose before the block(s).');
  lines.push('Only use the tools below with the argument shapes shown. Do not invent tools.');
  lines.push('If the user only asks a question, answer it and do NOT emit an action block.');
  lines.push('Multi-step: if fulfilling the request needs more than one step (act, observe the');
  lines.push('result/updated state, then act again), end your message with the marker [[continue]]');
  lines.push('and you will receive the tool results + updated app state to take another step.');
  lines.push('Omit [[continue]] (and emit no action block) once the request is fully done.');
  lines.push('');
  lines.push('Tools:');
  TOOL_CATALOG.forEach((t) => {
    lines.push(`- ${t.name} ${t.args}${t.destructive ? ' [destructive]' : ''} — ${t.description}`);
  });
  lines.push('');
  lines.push(`Valid region group names: ${REGION_GROUP_NAMES.join(', ')}.`);
  return lines.join('\n');
};
