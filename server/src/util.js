import { randomInt } from 'node:crypto';

// PRNG deterministik: urutan acak yang sama untuk seed yang sama (sesi siswa / paket cetak)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(arr, seed) {
  const rnd = mulberry32(seed), a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0/O/1/I
export const randomCode = (n = 6) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

// Semester berjalan, mis. "2026/2027 Ganjil"
export function defaultTerm(ymd) {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7));
  return m >= 7 ? `${y}/${y + 1} Ganjil` : `${y - 1}/${y} Genap`;
}

export const normalizeText = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
export const round2 = (n) => Math.round(n * 100) / 100;
