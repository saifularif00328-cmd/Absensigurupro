import { Router } from 'express';
import express from 'express';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { requireRole } from './auth.js';
import { randomCode } from './util.js';
import { generatePassword } from './accounts.js';

export const MAX_ROWS = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const fail = (res, code, error, extra = {}) => res.status(code).json({ error, ...extra });
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ---------- Baca Excel ----------
const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = {
  nis: ['nis', 'nisn', 'nomorinduk', 'noinduk', 'nomorinduksiswa'],
  nama: ['nama', 'namalengkap', 'name', 'namasiswa', 'namaguru'],
  kelas: ['kelas', 'rombel', 'class', 'rombongan', 'rombonganbelajar'],
  nip: ['nip', 'nuptk', 'nomorindukpegawai', 'nomorpegawai'],
  username: ['username', 'user', 'akun', 'namapengguna'],
  peran: ['peran', 'role', 'jabatan'],
  kelaswali: ['kelaswali', 'walikelas', 'wali', 'waliKelas'.toLowerCase()],
};
const canonical = (h) => Object.entries(ALIAS).find(([, list]) => list.includes(norm(h)))?.[0] ?? null;

// Nilai sel -> teks (rumus diambil hasilnya, rich text digabung, angka tanpa notasi ilmiah)
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('result' in v) return cellText(v.result);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return cellText(v.text);
    return '';
  }
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v);
}

// Mengembalikan { rows: [{line, nis, nama, ...}] } atau melempar Error berpesan ramah
export async function readWorkbookRows(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error('File bukan Excel (.xlsx) yang valid');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new Error('File Excel rusak atau tidak bisa dibaca. Simpan sebagai .xlsx lalu coba lagi.'); }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('File Excel tidak berisi lembar kerja');
  // baris judul = baris pertama (dalam 10 baris awal) yang mengandung kolom yang dikenali
  let headerRow = 0, cols = {};
  for (let i = 1; i <= Math.min(10, ws.rowCount) && !headerRow; i++) {
    const found = {};
    ws.getRow(i).eachCell((cell, c) => { const k = canonical(cellText(cell.value)); if (k && !(k in found)) found[k] = c; });
    if (Object.keys(found).length >= 2) { headerRow = i; cols = found; }
  }
  if (!headerRow) throw new Error('Baris judul kolom tidak ditemukan. Gunakan template dari tombol "Unduh template".');
  const rows = [];
  for (let i = headerRow + 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const obj = { line: i };
    let any = false;
    for (const [k, c] of Object.entries(cols)) { obj[k] = cellText(row.getCell(c).value).trim(); if (obj[k]) any = true; }
    if (!any) continue;
    rows.push(obj);
    if (rows.length > MAX_ROWS) throw new Error(`Terlalu banyak baris (maksimal ${MAX_ROWS}). Pecah menjadi beberapa file.`);
  }
  if (!rows.length) throw new Error('Tidak ada data di bawah baris judul');
  return { rows, columns: Object.keys(cols) };
}

// ---------- Impor siswa (dipakai CSV & Excel) ----------
export function importStudents(db, rows, defaultClassId = null) {
  const result = { created: 0, updated: 0, errors: [] };
  const findClass = db.prepare('SELECT id FROM classes WHERE name=?');
  const newClass = db.prepare('INSERT INTO classes (name) VALUES (?)');
  const find = db.prepare('SELECT id FROM students WHERE nis=?');
  const ins = db.prepare('INSERT INTO students (nis,name,class_id,access_code) VALUES (?,?,?,?)');
  const upd = db.prepare('UPDATE students SET name=?, class_id=? WHERE id=?');
  const seen = new Set();
  db.transaction(() => {
    for (const r of rows) {
      if (!r.nis || !r.nama) { result.errors.push({ line: r.line, error: 'NIS dan nama wajib' }); continue; }
      if (r.nis.length > 40 || r.nama.length > 120) { result.errors.push({ line: r.line, error: 'NIS/nama terlalu panjang' }); continue; }
      if (seen.has(r.nis)) { result.errors.push({ line: r.line, error: `NIS ${r.nis} dobel di file` }); continue; }
      seen.add(r.nis);
      let cid = defaultClassId;
      if (r.kelas) cid = (findClass.get(r.kelas) ?? { id: newClass.run(r.kelas).lastInsertRowid }).id;
      const ex = find.get(r.nis);
      if (ex) { upd.run(r.nama, cid, ex.id); result.updated++; } else { ins.run(r.nis, r.nama, cid, randomCode(6)); result.created++; }
    }
  })();
  return result;
}

