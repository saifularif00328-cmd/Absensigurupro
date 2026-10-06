import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

process.env.SELFIE_DIR = mkdtempSync(join(tmpdir(), 'selfie-'));
const { openDb } = await import('./db.js');
const { createApp } = await import('./app.js');
const { localParts } = await import('./timeutil.js');

const SEKOLAH = { lat: -6.2, lng: 106.8 };
const DEV = 'device-aaaaaaaa';
const JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64');

async function setup({ requireSelfie = 0 } = {}) {
  const db = openDb(':memory:');
  const h = bcrypt.hashSync('password123', 4);
  for (const [u, n, role] of [['admin', 'Admin', 'admin'], ['kepsek', 'Kepsek', 'kepsek'], ['guru1', 'Ani', 'guru'], ['guru2', 'Budi', 'guru']]) {
    db.prepare('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)').run(u, h, n, role);
  }
  db.prepare(`INSERT INTO school (id,name,lat,lng,geofence_radius_m,work_start,late_tolerance_min,require_selfie)
    VALUES (1,'SMA Uji',?,?,100,'00:00',1440,?)`).run(SEKOLAH.lat, SEKOLAH.lng, requireSelfie);
  const server = createApp(db).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const call = async (path, { method = 'GET', body, token, raw } = {}) => {
    const r = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    });
    return raw ? r : { status: r.status, json: await r.json().catch(() => ({})) };
  };
  const login = async (u) => (await call('/api/auth/login', { method: 'POST', body: { username: u, password: 'password123' } })).json.token;
  return { db, call, login, close: () => server.close() };
}
const ci = (extra = {}) => ({ method: 'gps', ...SEKOLAH, device_id: DEV, ...extra });

test('selfie opsional: disimpan, path tidak bocor, hanya pemilik/staff yang bisa melihat', async () => {
  const { call, login, close } = await setup();
  const g1 = await login('guru1'), g2 = await login('guru2'), k = await login('kepsek');
  const r = await call('/api/attendance/check-in', { method: 'POST', token: g1, body: ci({ selfie: JPEG }) });
  assert.equal(r.status, 201);
  assert.equal(r.json.has_selfie, true);
  assert.equal(r.json.selfie_path, undefined);
  const id = r.json.id;
  const own = await call(`/api/attendance/${id}/selfie`, { token: g1, raw: true });
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call(`/api/attendance/${id}/selfie`, { token: k, raw: true })).status, 200);
  assert.equal((await call(`/api/attendance/${id}/selfie`, { token: g2, raw: true })).status, 404);
  assert.equal((await call(`/api/attendance/${id}/selfie`, { raw: true })).status, 401);
  close();
});

test('selfie wajib bila diatur sekolah; JPEG palsu & terlalu besar ditolak', async () => {
  const { call, login, close } = await setup({ requireSelfie: 1 });
  const g = await login('guru1');
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: g, body: ci() })).status, 400);
  const png = 'data:image/jpeg;base64,' + Buffer.alloc(300, 1).toString('base64');   // bukan magic JPEG
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: g, body: ci({ selfie: png }) })).status, 400);
  const wrongType = JPEG.replace('image/jpeg', 'image/svg+xml');
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: g, body: ci({ selfie: wrongType }) })).status, 400);
  const big = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(310 * 1024)]).toString('base64');
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: g, body: ci({ selfie: big }) })).status, 400);
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: g, body: ci({ selfie: JPEG }) })).status, 201);
  close();
});

test('akurasi GPS: >150 m ditolak, <1 m ditandai', async () => {
  const { call, login, close } = await setup();
  const g1 = await login('guru1'), g2 = await login('guru2');
  assert.equal((await call('/api/attendance/check-in', { method: 'POST', token: g1, body: ci({ accuracy: 400 }) })).status, 400);
  const ok = await call('/api/attendance/check-in', { method: 'POST', token: g1, body: ci({ accuracy: 12 }) });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.json.flags, []);
  const sus = await call('/api/attendance/check-in', { method: 'POST', token: g2, body: ci({ accuracy: 0, device_id: 'device-bbbbbbbb' }) });
  assert.deepEqual(sus.json.flags, ['akurasi_mencurigakan']);
  close();
});

