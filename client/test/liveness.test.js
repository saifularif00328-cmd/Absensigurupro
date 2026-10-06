import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChallenge, eyeAspectRatio, meanEar, yawRatio } from '../src/face/liveness.js';

// Landmark sintetis: 68 titik; atur bukaan mata (h relatif lebar mata) dan posisi hidung (0..1 antar rahang)
function face({ open = 0.15, nose = 0.5 } = {}) {
  const lm = Array.from({ length: 68 }, () => ({ x: 50, y: 50 }));
  const eye = (start, x0) => {
    const w = 20, h = open * w, y = 40;
    lm[start] = { x: x0, y };                 lm[start + 3] = { x: x0 + w, y };
    lm[start + 1] = { x: x0 + w * 0.3, y: y - h }; lm[start + 2] = { x: x0 + w * 0.7, y: y - h };
    lm[start + 5] = { x: x0 + w * 0.3, y: y + h }; lm[start + 4] = { x: x0 + w * 0.7, y: y + h };
  };
  eye(36, 20); eye(42, 60);
  lm[0] = { x: 0, y: 60 }; lm[16] = { x: 100, y: 60 };
  lm[30] = { x: nose * 100, y: 55 };
  return lm;
}
const run = (c, frames) => { frames.forEach((f) => c.update(f)); return c.done; };
const rep = (f, n) => Array.from({ length: n }, () => f);

test('EAR: mata terbuka ~0,3 dan terpejam jauh lebih kecil', () => {
  assert.ok(Math.abs(meanEar(face({ open: 0.15 })) - 0.3) < 0.01);
  assert.ok(meanEar(face({ open: 0.02 })) < 0.06);
  const pts = face().slice(36, 42);
  assert.equal(eyeAspectRatio(pts), meanEar(face()));
});

test('yawRatio: 0,5 menghadap depan, bergeser saat menoleh', () => {
  assert.equal(yawRatio(face({ nose: 0.5 })), 0.5);
  assert.ok(yawRatio(face({ nose: 0.3 })) < 0.35);
  assert.ok(yawRatio(face({ nose: 0.7 })) > 0.65);
});

test('tantangan kedip: lulus bila mata terbuka lalu menutup lalu terbuka lagi', () => {
  const c = createChallenge('kedip');
  assert.equal(run(c, [...rep(face(), 8), ...rep(face({ open: 0.02 }), 2), ...rep(face(), 4)]), true);
});

test('tantangan kedip: foto diam (selalu terbuka) atau mata terus terpejam tidak lulus', () => {
  assert.equal(run(createChallenge('kedip'), rep(face(), 300)), false);
  assert.equal(run(createChallenge('kedip'), rep(face({ open: 0.01 }), 300)), false);
  // menutup tetapi tidak pernah membuka lagi
  assert.equal(run(createChallenge('kedip'), [...rep(face(), 8), ...rep(face({ open: 0.02 }), 50)]), false);
});

test('tantangan kedip: gerak kecil/noise bukaan mata tidak dianggap kedipan', () => {
  const jitter = Array.from({ length: 200 }, (_, i) => face({ open: 0.15 + (i % 2 ? 0.01 : -0.01) }));
  assert.equal(run(createChallenge('kedip'), jitter), false);
});

test('tantangan toleh: depan -> samping -> depan lulus; hanya diam atau hanya samping tidak', () => {
  assert.equal(run(createChallenge('toleh'), [...rep(face({ nose: 0.5 }), 5), ...rep(face({ nose: 0.28 }), 5), ...rep(face({ nose: 0.5 }), 3)]), true);
  assert.equal(run(createChallenge('toleh'), [...rep(face({ nose: 0.5 }), 5), ...rep(face({ nose: 0.72 }), 5), ...rep(face({ nose: 0.51 }), 3)]), true);
  assert.equal(run(createChallenge('toleh'), rep(face({ nose: 0.5 }), 300)), false);
  assert.equal(run(createChallenge('toleh'), rep(face({ nose: 0.25 }), 300)), false);       // sudah miring sejak awal
});

test('setelah lulus, status tetap lulus', () => {
  const c = createChallenge('toleh');
  run(c, [...rep(face(), 5), ...rep(face({ nose: 0.25 }), 5), ...rep(face(), 3)]);
  assert.equal(c.update(face({ nose: 0.9 })), true);
});
