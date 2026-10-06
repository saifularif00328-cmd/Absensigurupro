import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, desc, ENROLL, JPEG, DEV, SEKOLAH } from './testkit.js';
import { haversineM, localParts } from './timeutil.js';

test('haversine ~111 km per derajat lintang', () => {
  assert.ok(Math.abs(haversineM(0, 0, 1, 0) - 111195) < 200);
});

test('QR sudah dihapus: rute /api/qr tidak ada dan metode lama ditolak', async () => {
  const s = await setup();
  assert.equal((await s.call('/api/qr', { token: s.t.admin })).status, 404);
  await s.enroll(s.t.guru1);
  assert.equal((await s.checkIn(s.t.guru1, { method: 'qr', qr_token: 'x' })).status, 400);
  assert.equal((await s.checkIn(s.t.guru1, { method: 'gps' })).status, 400);
  s.close();
});

test('pendaftaran wajah: konsisten, sekali saja, reset admin, validasi data', async () => {
  const s = await setup();
  const bad = (b) => s.enroll(s.t.guru1, b);
  assert.equal((await bad({ ...ENROLL, descriptors: [desc(0), desc(0.3), desc(-0.3)] })).status, 400);     // tidak konsisten
  assert.equal((await bad({ ...ENROLL, descriptors: [desc(0), desc(0)] })).status, 400);                     // kurang dari 3
  assert.equal((await bad({ ...ENROLL, descriptors: [[1, 2], desc(0), desc(0)] })).status, 400);             // panjang salah
  assert.equal((await bad({ ...ENROLL, photo: 'data:image/png;base64,AAAA' })).status, 400);                 // bukan JPEG
  assert.equal((await s.call('/api/face/status', { token: s.t.guru1 })).json.enrolled, false);
  assert.equal((await s.enroll(s.t.guru1)).status, 201);
  assert.equal((await s.call('/api/face/status', { token: s.t.guru1 })).json.enrolled, true);
  assert.equal((await s.enroll(s.t.guru1)).status, 409);                                                      // daftar ulang butuh admin
  assert.equal((await s.call(`/api/users/${s.userId('guru1')}/face`, { method: 'DELETE', token: s.t.guru1 })).status, 403);
  assert.equal((await s.call(`/api/users/${s.userId('guru1')}/face`, { method: 'DELETE', token: s.t.admin })).status, 200);
  assert.equal((await s.enroll(s.t.guru1)).status, 201);
  assert.equal((await s.enroll(s.t.admin)).status, 403);                                                      // hanya guru
  s.close();
});

test('foto pendaftaran: pemilik/admin/kepsek boleh, guru lain tidak', async () => {
  const s = await setup();
  await s.enroll(s.t.guru1);
  const id = s.userId('guru1');
  const get = (token) => s.call(`/api/users/${id}/face-photo`, { token, raw: true });
  assert.equal((await get(s.t.guru1)).status, 200);
  assert.equal((await get(s.t.admin)).status, 200);
  assert.equal((await get(s.t.kepsek)).status, 200);
  assert.equal((await get(s.t.guru2)).status, 404);
  assert.equal((await get(undefined)).status, 401);
  s.close();
});

test('check-in: wajib terdaftar, lalu sukses menyimpan jarak wajah tanpa membocorkan data internal', async () => {
  const s = await setup();
  const no = await s.checkIn(s.t.guru1);
  assert.equal(no.status, 409);
  assert.equal(no.json.need_enroll, true);
  await s.enroll(s.t.guru1);
  const ok = await s.checkIn(s.t.guru1, { descriptor: desc(0.2) });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.method, 'selfie');
  assert.equal(ok.json.status, 'hadir');
  assert.equal(ok.json.has_selfie, true);
  assert.ok(Math.abs(ok.json.face_distance - 0.15) < 0.06);   // terdekat ke desc(0.05)
  assert.deepEqual(ok.json.flags, []);
  assert.equal(ok.json.selfie_path, undefined);
  assert.equal(JSON.stringify(ok.json).includes('descriptor'), false);
  assert.equal((await s.checkIn(s.t.guru1)).status, 409);       // sudah check-in
  s.close();
});