test('lokasi loncat: kecepatan antar-absen tak masuk akal diberi tanda, tidak ditolak', async () => {
  const { db, call, login, close } = await setup();
  const g = await login('guru1');
  const uid = db.prepare("SELECT id FROM users WHERE username='guru1'").get().id;
  // 30 menit lalu berada ~111 km dari sekolah => ~222 km/jam
  db.prepare("INSERT INTO attendance (user_id,date,check_in,method,lat,lng,status) VALUES (?,?,?,?,?,?,'hadir')")
    .run(uid, '2000-01-01', new Date(Date.now() - 1800_000).toISOString(), 'gps', SEKOLAH.lat - 1, SEKOLAH.lng);
  const r = await call('/api/attendance/check-in', { method: 'POST', token: g, body: ci() });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.flags, ['lokasi_loncat']);
  close();
});

test('hari libur: hapus, validasi, dan dasbor tidak menuding guru "belum absen"', async () => {
  const { call, login, close } = await setup();
  const a = await login('admin'), k = await login('kepsek'), g = await login('guru1');
  const { date } = localParts();
  assert.equal((await call('/api/holidays', { method: 'POST', token: a, body: { date, name: 'Libur uji' } })).status, 201);
  const d = (await call('/api/dashboard/today', { token: k })).json;
  assert.equal(d.holiday, 'Libur uji');
  assert.deepEqual(d.belum_absen, []);
  assert.equal((await call(`/api/holidays/${date}`, { method: 'DELETE', token: g })).status, 403);
  assert.equal((await call('/api/holidays/bukan-tanggal', { method: 'DELETE', token: a })).status, 400);
  assert.equal((await call(`/api/holidays/${date}`, { method: 'DELETE', token: a })).status, 200);
  assert.equal((await call(`/api/holidays/${date}`, { method: 'DELETE', token: a })).status, 404);
  const after = (await call('/api/dashboard/today', { token: k })).json;
  assert.equal(after.holiday, null);
  close();
});

test('dasbor memuat entri dengan flags & has_selfie', async () => {
  const { call, login, close } = await setup();
  const g = await login('guru1'), k = await login('kepsek');
  await call('/api/attendance/check-in', { method: 'POST', token: g, body: ci({ selfie: JPEG, accuracy: 0 }) });
  const d = (await call('/api/dashboard/today', { token: k })).json;
  if (!d.weekend) assert.deepEqual(d.belum_absen.map((x) => x.full_name), ['Budi']);
  assert.equal(d.entries[0].has_selfie, true);
  assert.deepEqual(d.entries[0].flags, ['akurasi_mencurigakan']);
  close();
});

test('admin menyimpan require_selfie lewat PUT /api/school', async () => {
  const { call, login, close } = await setup();
  const a = await login('admin');
  const r = await call('/api/school', { method: 'PUT', token: a, body: { name: 'SMA Uji', require_selfie: true } });
  assert.equal(r.json.require_selfie, 1);
  close();
});

test('migrasi: DB lama tanpa kolom baru ditambah otomatis dan data tetap', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'mig-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE school (id INTEGER PRIMARY KEY CHECK (id=1), name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
    logo_path TEXT, kop_lines TEXT NOT NULL DEFAULT '[]', lat REAL, lng REAL, geofence_radius_m INTEGER NOT NULL DEFAULT 100,
    work_start TEXT NOT NULL DEFAULT '07:00', work_end TEXT NOT NULL DEFAULT '14:00', late_tolerance_min INTEGER NOT NULL DEFAULT 10,
    ai_enabled INTEGER NOT NULL DEFAULT 0);
    INSERT INTO school (id,name) VALUES (1,'Sekolah Lama');
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, full_name TEXT NOT NULL,
      nip TEXT, role TEXT NOT NULL, is_wali_kelas INTEGER NOT NULL DEFAULT 0, device_id TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL, check_in TEXT, check_out TEXT,
      method TEXT, lat REAL, lng REAL, selfie_path TEXT, status TEXT NOT NULL DEFAULT 'hadir', late_synced INTEGER NOT NULL DEFAULT 0, UNIQUE (user_id,date));`);
  old.close();
  for (let i = 0; i < 2; i++) { // dua kali: idempoten
    const db = openDb(file);
    const s = db.prepare('SELECT name, require_selfie FROM school').get();
    assert.deepEqual({ ...s }, { name: 'Sekolah Lama', require_selfie: 0 });
    assert.ok(db.prepare('PRAGMA table_info(attendance)').all().some((c) => c.name === 'flags'));
    db.close();
  }
});
