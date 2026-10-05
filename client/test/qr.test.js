import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';

// Render modul QR ke piksel RGBA, lalu decode dengan jsQR (jalur yang sama dengan scanner kamera)
function decode(text, scale = 6, margin = 4) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size, side = (n + margin * 2) * scale;
  const px = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!modules.data[y * n + x]) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + margin) * scale + dy) * side + (x + margin) * scale + dx) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }
  return jsQR(px, side, side)?.data ?? null;
}

test('token absensi (format "<jendela>.<tanda tangan>") terbaca kembali utuh', () => {
  const token = '29651234.AbCdEf-_gHiJkLmNoPqRs';
  assert.equal(decode(token), token);
});

test('gambar tanpa QR tidak menghasilkan token', () => {
  const px = new Uint8ClampedArray(200 * 200 * 4).fill(255);
  assert.equal(jsQR(px, 200, 200), null);
});
