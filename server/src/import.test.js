import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { setup } from './testkit.js';

async function xlsx(rows, { sheet = 'Data' } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const upload = (s, path, buf, token = s.t.admin) => s.call(path, { method: 'POST', token, rawBody: buf, headers: { 'content-type': 'application/octet-stream' } });

test('impor siswa: alias header, NIS numerik, baris kosong, kelas otomatis, kode siswa', async () => {
  const s = await setup();
  const buf = await xlsx([['NISN', 'Nama Lengkap', 'Rombel'], [1234567890, 'Citra Dewi', '7A'], [], ['1002', 'Dedi', '7A'], ['1003', 'Eka', '7B'], ['1004', '', '7B']]);
  const r = await upload(s, '/api/students/import-xlsx', buf);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.created, r.json.updated, r.json.errors.length], [3, 0, 1]);
  assert.equal(r.json.errors[0].line, 6);
  const students = (await s.call('/api/students', { token: s.t.admin })).json;
  assert.ok(students.find((x) => x.nis === '1234567890'), 'NIS angka 10 digit tidak boleh rusak');
  assert.match(students[0].access_code, /^[A-Z2-9]{6}$/);
  assert.deepEqual((await s.call('/api/classes', { token: s.t.admin })).json.map((c) => c.name).sort(), ['7A', '7B']);
  s.close();
});

test('impor siswa: baris judul tidak di baris pertama, dobel NIS dilaporkan, impor ulang memperbarui', async () => {
  const s = await setup();
  const first = await xlsx([['Daftar Siswa Kelas 7'], [], ['NIS', 'Nama', 'Kelas'], ['1', 'Ani', '7A'], ['1', 'Ani Dobel', '7A'], ['2', 'Budi', '7A']]);
  const r = await upload(s, '/api/students/import-xlsx', first);
  assert.deepEqual([r.json.created, r.json.errors.length], [2, 1]);
  assert.match(r.json.errors[0].error, /dobel/);
  const again = await upload(s, '/api/students/import-xlsx', await xlsx([['NIS', 'Nama', 'Kelas'], ['1', 'Ani Baru', '7B']]));
  assert.deepEqual([again.json.created, again.json.updated], [0, 1]);
  const ani = (await s.call('/api/students', { token: s.t.admin })).json.find((x) => x.nis === '1');
  assert.equal(ani.name, 'Ani Baru');
  assert.equal(ani.class_name, '7B');
  s.close();
});

test('impor Excel menolak berkas buruk dengan pesan jelas dan membatasi akses', async () => {
  const s = await setup();
  const bad = async (buf, re) => { const r = await upload(s, '/api/students/import-xlsx', buf); assert.equal(r.status, 400); assert.match(r.json.error, re); };
  await bad(Buffer.from('ini bukan excel, hanya teks'), /bukan Excel/);
  await bad(Buffer.concat([Buffer.from('PK'), Buffer.alloc(50, 1)]), /rusak|tidak bisa dibaca/);
  await bad(await xlsx([['Foo', 'Bar'], ['1', '2']]), /Baris judul/);
  await bad(await xlsx([['Nama', 'Kelas'], ['Ani', '7A']]), /Kolom wajib/);
  await bad(await xlsx([['NIS', 'Nama']]), /Tidak ada data/);
  const many = [['NIS', 'Nama'], ...Array.from({ length: 2001 }, (_, i) => [String(i + 1), `Siswa ${i + 1}`])];
  await bad(await xlsx(many), /Terlalu banyak baris/);
  assert.equal((await upload(s, '/api/students/import-xlsx', Buffer.alloc(0))).status, 400);
  const ok = await xlsx([['NIS', 'Nama'], ['1', 'Ani']]);
  assert.equal((await upload(s, '/api/students/import-xlsx', ok, s.t.guru1)).status, 403);
  assert.equal((await upload(s, '/api/students/import-xlsx', ok, s.t.kepsek)).status, 403);
  assert.equal((await upload(s, '/api/students/import-xlsx', ok, null)).status, 401);
  s.close();
});