test('ambang wajah (bawaan 0,55): <=0,45 sah, 0,45-0,55 sah + ditandai, >0,55 ditolak tanpa catatan absen', async () => {
  const s = await setup();
  await s.enroll(s.t.guru1); await s.enroll(s.t.guru2);
  const near = await s.checkIn(s.t.guru1, { descriptor: desc(0.4) });
  assert.deepEqual(near.json.flags, []);
  const doubt = await s.checkIn(s.t.guru2, { descriptor: desc(0.55), device_id: 'device-bbbbbbbb' });
  assert.equal(doubt.status, 201);
  assert.deepEqual(doubt.json.flags, ['wajah_meragukan']);
  const s2 = await setup();
  await s2.enroll(s2.t.guru1);
  const mirip = await s2.checkIn(s2.t.guru1, { descriptor: desc(0.62) });      // jarak 0,57: orang lain yang mirip tidak boleh lolos
  assert.equal(mirip.status, 403);
  const far = await s2.checkIn(s2.t.guru1, { descriptor: desc(0.7) });
  assert.equal(far.status, 403);
  assert.match(far.json.error, /tidak cocok/);
  assert.equal(s2.db.prepare('SELECT COUNT(*) n FROM attendance').get().n, 0);
  s.close(); s2.close();
});

test('admin bisa mengetatkan/melonggarkan ambang wajah lewat pengaturan sekolah', async () => {
  const s = await setup();
  await s.enroll(s.t.guru1);
  const set = (t) => s.call('/api/school', { method: 'PUT', token: s.t.admin, body: { name: 'SMA Uji', ...SEKOLAH, face_threshold: t } });
  assert.equal((await set(0.3)).status, 400);            // di luar rentang aman 0,4-0,65
  assert.equal((await set(0.7)).status, 400);
  assert.equal((await set(0.45)).status, 200);
  assert.equal((await s.checkIn(s.t.guru1, { descriptor: desc(0.55) })).status, 403);   // jarak 0,5 > 0,45 sekarang ditolak
  assert.equal((await set(0.65)).status, 200);
  assert.equal((await s.checkIn(s.t.guru1, { descriptor: desc(0.55) })).status, 201);
  s.close();
});

test('data absen wajib lengkap: selfie, deskriptor 128 angka, lokasi, JPEG valid', async () => {
  const s = await setup();
  await s.enroll(s.t.guru1);
  const post = (body) => s.call('/api/attendance/check-in', { method: 'POST', token: s.t.guru1, body });
  const full = { method: 'selfie', ...SEKOLAH, device_id: DEV, selfie: JPEG, descriptor: desc(0.1) };
  for (const drop of ['selfie', 'descriptor', 'lat', 'lng']) {
    const b = { ...full }; delete b[drop];
    assert.equal((await post(b)).status, 400, drop);
  }
  assert.equal((await post({ ...full, descriptor: [1, 2, 3] })).status, 400);
  assert.equal((await post({ ...full, selfie: 'data:image/png;base64,AAAA' })).status, 400);
  const big = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(310 * 1024)]).toString('base64');
  assert.equal((await post({ ...full, selfie: big })).status, 400);
  assert.equal((await post(full)).status, 201);
  s.close();
});

test('lokasi: di luar radius ditolak, GPS lemah ditolak, lokasi palsu ditolak, akurasi 0 ditandai', async () => {
  const s = await setup();
  await s.enroll(s.t.guru1); await s.enroll(s.t.guru2);
  const out = await s.checkIn(s.t.guru1, { lat: -6.3 });
  assert.equal(out.status, 403);
  assert.ok(out.json.distance_m > 10000);
  assert.equal((await s.checkIn(s.t.guru1, { accuracy: 400 })).status, 400);
  assert.equal((await s.checkIn(s.t.guru1, { mock_location: true })).status, 403);
  const sus = await s.checkIn(s.t.guru2, { accuracy: 0, device_id: 'device-bbbbbbbb' });
  assert.deepEqual(sus.json.flags, ['akurasi_mencurigakan']);
  s.close();
});

test('lokasi loncat: kecepatan antar-absen tak masuk akal ditandai, tidak ditolak', async () => {
  const s = await setup();
  await s.enroll(s.t.guru1);
  s.db.prepare("INSERT INTO attendance (user_id,date,check_in,method,lat,lng,status) VALUES (?,?,?,?,?,?,'hadir')")
    .run(s.userId('guru1'), '2000-01-01', new Date(Date.now() - 1800_000).toISOString(), 'selfie', SEKOLAH.lat - 1, SEKOLAH.lng);
  const r = await s.checkIn(s.t.guru1);
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.flags, ['lokasi_loncat']);
  s.close();
});