// ---------- Impor guru ----------
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 30);

export async function importTeachers(db, rows) {
  const result = { created: 0, updated: 0, errors: [], credentials: [] };
  const byUsername = db.prepare('SELECT * FROM users WHERE username=?');
  const byNip = db.prepare('SELECT * FROM users WHERE nip=? AND nip<>\'\'');
  const taken = new Set();
  const uniqueUsername = (base) => {
    let u = base, n = 1;
    while (taken.has(u) || byUsername.get(u)) u = `${base}${++n}`;
    return u;
  };
  const findClass = db.prepare('SELECT id FROM classes WHERE name=?');
  const newClass = db.prepare('INSERT INTO classes (name) VALUES (?)');
  const setWali = db.prepare('UPDATE classes SET wali_user_id=? WHERE id=?');
  const seenKeys = new Set();

  for (const r of rows) {
    const line = r.line;
    if (!r.nama) { result.errors.push({ line, error: 'Nama wajib' }); continue; }
    const role = (r.peran || 'guru').toLowerCase();
    if (!['guru', 'kepsek'].includes(role)) { result.errors.push({ line, error: `Peran "${r.peran}" tidak diizinkan lewat Excel (gunakan guru atau kepsek)` }); continue; }
    const key = r.username || r.nip || r.nama.toLowerCase();
    if (seenKeys.has(key)) { result.errors.push({ line, error: `Data dobel di file (${key})` }); continue; }
    seenKeys.add(key);
    if (r.username && !/^[A-Za-z0-9._-]{3,40}$/.test(r.username)) { result.errors.push({ line, error: 'Username 3-40 karakter: huruf, angka, titik, strip, garis bawah' }); continue; }

    const existing = (r.username && byUsername.get(r.username)) || (r.nip && byNip.get(r.nip)) || null;
    let userId;
    if (existing) {
      if (existing.role === 'admin') { result.errors.push({ line, error: 'Akun admin tidak bisa diubah lewat Excel' }); continue; }
      db.prepare('UPDATE users SET full_name=?, nip=COALESCE(NULLIF(?, \'\'), nip), role=? WHERE id=?').run(r.nama, r.nip ?? '', role, existing.id);
      userId = existing.id;
      result.updated++;
    } else {
      const base = r.username || (r.nip ? r.nip.replace(/[^A-Za-z0-9._-]/g, '') : '') || slug(r.nama) || 'guru';
      const username = r.username ? r.username : uniqueUsername(base.length >= 3 ? base : `${base}guru`);
      if (r.username && (taken.has(username))) { result.errors.push({ line, error: `Username ${username} dobel` }); continue; }
      const password = generatePassword();
      const hash = await bcrypt.hash(password, 10);
      userId = db.prepare('INSERT INTO users (username,password_hash,full_name,nip,role,must_change_password) VALUES (?,?,?,?,?,1)')
        .run(username, hash, r.nama, r.nip || null, role).lastInsertRowid;
      taken.add(username);
      result.created++;
      result.credentials.push({ full_name: r.nama, nip: r.nip || '', username, password, role });
    }
    if (r.kelaswali) {
      const cid = (findClass.get(r.kelaswali) ?? { id: newClass.run(r.kelaswali).lastInsertRowid }).id;
      setWali.run(userId, cid);
      db.prepare('UPDATE users SET is_wali_kelas=1 WHERE id=?').run(userId);
    }
  }
  return result;
}

