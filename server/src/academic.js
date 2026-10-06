import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from './auth.js';
import { isUniqueViolation } from './db.js';
import { randomCode } from './util.js';
import { importStudents } from './importer.js';

const fail = (res, code, error, extra = {}) => res.status(code).json({ error, ...extra });

export function academicRoutes(db, auth) {
  const r = Router();
  const admin = requireRole('admin');
  const stats = requireRole('admin', 'kepsek', 'guru');

  r.get('/classes', auth, stats, (_req, res) =>
    res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id=c.id) AS student_count FROM classes c ORDER BY c.name`).all()));
  r.post('/classes', auth, admin, (req, res) => {
    const d = z.object({ name: z.string().min(1).max(40), level: z.string().max(20).optional(), wali_user_id: z.number().int().optional() }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    try {
      const i = db.prepare('INSERT INTO classes (name,level,wali_user_id) VALUES (?,?,?)').run(d.data.name, d.data.level ?? null, d.data.wali_user_id ?? null);
      res.status(201).json({ id: i.lastInsertRowid });
    } catch (e) {
      if (isUniqueViolation(e)) return fail(res, 409, 'Nama kelas sudah ada');
      throw e;
    }
  });

  r.get('/subjects', auth, stats, (_req, res) =>
    res.json(db.prepare(`SELECT s.*, COALESCE(w.harian,0.4) w_harian, COALESCE(w.uts,0.3) w_uts, COALESCE(w.uas,0.3) w_uas
      FROM subjects s LEFT JOIN grade_weights w ON w.subject_id=s.id ORDER BY s.name`).all()));
  r.post('/subjects', auth, admin, (req, res) => {
    const d = z.object({ name: z.string().min(1).max(60) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    try {
      res.status(201).json({ id: db.prepare('INSERT INTO subjects (name) VALUES (?)').run(d.data.name).lastInsertRowid });
    } catch (e) {
      if (isUniqueViolation(e)) return fail(res, 409, 'Mapel sudah ada');
      throw e;
    }
  });
  r.put('/subjects/:id/weights', auth, admin, (req, res) => {
    const d = z.object({ harian: z.number().min(0), uts: z.number().min(0), uas: z.number().min(0) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    const sum = d.data.harian + d.data.uts + d.data.uas;
    if (Math.abs(sum - 1) > 0.001) return fail(res, 400, 'Jumlah bobot harus 1 (100%)');
    if (!db.prepare('SELECT 1 FROM subjects WHERE id=?').get(req.params.id)) return fail(res, 404, 'Mapel tidak ditemukan');
    db.prepare(`INSERT INTO grade_weights (subject_id,harian,uts,uas) VALUES (?,?,?,?)
      ON CONFLICT(subject_id) DO UPDATE SET harian=excluded.harian, uts=excluded.uts, uas=excluded.uas`).run(req.params.id, d.data.harian, d.data.uts, d.data.uas);
    res.json({ ok: true });
  });

  r.get('/students', auth, stats, (req, res) => {
    const cid = req.query.class_id ? Number(req.query.class_id) : null;
    res.json(db.prepare(`SELECT s.id,s.nis,s.name,s.class_id,s.access_code,c.name AS class_name FROM students s
      LEFT JOIN classes c ON c.id=s.class_id WHERE (? IS NULL OR s.class_id=?) ORDER BY c.name, s.name`).all(cid, cid));
  });

  // Impor teks CSV: nis,nama,kelas (baris judul opsional; pemisah koma/titik koma/tab)
  r.post('/students/import', auth, admin, (req, res) => {
    const d = z.object({ csv: z.string().min(1).max(500_000), default_class_id: z.number().int().optional() }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    const rows = [];
    d.data.csv.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      const [nis, nama, kelas] = line.split(/[,;\t]/).map((x) => x.trim().replace(/^"|"$/g, ''));
      if (i === 0 && /^nis$/i.test(nis)) return;
      rows.push({ line: i + 1, nis: nis ?? '', nama: nama ?? '', kelas: kelas ?? '' });
    });
    res.json(importStudents(db, rows, d.data.default_class_id ?? null));
  });

  r.post('/students/:id/reset-code', auth, admin, (req, res) => {
    const code = randomCode(6);
    const i = db.prepare('UPDATE students SET access_code=? WHERE id=?').run(code, req.params.id);
    i.changes ? res.json({ access_code: code }) : fail(res, 404, 'Siswa tidak ditemukan');
  });

  return r;
}
