import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_CATALOG, buildToolCatalogPrompt, validateToolCall, isDestructive, isReadOnly, isToolAllowed, buildOpenAITools } from './agentTools.js';

test('catalog lists the phase-1 channel and region tools', () => {
  const names = TOOL_CATALOG.map((t) => t.name);
  for (const n of ['enableChannels', 'disableChannels', 'addChannel', 'setThreshold',
                    'setChannelColor', 'applyFilter', 'selectRegions', 'deselectRegions',
                    'setRegionMode', 'resetRegions']) {
    assert.ok(names.includes(n), `missing tool ${n}`);
  }
});

test('prompt documents the action block format and every tool', () => {
  const prompt = buildToolCatalogPrompt();
  assert.match(prompt, /```action/);
  assert.match(prompt, /enableChannels/);
  assert.match(prompt, /selectRegions/);
  assert.match(prompt, /Tumor \/ Epithelial/);
});

test('every tool declares a schema', () => {
  for (const t of TOOL_CATALOG) {
    assert.ok(t.schema && typeof t.schema === 'object', `${t.name} missing schema`);
  }
});

// --- validateToolCall ------------------------------------------------------

test('accepts a valid call and returns coerced args', () => {
  const r = validateToolCall('enableChannels', { markers: ['CD8a'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, { markers: ['CD8a'] });
});

test('coerces a single string into a string[] and "2" into a number', () => {
  const r1 = validateToolCall('enableChannels', { markers: 'CD8a' });
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.args.markers, ['CD8a']);
  const r2 = validateToolCall('switchBox', { box: '2' });
  assert.equal(r2.ok, true);
  assert.equal(r2.args.box, 2);
});

test('rejects unknown tools', () => {
  const r = validateToolCall('dropDatabase', {});
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Unknown tool/);
});

test('rejects missing required args', () => {
  const r = validateToolCall('addChannel', {});
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /Missing required "marker"/);
});

test('rejects out-of-enum values', () => {
  const r = validateToolCall('setRegionMode', { mode: 'four' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /one of/);
});

test('enforces requireOneOf', () => {
  const r = validateToolCall('switchBox', {});
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /one of/);
});

test('strips unexpected (injected) args — they never reach the executor', () => {
  const r = validateToolCall('showAllChannels', { tool: 'clearAllBoxes', evil: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, {});
});

test('destructive tools are flagged', () => {
  assert.equal(isDestructive('clearAllBoxes'), true);
  assert.equal(isDestructive('resetRegions'), true);
  assert.equal(isDestructive('closeBox'), true);
  assert.equal(isDestructive('enableChannels'), false);
});

test('read-only tools are flagged', () => {
  assert.equal(isReadOnly('getRegionStats'), true);
  assert.equal(isReadOnly('enableChannels'), false);
});

// --- native tool-calling definitions ---

test('buildOpenAITools emits one function def per catalog tool with JSON-schema params', () => {
  const tools = buildOpenAITools();
  assert.equal(tools.length, TOOL_CATALOG.length);
  const enable = tools.find((t) => t.function.name === 'enableChannels');
  assert.equal(enable.type, 'function');
  assert.equal(enable.function.parameters.type, 'object');
  assert.equal(enable.function.parameters.properties.markers.type, 'array');
  assert.ok(enable.function.parameters.required.includes('markers'));
});

test('per-context allowlist blocks app-wide destructive tools outside the general context', () => {
  // general can do everything
  assert.equal(isToolAllowed('general', 'clearAllBoxes'), true);
  assert.equal(isToolAllowed('general', 'resetRegions'), true);
  // a box / view context cannot clear all boxes or reset all regions
  assert.equal(isToolAllowed('region', 'clearAllBoxes'), false);
  assert.equal(isToolAllowed('orientation', 'resetRegions'), false);
  assert.equal(isToolAllowed('graph', 'clearAllBoxes'), false);
  // but they can still do scoped things
  assert.equal(isToolAllowed('region', 'enableChannels'), true);
  assert.equal(isToolAllowed('region', 'closeBox'), true);
});
