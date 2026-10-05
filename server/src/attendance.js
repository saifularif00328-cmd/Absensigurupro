import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { requireRole } from './auth.js';
import { currentQr, verifyQr } from './qr.js';
import { localParts, toMinutes, haversineM, dateRange, isWeekend } from './timeutil.js';

const MAX_OFFLINE_AGE_MS = 24 * 3600 * 1000;
const fail = (res, code, error, extra = {}) => res.status(code).json({ error, ...extra });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);

export function attendanceRoutes(db, auth) {
  const r = Router();
  const staff = requireRole('admin', 'kepsek');
  const school = () => db.prepare('SELECT * FROM school WHERE id=1').get();

  r.get('/qr', auth, staff, (_req, res) => res.json(currentQr()));

  // Check-in: metode gps | qr. client_time dipakai bila diabsen offline lalu disinkron.
  r.post('/attendance/check-in', auth, requireRole('guru'), (req, res) => {
    const d = z.object({
      method: z.enum(['gps', 'qr']),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      qr_token: z.string().optional(),
      device_id: z.string().min(8).max(100),
      mock_location: z.boolean().optional(),
      client_time: z.string().datetime().optional(),
    }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    const b = d.data;
    const s = school();
    if (!s) return fail(res, 400, 'Sekolah belum diatur');

    // Waktu: server, kecuali sinkron offline (maks 24 jam ke belakang, tidak boleh di masa depan)
    let when = new Date(), lateSynced = 0;
    if (b.client_time) {
      const t = new Date(b.client_time), age = Date.now() - t.getTime();
      if (age < -60_000 || age > MAX_OFFLINE_AGE_MS) return fail(res, 400, 'Waktu absen offline tidak valid atau terlalu lama');
      if (age > 120_000) { when = t; lateSynced = 1; }
    }

    // Satu perangkat per guru
    const u = db.prepare('SELECT device_id FROM users WHERE id=?').get(req.user.id);
    if (!u.device_id) db.prepare('UPDATE users SET device_id=? WHERE id=?').run(b.device_id, req.user.id);
    else if (u.device_id !== b.device_id) return fail(res, 403, 'Perangkat tidak terdaftar. Minta admin mengatur ulang perangkat Anda.');

    if (b.mock_location) return fail(res, 403, 'Lokasi palsu terdeteksi');
    if (b.method === 'qr') {
      // QR dinilai pada waktu absen sebenarnya (offline tidak boleh memakai QR lama)
      if (lateSynced) return fail(res, 400, 'Absen QR harus dilakukan online');
      if (!verifyQr(b.qr_token)) return fail(res, 403, 'QR tidak valid atau kedaluwarsa');
    } else {
      if (b.lat == null || b.lng == null) return fail(res, 400, 'Lokasi diperlukan');
      if (s.lat == null || s.lng == null) return fail(res, 400, 'Lokasi sekolah belum diatur oleh admin');
      const dist = Math.round(haversineM(b.lat, b.lng, s.lat, s.lng));
      if (dist > s.geofence_radius_m) {
        return fail(res, 403, `Anda di luar area sekolah (${dist} m, batas ${s.geofence_radius_m} m)`, { distance_m: dist });
      }
    }

    const { date, time } = localParts(when);
    const status = toMinutes(time) > toMinutes(s.work_start) + s.late_tolerance_min ? 'terlambat' : 'hadir';
    const existing = db.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?').get(req.user.id, date);
    if (existing?.check_in) return fail(res, 409, 'Sudah check-in hari ini', { attendance: existing });
    if (existing) { // baris dari izin yang disetujui: check-in tidak menimpa
      return fail(res, 409, `Hari ini tercatat ${existing.status}`);
    }
    db.prepare(`INSERT INTO attendance (user_id,date,check_in,method,lat,lng,status,late_synced)
      VALUES (?,?,?,?,?,?,?,?)`).run(req.user.id, date, when.toISOString(), b.method, b.lat ?? null, b.lng ?? null, status, lateSynced);
    res.status(201).json(db.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?').get(req.user.id, date));
  });

  r.post('/attendance/check-out', auth, requireRole('guru'), (req, res) => {
    const d = z.object({ client_time: z.string().datetime().optional() }).safeParse(req.body ?? {});
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    let when = new Date();
    if (d.data.client_time) {
      const t = new Date(d.data.client_time), age = Date.now() - t.getTime();
      if (age < -60_000 || age > MAX_OFFLINE_AGE_MS) return fail(res, 400, 'Waktu tidak valid');
      if (age > 120_000) when = t;
    }
    const { date } = localParts(when);
    const row = db.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?').get(req.user.id, date);
    if (!row?.check_in) return fail(res, 400, 'Belum check-in hari ini');
    if (row.check_out) return fail(res, 409, 'Sudah check-out');
    if (when < new Date(row.check_in)) return fail(res, 400, 'Check-out tidak boleh sebelum check-in');
    db.prepare('UPDATE attendance SET check_out=? WHERE id=?').run(when.toISOString(), row.id);
    res.json(db.prepare('SELECT * FROM attendance WHERE id=?').get(row.id));
  });

  r.get('/attendance/today', auth, (req, res) => {
    const { date } = localParts();
    res.json({ date, attendance: db.prepare('SELECT * FROM attendance WHERE user_id=? AND date=?').get(req.user.id, date) ?? null });
  });

  // Riwayat: guru melihat miliknya; admin/kepsek bisa memfilter ?user_id=
  r.get('/attendance', auth, (req, res) => {
    const q = z.object({ month: month.optional(), user_id: z.coerce.number().int().optional() }).safeParse(req.query);
    if (!q.success) return fail(res, 400, 'Parameter tidak valid');
    const isStaff = ['admin', 'kepsek'].includes(req.user.role);
    const uid = isStaff ? q.data.user_id : req.user.id;
    const m = q.data.month ?? localParts().date.slice(0, 7);
    const rows = db.prepare(`SELECT a.*, u.full_name FROM attendance a JOIN users u ON u.id=a.user_id
      WHERE a.date LIKE ? || '-%' AND (? IS NULL OR a.user_id=?) ORDER BY a.date, u.full_name`).all(m, uid ?? null, uid ?? null);
    res.json(rows);
  });

  // Izin / sakit / cuti / dinas
  r.post('/leaves', auth, requireRole('guru'), (req, res) => {
    const d = z.object({
      type: z.enum(['izin', 'sakit', 'cuti', 'dinas']),
      start_date: ymd, end_date: ymd, reason: z.string().max(500).default(''),
      substitute_user_id: z.number().int().optional(),
    }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    if (d.data.end_date < d.data.start_date) return fail(res, 400, 'Tanggal selesai sebelum tanggal mulai');
    const info = db.prepare(`INSERT INTO leave_requests (user_id,type,start_date,end_date,reason,substitute_user_id)
      VALUES (?,?,?,?,?,?)`).run(req.user.id, d.data.type, d.data.start_date, d.data.end_date, d.data.reason, d.data.substitute_user_id ?? null);
    res.status(201).json({ id: info.lastInsertRowid, status: 'pending' });
  });

  r.get('/leaves', auth, (req, res) => {
    const isStaff = ['admin', 'kepsek'].includes(req.user.role);
    res.json(db.prepare(`SELECT l.*, u.full_name FROM leave_requests l JOIN users u ON u.id=l.user_id
      WHERE (? OR l.user_id=?) ORDER BY l.created_at DESC, l.id DESC`).all(isStaff ? 1 : 0, req.user.id));
  });

  r.patch('/leaves/:id', auth, staff, (req, res) => {
    const d = z.object({ decision: z.enum(['approved', 'rejected']) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    const l = db.prepare('SELECT * FROM leave_requests WHERE id=?').get(req.params.id);
    if (!l) return fail(res, 404, 'Pengajuan tidak ditemukan');
    if (l.status !== 'pending') return fail(res, 409, 'Pengajuan sudah diputuskan');
    db.transaction(() => {
      db.prepare("UPDATE leave_requests SET status=?, decided_by=?, decided_at=datetime('now') WHERE id=?").run(d.data.decision, req.user.id, l.id);
      if (d.data.decision === 'approved') {
        const hol = new Set(db.prepare('SELECT date FROM holidays').all().map((h) => h.date));
        const ins = db.prepare("INSERT OR IGNORE INTO attendance (user_id,date,status,method) VALUES (?,?,?, 'manual')");
        for (const day of dateRange(l.start_date, l.end_date)) if (!isWeekend(day) && !hol.has(day)) ins.run(l.user_id, day, l.type);
      }
    })();
    res.json(db.prepare('SELECT * FROM leave_requests WHERE id=?').get(l.id));
  });

  // Hari libur
  r.get('/holidays', auth, (_req, res) => res.json(db.prepare('SELECT * FROM holidays ORDER BY date').all()));
  r.post('/holidays', auth, requireRole('admin'), (req, res) => {
    const d = z.object({ date: ymd, name: z.string().min(1) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    db.prepare('INSERT OR REPLACE INTO holidays (date,name) VALUES (?,?)').run(d.data.date, d.data.name);
    res.status(201).json(d.data);
  });

  // Reset perangkat guru (ganti HP)
  r.post('/users/:id/reset-device', auth, requireRole('admin'), (req, res) => {
    const info = db.prepare('UPDATE users SET device_id=NULL WHERE id=?').run(req.params.id);
    info.changes ? res.json({ ok: true }) : fail(res, 404, 'Pengguna tidak ditemukan');
  });

  // Dasbor kepala sekolah / admin
  r.get('/dashboard/today', auth, staff, (_req, res) => {
    const { date, time } = localParts();
    const teachers = db.prepare("SELECT id,full_name FROM users WHERE role='guru' AND active=1 ORDER BY full_name").all();
    const rows = new Map(db.prepare('SELECT * FROM attendance WHERE date=?').all(date).map((a) => [a.user_id, a]));
    const counts = { hadir: 0, terlambat: 0, izin: 0, sakit: 0, cuti: 0, dinas: 0, alpa: 0 };
    const belum = [];
    for (const t of teachers) {
      const a = rows.get(t.id);
      if (a) counts[a.status]++; else belum.push(t);
    }
    res.json({ date, time, total_guru: teachers.length, counts, belum_absen: belum });
  });

  // Rekap bulanan per guru (JSON) dan Excel
  const recap = (m) => {
    const days = db.prepare("SELECT COUNT(DISTINCT date) n FROM attendance WHERE date LIKE ? || '-%'").get(m).n;
    const rows = db.prepare(`SELECT u.id, u.full_name, u.nip,
        SUM(a.status='hadir') hadir, SUM(a.status='terlambat') terlambat, SUM(a.status='izin') izin,
        SUM(a.status='sakit') sakit, SUM(a.status='cuti') cuti, SUM(a.status='dinas') dinas, SUM(a.status='alpa') alpa
      FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.date LIKE ? || '-%'
      WHERE u.role='guru' AND u.active=1 GROUP BY u.id ORDER BY u.full_name`).all(m);
    return { month: m, hari_tercatat: days, rows: rows.map((x) => ({ ...x, hadir: x.hadir ?? 0, terlambat: x.terlambat ?? 0, izin: x.izin ?? 0, sakit: x.sakit ?? 0, cuti: x.cuti ?? 0, dinas: x.dinas ?? 0, alpa: x.alpa ?? 0 })) };
  };

  r.get('/reports/attendance', auth, staff, (req, res) => {
    const q = month.safeParse(req.query.month);
    if (!q.success) return fail(res, 400, 'Parameter month (YYYY-MM) wajib');
    res.json(recap(q.data));
  });

  r.get('/reports/attendance.xlsx', auth, staff, async (req, res) => {
    const q = month.safeParse(req.query.month);
    if (!q.success) return fail(res, 400, 'Parameter month (YYYY-MM) wajib');
    const data = recap(q.data);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Rekap ' + data.month);
    ws.addRow([school()?.name ?? 'Sekolah']).font = { bold: true, size: 14 };
    ws.addRow([`Rekap Kehadiran Guru — ${data.month}`]);
    ws.addRow([]);
    const head = ws.addRow(['No', 'Nama', 'NIP', 'Hadir', 'Terlambat', 'Izin', 'Sakit', 'Cuti', 'Dinas', 'Alpa']);
    head.font = { bold: true };
    data.rows.forEach((x, i) => {
      // NIP disimpan sebagai teks agar angka panjang tidak berubah format
      const row = ws.addRow([i + 1, x.full_name, x.nip ?? '', x.hadir, x.terlambat, x.izin, x.sakit, x.cuti, x.dinas, x.alpa]);
      row.getCell(3).numFmt = '@';
    });
    ws.columns = [{ width: 5 }, { width: 30 }, { width: 22 }, ...Array(7).fill({ width: 11 })];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="rekap-guru-${data.month}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });

  return r;
}
