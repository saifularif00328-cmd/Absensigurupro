import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { currentQr, verifyQr } from './qr.js';
import { localParts, haversineM } from './timeutil.js';

const SEKOLAH = { lat: -6.2, lng: 106.8 };

async function setup(school = {}) {
  const db = openDb(':memory:');
  const h = bcrypt.hashSync('password123', 4);
  for (const [u, n, role] of [['admin', 'Admin', 'admin'], ['kepsek', 'Kepsek', 'kepsek'], ['guru1', 'Ani', 'guru'], ['guru2', 'Budi', 'guru']]) {
    db.prepare('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)').run(u, h, n, role);
  }
  db.prepare(`INSERT INTO school (id,name,lat,lng,geofence_radius_m,work_start,late_tolerance_min)
    VALUES (1,'SMA Uji',?,?,100,'00:00',1440)`).run(school.lat ?? SEKOLAH.lat, school.lng ?? SEKOLAH.lng);
  if (school.strict) db.prepare("UPDATE school SET work_start='00:00', late_tolerance_min=0 WHERE id=1").run();
  const server = createApp(db).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const call = async (path, { method = 'GET', body, token, raw } = {}) => {
    const r = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    });
    return raw ? r : { status: r.status, json: await r.json() };
  };
  const login = async (u) => (await call('/api/auth/login', { method: 'POST', body: { username: u, password: 'password123' } })).json.token;
  return { db, call, login, close: () => server.close() };
}

const DEV = 'device-aaaaaaaa';

test('qr: valid, kedaluwarsa, dan palsu', () => {
  const now = Date.now();
  const { token } = currentQr(now);
  assert.ok(verifyQr(token, now));
  assert.ok(verifyQr(token, now + 60_000));       // jendela sebelumnya masih diterima
  assert.ok(!verifyQr(token, now + 3 * 60_000));  // kedaluwarsa
  assert.ok(!verifyQr(token.slice(0, -2) + 'xx', now));
  assert.ok(!verifyQr('abc'));
});

test('haversine ~111 km per derajat lintang', () => {
  assert.ok(Math.abs(haversineM(0, 0, 1, 0) - 111195) < 200);
});

test('check-in GPS: di dalam radius ok, di luar ditolak, dua kali ditolak', async () => {
  const { call, login, close } = await setup();
  const t = await login('guru1');
  const out = await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'gps', lat: -6.3, lng: 106.8, device_id: DEV } });
  assert.equal(out.status, 403);
  assert.ok(out.json.distance_m > 10000);
  const ok = await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'gps', ...SEKOLAH, device_id: DEV } });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.status, 'hadir');
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'gps', ...SEKOLAH, device_id: DEV } })).status, 409);
  close();
});

test('terlambat jika lewat jam masuk + toleransi', async () => {
  const { db, call, login, close } = await setup({ strict: true });
  const t = await login('guru1');
  const { time } = localParts();
  // Pastikan sekarang pasti lewat 00:00 + 0 menit, kecuali tepat 00:00
  if (time !== '00:00') {
    const r = await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'gps', ...SEKOLAH, device_id: DEV } });
    assert.equal(r.json.status, 'terlambat');
  }
  assert.ok(db);
  close();
});

test('satu perangkat per guru; admin bisa reset', async () => {
  const { db, call, login, close } = await setup();
  const t = await login('guru1');
  await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'gps', ...SEKOLAH, device_id: DEV } });
  db.prepare('DELETE FROM attendance').run();
  const other = await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'gps', ...SEKOLAH, device_id: 'device-bbbbbbbb' } });
  assert.equal(other.status, 403);
  const admin = await login('admin');
  const id = db.prepare("SELECT id FROM users WHERE username='guru1'").get().id;
  assert.equal((await call(`/api/users/${id}/reset-device`, { method: 'POST', token: admin })).status, 200);
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'gps', ...SEKOLAH, device_id: 'device-bbbbbbbb' } })).status, 201);
  close();
});

test('check-in QR memakai token dinamis dari admin; lokasi palsu ditolak', async () => {
  const { call, login, close } = await setup();
  const t = await login('guru1'), admin = await login('admin');
  assert.equal((await call('/api/qr', { token: t })).status, 403);
  const qr = (await call('/api/qr', { token: admin })).json.token;
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'qr', qr_token: '1.salah', device_id: DEV } })).status, 403);
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'gps', ...SEKOLAH, mock_location: true, device_id: DEV } })).status, 403);
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'qr', qr_token: qr, device_id: DEV } })).status, 201);
  close();
});

