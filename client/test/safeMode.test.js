import { test } from 'node:test';
import assert from 'node:assert/strict';

// Simulasikan window di Node sebelum modul dimuat
globalThis.window = globalThis;
const calls = [];
const stub = (extra = {}) => ({
  isAvailable: () => true,
  enterExam: () => calls.push('enter'),
  exitExam: () => calls.push('exit'),
  requestLocation: (id) => calls.push(['loc', id]),
  ...extra,
});
const sm = await import('../src/safeMode.js');

test('di browser biasa semua no-op dan tanpa header mode aman', () => {
  delete window.UjianAman;
  assert.equal(sm.inSafeApp(), false);
  assert.deepEqual(sm.safeHeaders(), {});
  sm.enterExam(); sm.exitExam();                  // tidak melempar
  assert.equal(calls.length, 0);
});

test('di aplikasi: header mode aman, enter/exit diteruskan', () => {
  window.UjianAman = stub();
  assert.equal(sm.inSafeApp(), true);
  assert.deepEqual(sm.safeHeaders(), { 'x-safe-mode': '1' });
  sm.enterExam(); sm.exitExam();
  assert.deepEqual(calls.splice(0), ['enter', 'exit']);
});

test('jembatan rusak tidak membuat aplikasi crash', () => {
  window.UjianAman = { isAvailable: () => { throw new Error('x'); } };
  assert.equal(sm.inSafeApp(), false);
  window.UjianAman = stub({ enterExam: () => { throw new Error('lama'); } });
  sm.enterExam();
});

test('peristiwa native diteruskan dan bisa berhenti berlangganan', () => {
  const got = [];
  const off = sm.onNativeEvent((k) => got.push(k));
  window.__ujianAmanEvent('keluar_aplikasi');
  off();
  assert.equal(window.__ujianAmanEvent, undefined);
  assert.deepEqual(got, ['keluar_aplikasi']);
});

test('lokasi native: sukses membawa penanda mock', async () => {
  window.UjianAman = stub({ requestLocation: (id) => queueMicrotask(() => window.__ujianAmanLocation(id, { ok: true, lat: -6.2, lng: 106.8, accuracy: 9.5, mock: true })) });
  assert.deepEqual(await sm.nativeLocation(), { lat: -6.2, lng: 106.8, accuracy: 9.5, mock: true });
  window.UjianAman = stub({ requestLocation: (id) => queueMicrotask(() => window.__ujianAmanLocation(id, { ok: true, lat: 1, lng: 2, accuracy: -1, mock: false })) });
  assert.deepEqual(await sm.nativeLocation(), { lat: 1, lng: 2, accuracy: undefined, mock: false });
});

test('lokasi native: galat dan waktu habis menjadi Error berpesan ramah', async () => {
  window.UjianAman = stub({ requestLocation: (id) => queueMicrotask(() => window.__ujianAmanLocation(id, { ok: false, error: 'Izin lokasi ditolak' })) });
  await assert.rejects(sm.nativeLocation(), /Izin lokasi ditolak/);
  window.UjianAman = stub({ requestLocation: () => {} });
  await assert.rejects(sm.nativeLocation(50), /Lokasi tidak ditemukan/);
  window.UjianAman = stub({ requestLocation: () => { throw new Error('boom'); } });
  await assert.rejects(sm.nativeLocation(), /Gagal meminta lokasi/);
  delete window.UjianAman;
  await assert.rejects(sm.nativeLocation(), /Bukan di aplikasi/);
});

test('hasil lokasi untuk id yang tidak dikenal diabaikan', () => {
  window.UjianAman = stub();
  window.__ujianAmanLocation('tidak-ada', { ok: true });   // tidak melempar
});
