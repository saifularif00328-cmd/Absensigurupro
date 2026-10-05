import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.QR_SECRET || process.env.JWT_SECRET || 'dev-secret-ganti-di-produksi';
export const QR_WINDOW_MS = 60_000;

const sign = (win) => createHmac('sha256', SECRET).update(String(win)).digest('base64url').slice(0, 22);

// Token QR berganti tiap menit; foto QR yang dititip kedaluwarsa dalam ~2 menit
export function currentQr(now = Date.now()) {
  const win = Math.floor(now / QR_WINDOW_MS);
  return { token: `${win}.${sign(win)}`, expires_at: new Date((win + 1) * QR_WINDOW_MS).toISOString() };
}

export function verifyQr(token, now = Date.now()) {
  const [w, sig] = String(token || '').split('.');
  const win = Number(w);
  if (!Number.isInteger(win) || !sig) return false;
  const cur = Math.floor(now / QR_WINDOW_MS);
  if (win > cur || cur - win > 1) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(win));
  return a.length === b.length && timingSafeEqual(a, b);
}