test('impor guru: akun dibuat dengan password awal acak yang wajib diganti', async () => {
  const s = await setup();
  const buf = await xlsx([['NIP', 'Nama', 'Username', 'Peran', 'Kelas Wali'],
    ['19850101', 'Ani Wulandari', '', 'guru', '7A'],
    ['', 'Budi Santoso', '', '', ''],
    ['', 'Budi Santoso', 'budi.s', 'guru', ''],
    ['', 'Kepala Sekolah', 'kepala', 'kepsek', ''],
    ['', 'Penyusup', 'x-admin', 'admin', '']]);
  const r = await upload(s, '/api/users/import-xlsx', buf);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.created, r.json.updated], [4, 0]);
  assert.equal(r.json.errors.length, 1);
  assert.match(r.json.errors[0].error, /admin/i);
  const byName = Object.fromEntries(r.json.credentials.map((c) => [c.full_name + c.username, c]));
  const ani = r.json.credentials.find((c) => c.full_name === 'Ani Wulandari');
  assert.equal(ani.username, '19850101');                       // username default = NIP
  assert.match(ani.password, /^[A-Z2-9]{10}$/);
  assert.equal(new Set(r.json.credentials.map((c) => c.username)).size, 4);   // semua unik meski nama sama
  assert.ok(Object.keys(byName).length === 4);
  // login dengan password awal berhasil, tetapi fitur diblokir sampai ganti password
  const login = await s.call('/api/auth/login', { method: 'POST', body: { username: ani.username, password: ani.password } });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.must_change_password, true);
  assert.equal((await s.call('/api/exams', { token: login.json.token })).status, 403);
  assert.equal((await s.call('/api/me', { token: login.json.token })).status, 200);
  // wali kelas
  const kelas = (await s.call('/api/classes', { token: s.t.admin })).json.find((c) => c.name === '7A');
  assert.equal(kelas.wali_user_id, (await s.call('/api/users', { token: s.t.admin })).json.find((u) => u.username === '19850101').id);
  // kepsek hasil impor berperan kepsek
  assert.equal((await s.call('/api/users', { token: s.t.admin })).json.find((u) => u.username === 'kepala').role, 'kepsek');
  s.close();
});

test('impor guru: impor ulang memperbarui tanpa mengubah password atau membuat akun dobel', async () => {
  const s = await setup();
  const first = await upload(s, '/api/users/import-xlsx', await xlsx([['NIP', 'Nama'], ['111', 'Citra']]));
  const cred = first.json.credentials[0];
  const again = await upload(s, '/api/users/import-xlsx', await xlsx([['NIP', 'Nama Lengkap'], ['111', 'Citra Lestari']]));
  assert.deepEqual([again.json.created, again.json.updated, again.json.credentials.length], [0, 1, 0]);
  const users = (await s.call('/api/users', { token: s.t.admin })).json.filter((u) => u.nip === '111');
  assert.equal(users.length, 1);
  assert.equal(users[0].full_name, 'Citra Lestari');
  assert.equal((await s.call('/api/auth/login', { method: 'POST', body: { username: cred.username, password: cred.password } })).status, 200);
  // tidak boleh menimpa admin lewat Excel
  const hit = await upload(s, '/api/users/import-xlsx', await xlsx([['Username', 'Nama'], ['admin', 'Diganti']]));
  assert.equal(hit.json.errors.length, 1);
  assert.equal((await s.call('/api/users', { token: s.t.admin })).json.find((u) => u.username === 'admin').full_name, 'Admin');
  s.close();
});

test('template Excel dapat diunduh dan dibaca kembali oleh pengimpor', async () => {
  const s = await setup();
  for (const kind of ['siswa', 'guru']) {
    const r = await s.call(`/api/templates/${kind}.xlsx`, { token: s.t.admin, raw: true });
    assert.equal(r.status, 200);
    const buf = Buffer.from(await r.arrayBuffer());
    const imp = await upload(s, kind === 'siswa' ? '/api/students/import-xlsx' : '/api/users/import-xlsx', buf);
    assert.equal(imp.status, 200, kind + JSON.stringify(imp.json));
    assert.equal(imp.json.created, 2);
    assert.equal(imp.json.errors.length, 0);
  }
  assert.equal((await s.call('/api/templates/lain.xlsx', { token: s.t.admin, raw: true })).status, 404);
  assert.equal((await s.call('/api/templates/guru.xlsx', { token: s.t.guru1, raw: true })).status, 403);
  s.close();
});

test('lembar kredensial xlsx: hanya admin dan memuat data', async () => {
  const s = await setup();
  const rows = [{ full_name: 'Ani', nip: '123', username: 'ani', password: 'ABCDEFGH23' }];
  assert.equal((await s.call('/api/users/credentials.xlsx', { method: 'POST', token: s.t.guru1, body: { rows } })).status, 403);
  assert.equal((await s.call('/api/users/credentials.xlsx', { method: 'POST', token: s.t.admin, body: { rows: [] } })).status, 400);
  const r = await s.call('/api/users/credentials.xlsx', { method: 'POST', token: s.t.admin, body: { rows }, raw: true });
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
  const text = JSON.stringify(wb.worksheets[0].getSheetValues());
  assert.ok(text.includes('ABCDEFGH23') && text.includes('Ani'));
  s.close();
});