// ---------- Template & kredensial ----------
async function templateBook(kind) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === 'siswa' ? 'Siswa' : 'Guru');
  const head = kind === 'siswa' ? ['NIS', 'Nama', 'Kelas'] : ['NIP', 'Nama', 'Username', 'Peran', 'Kelas Wali'];
  ws.addRow(head).font = { bold: true };
  if (kind === 'siswa') { ws.addRow(['1001', 'Citra Dewi', '7A']); ws.addRow(['1002', 'Dedi Pratama', '7A']); }
  else { ws.addRow(['198501012010011001', 'Ani Wulandari', '', 'guru', '7A']); ws.addRow(['', 'Budi Santoso', 'budi.s', 'guru', '']); }
  ws.columns = head.map((h) => ({ width: h === 'Nama' ? 30 : 22 }));
  // NIS/NIP wajib teks agar angka panjang tidak berubah format
  ws.getColumn(1).numFmt = '@';
  const info = wb.addWorksheet('Petunjuk');
  const lines = kind === 'siswa'
    ? ['Isi data mulai baris ke-2 pada lembar "Siswa". Hapus dua baris contoh.', 'NIS dan Nama wajib. Kelas boleh kosong; kelas yang belum ada dibuat otomatis.', 'Mengunggah ulang file dengan NIS yang sama akan memperbarui nama/kelas (kode siswa tetap).', 'Maksimal 2000 baris per file.']
    : ['Isi data mulai baris ke-2 pada lembar "Guru". Hapus dua baris contoh.', 'Nama wajib. Username kosong = otomatis dari NIP (atau dari nama).', 'Peran: guru (default) atau kepsek. Akun admin tidak dibuat lewat Excel.', 'Kelas Wali (opsional): nama kelas yang diampu sebagai wali kelas.', 'Password awal dibuat acak oleh aplikasi dan ditampilkan sekali setelah impor; guru wajib menggantinya saat login pertama.', 'Mengunggah ulang dengan Username/NIP yang sama memperbarui data tanpa mengubah password.', 'Maksimal 2000 baris per file.'];
  lines.forEach((l) => info.addRow([l]));
  info.getColumn(1).width = 110;
  return wb;
}

export function importRoutes(db, auth) {
  const r = Router();
  const admin = requireRole('admin');
  const raw = express.raw({ type: () => true, limit: MAX_BYTES });

  const handle = (kind) => async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return fail(res, 400, 'File Excel kosong. Pilih file .xlsx.');
    let parsed;
    try { parsed = await readWorkbookRows(req.body); } catch (e) { return fail(res, 400, e.message); }
    const need = kind === 'siswa' ? ['nis', 'nama'] : ['nama'];
    const missing = need.filter((c) => !parsed.columns.includes(c));
    if (missing.length) return fail(res, 400, `Kolom wajib tidak ditemukan: ${missing.join(', ')}. Gunakan template.`);
    res.json(kind === 'siswa' ? importStudents(db, parsed.rows) : await importTeachers(db, parsed.rows));
  };

  r.post('/students/import-xlsx', auth, admin, raw, handle('siswa'));
  r.post('/users/import-xlsx', auth, admin, raw, handle('guru'));

  r.get('/templates/:kind.xlsx', auth, admin, async (req, res) => {
    if (!['siswa', 'guru'].includes(req.params.kind)) return fail(res, 404, 'Template tidak ditemukan');
    const wb = await templateBook(req.params.kind);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="template-${req.params.kind}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });

  // Lembar kredensial untuk dibagikan; isi berasal dari hasil impor/reset yang baru saja diterima admin
  r.post('/users/credentials.xlsx', auth, admin, async (req, res) => {
    const d = z.object({ rows: z.array(z.object({ full_name: z.string().max(120), nip: z.string().max(40).optional(), username: z.string().max(60), password: z.string().max(60), role: z.string().max(20).optional() })).min(1).max(MAX_ROWS) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data kredensial tidak valid');
    const school = db.prepare('SELECT name FROM school WHERE id=1').get();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Akun Guru');
    ws.addRow([`${school?.name ?? 'Sekolah'} — Akun Aplikasi Absensi Guru`]).font = { bold: true, size: 14 };
    ws.addRow(['Rahasia. Bagikan hanya kepada yang bersangkutan. Ganti password saat login pertama.']);
    ws.addRow([]);
    ws.addRow(['No', 'Nama', 'NIP', 'Username', 'Password awal', 'Peran']).font = { bold: true };
    d.data.rows.forEach((x, i) => {
      const row = ws.addRow([i + 1, x.full_name, x.nip ?? '', x.username, x.password, x.role ?? 'guru']);
      row.getCell(3).numFmt = '@';
    });
    ws.columns = [{ width: 5 }, { width: 30 }, { width: 22 }, { width: 22 }, { width: 18 }, { width: 10 }];
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', 'attachment; filename="kredensial-guru.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  });

  return r;
}
