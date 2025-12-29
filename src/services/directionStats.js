// Pure principal-direction / orientation math for the Direction View.
//
// Given a cloud of 3D points, principalAxis() returns the dominant axis (first
// eigenvector of the covariance matrix), the three eigenvalues, and a coherence
// score in 0–1 (linear anisotropy): 1 = strongly aligned along one axis, 0 =
// isotropic blob with no preferred direction. No THREE.js dependency so the math
// is unit-testable in plain Node.
//
// Points may be {x,y,z} objects (THREE.Vector3 qualifies) so callers can pass
// their existing vectors directly.

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const normalize = (v) => {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
};

const boundingBoxAxis = (points) => {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of points) {
    min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
  }
  return normalize(sub(max, min));
};

// Linear anisotropy: (λ1 - λ2) / (λ1 + λ2 + λ3), clamped to [0,1].
const coherenceFrom = (eigenvalues) => {
  const sum = eigenvalues[0] + eigenvalues[1] + eigenvalues[2];
  if (sum <= 1e-9) return 0;
  return Math.max(0, Math.min(1, (eigenvalues[0] - eigenvalues[1]) / sum));
};

/**
 * @param {Array<{x:number,y:number,z:number}>} points
 * @returns {{direction:{x,y,z}, center:{x,y,z}, eigenvalues:[number,number,number], coherence:number}|null}
 */
export const principalAxis = (points) => {
  if (!points || points.length < 2) return null;

  const n = points.length;
  const mean = { x: 0, y: 0, z: 0 };
  for (const p of points) { mean.x += p.x; mean.y += p.y; mean.z += p.z; }
  mean.x /= n; mean.y /= n; mean.z /= n;

  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of points) {
    const cx = p.x - mean.x, cy = p.y - mean.y, cz = p.z - mean.z;
    xx += cx * cx; xy += cx * cy; xz += cx * cz;
    yy += cy * cy; yz += cy * cz; zz += cz * cz;
  }

  const trace = xx + yy + zz;
  // q = second invariant I2 = λ1λ2 + λ1λ3 + λ2λ3 (sum of 2x2 principal minors).
  const q = (trace * trace - (xx * xx + yy * yy + zz * zz + 2 * (xy * xy + xz * xz + yz * yz))) / 2;
  const det =
    xx * (yy * zz - yz * yz) - xy * (xy * zz - xz * yz) + xz * (xy * yz - yy * xz);

  const p = trace;

  // I2 ≈ 0 ⇒ at least two eigenvalues are 0 ⇒ points are collinear (rank-1) ⇒ fully coherent.
  if (q <= 1e-9) {
    return { direction: boundingBoxAxis(points), center: mean, eigenvalues: [trace, 0, 0], coherence: 1 };
  }

  // disc = p² - 3q = ½Σ(λi-λj)² ≥ 0; ≈0 ⇒ all eigenvalues equal ⇒ isotropic, no preferred direction.
  const disc = p * p - 3 * q;
  if (disc <= 1e-9 * (p * p)) {
    const lam = trace / 3;
    return { direction: { x: 1, y: 0, z: 0 }, center: mean, eigenvalues: [lam, lam, lam], coherence: 0 };
  }

  const r = det;
  const sqrtTerm = Math.sqrt(disc);
  const phi = Math.acos(
    Math.max(-1, Math.min(1, (2 * p * p * p - 9 * p * q + 27 * r) / (2 * Math.pow(disc, 1.5))))
  );

  const lambdas = [
    p / 3 + (2 / 3) * sqrtTerm * Math.cos(phi / 3),
    p / 3 + (2 / 3) * sqrtTerm * Math.cos((phi + 2 * Math.PI) / 3),
    p / 3 + (2 / 3) * sqrtTerm * Math.cos((phi + 4 * Math.PI) / 3)
  ];
  const sorted = [...lambdas].sort((a, b) => b - a);
  const maxLambda = sorted[0];

  // Eigenvector for the largest eigenvalue (matches the original index-by-index solve).
  let direction = { x: 1, y: 0, z: 0 };
  if (Math.abs(maxLambda - lambdas[0]) < 1e-3) {
    const denom = (yy - lambdas[0]) * (zz - lambdas[0]) - yz * yz;
    if (Math.abs(denom) > 1e-6) {
      const y = (xy * (zz - lambdas[0]) - xz * yz) / denom;
      const z = (xz - yz * y) / (zz - lambdas[0]);
      direction = normalize({ x: 1, y, z });
    }
  } else if (Math.abs(maxLambda - lambdas[1]) < 1e-3) {
    const denom = (xx - lambdas[1]) * (zz - lambdas[1]) - xz * xz;
    if (Math.abs(denom) > 1e-6) {
      const x = (xy * (zz - lambdas[1]) - xz * yz) / denom;
      const z = (yz - xz * x) / (zz - lambdas[1]);
      direction = normalize({ x, y: 1, z });
    }
  } else {
    const denom = (xx - lambdas[2]) * (yy - lambdas[2]) - xy * xy;
    if (Math.abs(denom) > 1e-6) {
      const x = (xy * (yy - lambdas[2]) - xz * xy) / denom;
      const y = (xz - xy * x) / (yy - lambdas[2]);
      direction = normalize({ x, y, z: 1 });
    }
  }

  if (Math.hypot(direction.x, direction.y, direction.z) < 0.1) {
    direction = boundingBoxAxis(points);
  }

  return { direction, center: mean, eigenvalues: sorted, coherence: coherenceFrom(sorted) };
};

/** Which world axis the direction points most strongly along. */
export const dominantAxisLabel = (direction) => {
  const ax = Math.abs(direction.x), ay = Math.abs(direction.y), az = Math.abs(direction.z);
  if (ax >= ay && ax >= az) return 'X';
  if (ay >= ax && ay >= az) return 'Y';
  return 'Z';
};
