import test from 'node:test';
import assert from 'node:assert/strict';
import { principalAxis, dominantAxisLabel } from './directionStats.js';

test('principalAxis: a line along X returns the X axis with high coherence', () => {
  const points = [];
  for (let i = -10; i <= 10; i++) points.push({ x: i, y: 0, z: 0 });
  const res = principalAxis(points);
  assert.ok(res, 'expected a result');
  assert.equal(Math.round(Math.abs(res.direction.x)), 1);
  assert.ok(Math.abs(res.direction.y) < 0.05);
  assert.ok(Math.abs(res.direction.z) < 0.05);
  assert.ok(res.coherence > 0.9, `coherence ${res.coherence} should be near 1`);
  assert.equal(dominantAxisLabel(res.direction), 'X');
});

test('principalAxis: an isotropic cube has low coherence', () => {
  const points = [];
  for (let x = -2; x <= 2; x++)
    for (let y = -2; y <= 2; y++)
      for (let z = -2; z <= 2; z++) points.push({ x, y, z });
  const res = principalAxis(points);
  assert.ok(res, 'expected a result');
  assert.ok(res.coherence < 0.2, `coherence ${res.coherence} should be near 0`);
});

test('principalAxis: a Y-dominant elongated cloud is labelled Y', () => {
  const points = [];
  for (let i = -20; i <= 20; i++) points.push({ x: 0, y: i, z: 0 });
  // a little jitter on x/z so it is not perfectly degenerate
  points.push({ x: 0.3, y: 1, z: -0.2 }, { x: -0.2, y: -1, z: 0.1 });
  const res = principalAxis(points);
  assert.equal(dominantAxisLabel(res.direction), 'Y');
  assert.ok(res.coherence > 0.8);
});

test('principalAxis: fewer than two points returns null', () => {
  assert.equal(principalAxis([]), null);
  assert.equal(principalAxis([{ x: 1, y: 1, z: 1 }]), null);
});

test('eigenvalues are sorted descending', () => {
  const points = [];
  for (let i = -10; i <= 10; i++) points.push({ x: i, y: i * 0.3, z: 0 });
  const { eigenvalues } = principalAxis(points);
  assert.ok(eigenvalues[0] >= eigenvalues[1] && eigenvalues[1] >= eigenvalues[2]);
});