test('terlambat jika lewat jam masuk + toleransi', async () => {
  const s = await setup({ school: { work_start: '00:00', late_tolerance_min: 0 } });
  await s.enroll(s.t.guru1);
  if (localParts().time !== '00:00') assert.equal((await s.checkIn(s.t.guru1)).json.status, 'terlambat');
  s.close();
});

test('satu perangkat per guru; admin bisa reset', async () => {
  const s = await setup();
  await s.enroll(s.t.guru1);
  assert.equal((await s.checkIn(s.t.guru1)).status, 201);
  s.db.prepare('DELETE FROM attendance').run();
  assert.equal((await s.checkIn(s.t.guru1, { device_id: 'device-bbbbbbbb' })).status, 403);
  assert.equal((await s.call(`/api/users/${s.userId('guru1')}/reset-device`, { method: 'POST', token: s.t.admin })).status, 200);
  assert.equal((await s.checkIn(s.t.guru1, { device_id: 'device-bbbbbbbb' })).status, 201);
  s.close();
});

test('sinkron offline: waktu klien dipakai, ditandai late_synced, batas 24 jam; wajah tetap diperiksa', async () => {
  const s = await setup();
  await s.enroll(s.t.guru1); await s.enroll(s.t.guru2);
  const old = new Date(Date.now() - 3600_000).toISOString();
  const r = await s.checkIn(s.t.guru1, { client_time: old });
  assert.equal(r.status, 201);
  assert.equal(r.json.late_synced, 1);
  assert.equal(r.json.check_in, old);
  const dev2 = 'device-cccccccc';
  assert.equal((await s.checkIn(s.t.guru2, { client_time: new Date(Date.now() - 48 * 3600_000).toISOString(), device_id: dev2 })).status, 400);
  assert.equal((await s.checkIn(s.t.guru2, { client_time: new Date(Date.now() + 3600_000).toISOString(), device_id: dev2 })).status, 400);
  assert.equal((await s.checkIn(s.t.guru2, { client_time: old, descriptor: desc(0.9), device_id: dev2 })).status, 403);
  s.close();
});

test('check-out hanya setelah check-in, sekali saja', async () => {
  const s = await setup();
  await s.enroll(s.t.guru1);
  const out = () => s.call('/api/attendance/check-out', { method: 'POST', token: s.t.guru1, body: {} });
  assert.equal((await out()).status, 400);
  await s.checkIn(s.t.guru1);
  const o = await out();
  assert.equal(o.status, 200);
  assert.ok(o.json.check_out);
  assert.equal((await out()).status, 409);
  s.close();
});

test('foto absen: pemilik/admin/kepsek boleh, guru lain tidak', async () => {
  const s = await setup();
  await s.enroll(s.t.guru1);
  const id = (await s.checkIn(s.t.guru1)).json.id;
  const get = (token) => s.call(`/api/attendance/${id}/selfie`, { token, raw: true });
  assert.equal((await get(s.t.guru1)).status, 200);
  assert.equal((await get(s.t.kepsek)).status, 200);
  assert.equal((await get(s.t.guru2)).status, 404);
  assert.equal((await get(undefined)).status, 401);
  s.close();
});

