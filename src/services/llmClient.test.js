import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegionGrounding,
  buildOrientationGrounding,
  buildGraphGrounding,
  composeChatSystem
} from './llmClient.js';

const summary = {
  dimensions: { x: 10, y: 12, z: 4 },
  volume: 480,
  activeRegionGroups: ['Tumor / Epithelial', 'Immune'],
  markers: [
    { name: 'SOX10', relativeExpression: 0.62, mean: 4200.5, median: 4100, std: 800, q1: 3600, q3: 4800 },
    { name: 'CD8a', relativeExpression: 0.21, mean: 1200.2, median: 1100, std: 400, q1: 900, q3: 1500 }
  ]
};

const engine = {
  tme: { label: 'Hot', cls: 'hot', immuneIndex: 0.4, tumorIndex: 0.6, immuneToTumor: 0.66 },
  checkpoint: { flagged: true, markers: [{ name: 'PD1', value: 0.31 }] },
  proliferation: { level: 'moderate', index: 0.45 },
  topPhenotypes: [
    { label: 'Melanoma', score: 0.7, proportion: 0.6, presentMarkers: ['SOX10', 'MART1'] }
  ],
  drivers: [{ name: 'SOX10', relativeExpression: 0.62 }]
};

test('buildRegionGrounding includes engine findings and raw markers', () => {
  const out = buildRegionGrounding(summary, engine);
  assert.match(out, /ENGINE FINDINGS/);
  assert.match(out, /Tumor-microenvironment class: Hot/);
  assert.match(out, /Melanoma: score=0\.70/);
  assert.match(out, /Checkpoint\/exhaustion: FLAGGED/);
  assert.match(out, /SOX10: relExpr=0\.62/);
  assert.match(out, /Active marker groups in view: Tumor \/ Epithelial, Immune/);
});

test('buildRegionGrounding handles no scored phenotypes', () => {
  const out = buildRegionGrounding(summary, { ...engine, topPhenotypes: [] });
  assert.match(out, /no population cleared the presence threshold/);
});

test('buildOrientationGrounding lists per-marker direction + coherence', () => {
  const stats = [
    { name: 'Collagen', direction: { x: 0.98, y: 0.1, z: 0.05 }, coherence: 0.91, dominantAxis: 'X' },
    { name: 'CD31', direction: { x: 0.3, y: 0.3, z: 0.3 }, coherence: 0.08, dominantAxis: 'Z' }
  ];
  const out = buildOrientationGrounding(stats);
  assert.match(out, /Collagen: direction=\(0\.980, 0\.100, 0\.050\), coherence=0\.91, dominant axis=X/);
  assert.match(out, /CD31:.*coherence=0\.08/);
});

test('buildOrientationGrounding handles empty stats', () => {
  assert.match(buildOrientationGrounding([]), /no visible channels/);
});

test('buildGraphGrounding emits a distribution table without engine sections', () => {
  const out = buildGraphGrounding(summary);
  assert.match(out, /PER-MARKER INTENSITY DISTRIBUTION/);
  assert.match(out, /SOX10: relExpr=0\.62/);
  assert.doesNotMatch(out, /ENGINE FINDINGS/);
});

test('composeChatSystem includes grounding, peers, and the tool catalog', () => {
  const out = composeChatSystem({
    kind: 'region',
    grounding: 'GROUND-X',
    peers: [{ title: 'Box 1', kind: 'region', grounding: 'PEER-1' }]
  });
  assert.match(out, /GROUND-X/);
  assert.match(out, /Box 1/);
  assert.match(out, /PEER-1/);
  assert.match(out, /```action/);
  assert.match(out, /enableChannels/);
});
