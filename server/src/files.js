import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_PHOTO_BYTES = 300 * 1024;
export const selfieDir = () => resolve(process.env.SELFIE_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'selfies'));

// Terima data URL JPEG; kembalikan Buffer atau null bila tidak valid
export function decodeJpegDataUrl(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 100 || buf.length > MAX_PHOTO_BYTES) return null;
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? buf : null;
}

export function savePhoto(buf) {
  mkdirSync(selfieDir(), { recursive: true });
  const name = `${randomBytes(12).toString('hex')}.jpg`;
  writeFileSync(join(selfieDir(), name), buf);
  return name;
}

export const photoPath = (name) => join(selfieDir(), name);
export const photoExists = (name) => !!name && existsSync(photoPath(name));
export function deletePhoto(name) {
  try { if (name) unlinkSync(photoPath(name)); } catch { /* sudah tidak ada */ }
}
