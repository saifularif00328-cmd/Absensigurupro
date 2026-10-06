import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './testkit.js';
import { createLoginLimiter } from './accounts.js';

test('pembatas login: 5 gagal memblokir, jendela waktu habis membuka lagi, sukses mereset', () => {
  let t = 1_000_000;
  const l = createLoginLimiter(() => t);
  for (let i = 0; i < 4; i++) l.fail('1.1.1.1', 'Ani');
  assert.equal(l.blockedMinutes('1.1.1.1', 'ani'), 0);
  l.fail('1.1.1.1', 'ani');
  assert.ok(l.blockedMinutes('1.1.1.1', 'ANI') > 0);               // huruf besar/kecil sama
  assert.equal(l.blockedMinutes('2.2.2.2', 'ani'), 0);             // IP lain tidak terdampak
  t += 16 * 60_000;
  assert.equal(l.blockedMinutes('1.1.1.1', 'ani'), 0);
  l.fail('1.1.1.1', 'x'); l.clear('1.1.1.1', 'x');
  assert.equal(l.blockedMinutes('1.1.1.1', 'x'), 0);
});

test('login: 5 kali salah -> 429 meski kemudian password benar', async () => {
  const s = await setup();
  const bad = () => s.call('/api/auth/login', { method: 'POST', body: { username: 'guru1', password: 'salah-salah' } });
  for (let i = 0; i < 5; i++) assert.equal((await bad()).status, 401);
  assert.equal((await bad()).status, 429);
  const ok = await s.call('/api/auth/login', { method: 'POST', body: { username: 'guru1', password: 'password123' } });
  assert.equal(ok.status, 429);
  assert.match(ok.json.error, /menit/);
  assert.equal((await s.call('/api/auth/login', { method: 'POST', body: { username: 'guru2', password: 'password123' } })).status, 200);  // akun lain aman
  s.close();
});

test('akun buatan admin wajib ganti password; ganti password membuka akses', async () => {
  const s = await setup();
  const mk = await s.call('/api/users', { method: 'POST', token: s.t.admin, body: { username: 'baru', password: 'awal12345', full_name: 'Guru Baru', role: 'guru' } });
  assert.equal(mk.status, 201);
  const l = await s.call('/api/auth/login', { method: 'POST', body: { username: 'baru', password: 'awal12345' } });
  assert.equal(l.json.user.must_change_password, true);
  const tok = l.json.token;
  const blocked = await s.call('/api/face/status', { token: tok });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.must_change_password, true);
  const cp = (body) => s.call('/api/auth/change-password', { method: 'POST', token: tok, body });
  assert.equal((await cp({ old_password: 'salah', new_password: 'baruBARU99' })).status, 403);
  assert.equal((await cp({ old_password: 'awal12345', new_password: 'pendek' })).status, 400);
  assert.equal((await cp({ old_password: 'awal12345', new_password: 'awal12345' })).status, 400);
  assert.equal((await cp({ old_password: 'awal12345', new_password: 'baruBARU99' })).status, 200);
  assert.equal((await s.call('/api/face/status', { token: tok })).status, 200);
  assert.equal((await s.call('/api/auth/login', { method: 'POST', body: { username: 'baru', password: 'awal12345' } })).status, 401);
  assert.equal((await s.call('/api/auth/login', { method: 'POST', body: { username: 'baru', password: 'baruBARU99' } })).json.user.must_change_password, false);
  s.close();
});

test('reset password oleh admin: password acak tampil sekali, lama tidak berlaku, wajib ganti lagi', async () => {
  const s = await setup();
  const id = s.userId('guru1');
  assert.equal((await s.call(`/api/users/${id}/reset-password`, { method: 'POST', token: s.t.guru2 })).status, 403);
  assert.equal((await s.call('/api/users/9999/reset-password', { method: 'POST', token: s.t.admin })).status, 404);
  const r = await s.call(`/api/users/${id}/reset-password`, { method: 'POST', token: s.t.admin });
  assert.equal(r.status, 200);
  assert.match(r.json.password, /^[A-Z2-9]{10}$/);
  assert.equal((await s.call('/api/auth/login', { method: 'POST', body: { username: 'guru1', password: 'password123' } })).status, 401);
  const l = await s.call('/api/auth/login', { method: 'POST', body: { username: 'guru1', password: r.json.password } });
  assert.equal(l.status, 200);
  assert.equal(l.json.user.must_change_password, true);
  s.close();
});

test('nonaktifkan akun: tidak bisa login, token lama mati, tidak bisa menonaktifkan diri sendiri', async () => {
  const s = await setup();
  const id = s.userId('guru2');
  assert.equal((await s.call(`/api/users/${id}`, { method: 'PATCH', token: s.t.guru1, body: { active: false } })).status, 403);
  assert.equal((await s.call(`/api/users/${s.userId('admin')}`, { method: 'PATCH', token: s.t.admin, body: { active: false } })).status, 400);
  assert.equal((await s.call(`/api/users/${id}`, { method: 'PATCH', token: s.t.admin, body: { active: false } })).status, 200);
  assert.equal((await s.call('/api/me', { token: s.t.guru2 })).status, 401);
  assert.equal((await s.call('/api/auth/login', { method: 'POST', body: { username: 'guru2', password: 'password123' } })).status, 401);
  assert.equal((await s.call(`/api/users/${id}`, { method: 'PATCH', token: s.t.admin, body: { active: true, full_name: 'Budi S.' } })).status, 200);
  assert.equal((await s.call('/api/auth/login', { method: 'POST', body: { username: 'guru2', password: 'password123' } })).status, 200);
  assert.equal((await s.call('/api/users', { token: s.t.admin })).json.find((u) => u.id === id).full_name, 'Budi S.');
  s.close();
});

test('daftar pengguna memuat status wajah/perangkat/ganti password untuk admin', async () => {
  const s = await setup();
  const { ENROLL } = await import('./testkit.js');
  await s.enroll(s.t.guru1, ENROLL);
  const u = (await s.call('/api/users', { token: s.t.admin })).json.find((x) => x.username === 'guru1');
  assert.equal(u.face_enrolled, 1);
  assert.equal(u.has_device, 0);
  assert.equal(JSON.stringify(u).includes('descriptor'), false);
  s.close();
});
