import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_CATALOG, buildToolCatalogPrompt } from './agentTools.js';

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
