import test from 'node:test';
import assert from 'node:assert/strict';
import { findChannelIndex, normalizeMarker } from './channelCatalog.js';

test('finds an exact marker index', () => {
  assert.equal(findChannelIndex('MART1'), 3);
});

test('is case-insensitive', () => {
  assert.equal(findChannelIndex('sox10'), findChannelIndex('SOX10'));
  assert.ok(findChannelIndex('sox10') >= 0);
});

test('ignores a "(do not use)" suffix on the catalog side', () => {
  assert.ok(findChannelIndex('PD1') >= 0);
});

test('returns -1 for an unknown marker', () => {
  assert.equal(findChannelIndex('NOTAMARKER'), -1);
});

test('normalizeMarker strips suffix and lowercases', () => {
  assert.equal(normalizeMarker('PD1 (do not use)'), 'pd1');
});