test('sinkron offline: waktu klien dipakai, ditandai late_synced, batas 24 jam', async () => {
  const { call, login, close } = await setup();
  const t = await login('guru1');
  const old = new Date(Date.now() - 3600_000).toISOString();
  const r = await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'gps', ...SEKOLAH, device_id: DEV, client_time: old } });
  assert.equal(r.status, 201);
  assert.equal(r.json.late_synced, 1);
  assert.equal(r.json.check_in, old);
  const tooOld = new Date(Date.now() - 48 * 3600_000).toISOString();
  const t2 = await login('guru2');
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: t2, body: { method: 'gps', ...SEKOLAH, device_id: 'device-cccccccc', client_time: tooOld } })).status, 400);
  const future = new Date(Date.now() + 3600_000).toISOString();
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: t2, body: { method: 'gps', ...SEKOLAH, device_id: 'device-cccccccc', client_time: future } })).status, 400);
  close();
});

test('check-out hanya setelah check-in, sekali saja', async () => {
  const { call, login, close } = await setup();
  const t = await login('guru1');
  assert.equal((await call('/api/attendance/check-out', { method: 'POST', token: t, body: {} })).status, 400);
  await call('/api/attendance/check-in', { method: 'POST', token: t, body: { method: 'gps', ...SEKOLAH, device_id: DEV } });
  const o = await call('/api/attendance/check-out', { method: 'POST', token: t, body: {} });
  assert.equal(o.status, 200);
  assert.ok(o.json.check_out);
  assert.equal((await call('/api/attendance/check-out', { method: 'POST', token: t, body: {} })).status, 409);
  close();
});

test('izin: pengajuan, persetujuan mengisi absensi hari kerja, tidak menimpa hadir', async () => {
  const { db, call, login, close } = await setup();
  const t = await login('guru1'), k = await login('kepsek');
  // 2030-01-07 (Senin) s.d. 2030-01-13 (Minggu): 5 hari kerja, libur di Rabu
  await call('/api/holidays', { method: 'POST', token: await login('admin'), body: { date: '2030-01-09', name: 'Libur uji' } });
  const l = await call('/api/leaves', { method: 'POST', token: t, body: { type: 'sakit', start_date: '2030-01-07', end_date: '2030-01-13', reason: 'Demam' } });
  assert.equal(l.status, 201);
  assert.equal((await call('/api/leaves', { method: 'POST', token: t, body: { type: 'sakit', start_date: '2030-01-10', end_date: '2030-01-01' } })).status, 400);
  assert.equal((await call(`/api/leaves/${l.json.id}`, { method: 'PATCH', token: t, body: { decision: 'approved' } })).status, 403);
  const uid = db.prepare("SELECT id FROM users WHERE username='guru1'").get().id;
  db.prepare("INSERT INTO attendance (user_id,date,check_in,status) VALUES (?,?,?,'hadir')").run(uid, '2030-01-08', '2030-01-08T00:00:00Z');
  assert.equal((await call(`/api/leaves/${l.json.id}`, { method: 'PATCH', token: k, body: { decision: 'approved' } })).status, 200);
  const days = db.prepare('SELECT date,status FROM attendance WHERE user_id=? ORDER BY date').all(uid);
  assert.deepEqual(days.map((d) => d.date), ['2030-01-07', '2030-01-08', '2030-01-10', '2030-01-11']);
  assert.equal(days.find((d) => d.date === '2030-01-08').status, 'hadir');
  assert.equal(days[0].status, 'sakit');
  assert.equal((await call(`/api/leaves/${l.json.id}`, { method: 'PATCH', token: k, body: { decision: 'rejected' } })).status, 409);
  close();
});

test('guru hanya melihat absensinya sendiri; dasbor & rekap untuk kepsek', async () => {
  const { call, login, close } = await setup();
  const t1 = await login('guru1'), k = await login('kepsek');
  await call('/api/attendance/check-in', { method: 'POST', token: t1, body: { method: 'gps', ...SEKOLAH, device_id: DEV } });
  assert.equal((await call('/api/dashboard/today', { token: t1 })).status, 403);
  const dash = (await call('/api/dashboard/today', { token: k })).json;
  assert.equal(dash.total_guru, 2);
  assert.equal(dash.counts.hadir + dash.counts.terlambat, 1);
  assert.deepEqual(dash.belum_absen.map((x) => x.full_name), ['Budi']);
  const m = localParts().date.slice(0, 7);
  const rec = (await call(`/api/reports/attendance?month=${m}`, { token: k })).json;
  assert.equal(rec.rows.length, 2);
  assert.equal(rec.rows.find((x) => x.full_name === 'Ani').hadir + rec.rows.find((x) => x.full_name === 'Ani').terlambat, 1);
  assert.equal((await call('/api/reports/attendance?month=bad', { token: k })).status, 400);
  const mine = await call('/api/attendance', { token: t1 });
  assert.ok(mine.json.every((x) => x.full_name === 'Ani'));
  close();
});

test('ekspor Excel valid', async () => {
  const { call, login, close } = await setup();
  const k = await login('kepsek');
  const m = localParts().date.slice(0, 7);
  const res = await call(`/api/reports/attendance.xlsx?month=${m}`, { token: k, raw: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString(), 'PK');   // zip/xlsx
  close();
});