test('izin: pengajuan, persetujuan mengisi absensi hari kerja, tidak menimpa hadir', async () => {
  const s = await setup();
  const t = s.t.guru1, k = s.t.kepsek;
  await s.call('/api/holidays', { method: 'POST', token: s.t.admin, body: { date: '2030-01-09', name: 'Libur uji' } });
  const l = await s.call('/api/leaves', { method: 'POST', token: t, body: { type: 'sakit', start_date: '2030-01-07', end_date: '2030-01-13', reason: 'Demam' } });
  assert.equal(l.status, 201);
  assert.equal((await s.call('/api/leaves', { method: 'POST', token: t, body: { type: 'sakit', start_date: '2030-01-10', end_date: '2030-01-01' } })).status, 400);
  assert.equal((await s.call(`/api/leaves/${l.json.id}`, { method: 'PATCH', token: t, body: { decision: 'approved' } })).status, 403);
  const uid = s.userId('guru1');
  s.db.prepare("INSERT INTO attendance (user_id,date,check_in,status) VALUES (?,?,?,'hadir')").run(uid, '2030-01-08', '2030-01-08T00:00:00Z');
  assert.equal((await s.call(`/api/leaves/${l.json.id}`, { method: 'PATCH', token: k, body: { decision: 'approved' } })).status, 200);
  const days = s.db.prepare('SELECT date,status FROM attendance WHERE user_id=? ORDER BY date').all(uid);
  assert.deepEqual(days.map((d) => d.date), ['2030-01-07', '2030-01-08', '2030-01-10', '2030-01-11']);
  assert.equal(days.find((d) => d.date === '2030-01-08').status, 'hadir');
  assert.equal(days[0].status, 'sakit');
  assert.equal((await s.call(`/api/leaves/${l.json.id}`, { method: 'PATCH', token: k, body: { decision: 'rejected' } })).status, 409);
  s.close();
});

test('dasbor, rekap bulanan, ekspor Excel; guru hanya melihat miliknya', async () => {
  const s = await setup();
  await s.enroll(s.t.guru1);
  await s.checkIn(s.t.guru1, { accuracy: 0 });
  assert.equal((await s.call('/api/dashboard/today', { token: s.t.guru1 })).status, 403);
  const dash = (await s.call('/api/dashboard/today', { token: s.t.kepsek })).json;
  assert.equal(dash.total_guru, 2);
  assert.equal(dash.counts.hadir + dash.counts.terlambat, 1);
  if (!dash.weekend) assert.deepEqual(dash.belum_absen.map((x) => x.full_name), ['Budi']);
  assert.equal(dash.entries[0].has_selfie, true);
  assert.equal(typeof dash.entries[0].face_distance, 'number');
  assert.deepEqual(dash.entries[0].flags, ['akurasi_mencurigakan']);
  const m = localParts().date.slice(0, 7);
  const rec = (await s.call(`/api/reports/attendance?month=${m}`, { token: s.t.kepsek })).json;
  assert.equal(rec.rows.length, 2);
  assert.equal((await s.call('/api/reports/attendance?month=bad', { token: s.t.kepsek })).status, 400);
  assert.ok((await s.call('/api/attendance', { token: s.t.guru1 })).json.every((x) => x.full_name === 'Ani'));
  const x = await s.call(`/api/reports/attendance.xlsx?month=${m}`, { token: s.t.kepsek, raw: true });
  assert.match(x.headers.get('content-type'), /spreadsheetml/);
  assert.equal(Buffer.from(await x.arrayBuffer()).slice(0, 2).toString(), 'PK');
  s.close();
});

test('hari libur: tambah/hapus, validasi, dan dasbor tidak menuding guru "belum absen"', async () => {
  const s = await setup();
  const { date } = localParts();
  assert.equal((await s.call('/api/holidays', { method: 'POST', token: s.t.admin, body: { date, name: 'Libur uji' } })).status, 201);
  const d = (await s.call('/api/dashboard/today', { token: s.t.kepsek })).json;
  assert.equal(d.holiday, 'Libur uji');
  assert.deepEqual(d.belum_absen, []);
  assert.equal((await s.call(`/api/holidays/${date}`, { method: 'DELETE', token: s.t.guru1 })).status, 403);
  assert.equal((await s.call('/api/holidays/bukan-tanggal', { method: 'DELETE', token: s.t.admin })).status, 400);
  assert.equal((await s.call(`/api/holidays/${date}`, { method: 'DELETE', token: s.t.admin })).status, 200);
  assert.equal((await s.call(`/api/holidays/${date}`, { method: 'DELETE', token: s.t.admin })).status, 404);
  assert.equal((await s.call('/api/dashboard/today', { token: s.t.kepsek })).json.holiday, null);
  s.close();
});

test('pengaturan sekolah menyimpan face_liveness', async () => {
  const s = await setup();
  const r = await s.call('/api/school', { method: 'PUT', token: s.t.admin, body: { name: 'SMA Uji', face_liveness: false } });
  assert.equal(r.json.face_liveness, 0);
  assert.equal((await s.call('/api/face/status', { token: s.t.guru1 })).json.liveness, false);
  s.close();
});
