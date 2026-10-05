import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { requireRole } from './auth.js';
import { currentTerm } from './scoring.js';
import { round2 } from './util.js';

const fail = (res, code, error) => res.status(code).json({ error });
const KINDS = ['harian', 'uts', 'uas'];

export function reportRoutes(db, auth) {
  const r = Router();
  const viewer = requireRole('admin', 'kepsek', 'guru');

  // Nilai akhir per mapel: rata-rata tiap jenis, dibobot; bobot jenis yang belum ada dibagi ulang
  function subjectRows(studentId, term) {
    const grades = db.prepare('SELECT subject_id,kind,score FROM grades WHERE student_id=? AND term=?').all(studentId, term);
    const subjects = db.prepare('SELECT id,name FROM subjects ORDER BY name').all();
    const weights = new Map(db.prepare('SELECT * FROM grade_weights').all().map((w) => [w.subject_id, w]));
    const rows = [];
    for (const sub of subjects) {
      const mine = grades.filter((g) => g.subject_id === sub.id);
      if (!mine.length) continue;
      const w = weights.get(sub.id) ?? { harian: 0.4, uts: 0.3, uas: 0.3 };
      const avg = {};
      let wsum = 0, acc = 0;
      for (const k of KINDS) {
        const v = mine.filter((g) => g.kind === k).map((g) => g.score);
        avg[k] = v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null;
        if (avg[k] != null) { wsum += w[k]; acc += w[k] * avg[k]; }
      }
      rows.push({ subject_id: sub.id, subject: sub.name, ...avg, final: wsum > 0 ? round2(acc / wsum) : null });
    }
    return rows;
  }

  function rapor(student, term) {
    const absence = db.prepare('SELECT sakit,izin,alpa FROM student_absence_summary WHERE student_id=? AND term=?').get(student.id, term) ?? { sakit: 0, izin: 0, alpa: 0 };
    const subjects = subjectRows(student.id, term);
    const finals = subjects.map((s) => s.final).filter((x) => x != null);
    return { student: { id: student.id, nis: student.nis, name: student.name, class_name: student.class_name }, term, subjects, average: finals.length ? round2(finals.reduce((a, b) => a + b, 0) / finals.length) : null, absence };
  }

  const studentsOf = (classId) => db.prepare(`SELECT s.id,s.nis,s.name,c.name AS class_name FROM students s LEFT JOIN classes c ON c.id=s.class_id
    WHERE (? IS NULL OR s.class_id=?) ORDER BY s.name`).all(classId, classId);
  const q = z.object({ class_id: z.coerce.number().int().optional(), term: z.string().max(40).optional() });

  r.get('/reports/rapor', auth, viewer, (req, res) => {
    const p = q.safeParse(req.query);
    if (!p.success) return fail(res, 400, 'Parameter tidak valid');
    const term = p.data.term || currentTerm(db);
    res.json({ term, rows: studentsOf(p.data.class_id ?? null).map((s) => rapor(s, term)) });
  });

  r.get('/reports/rapor/:studentId', auth, viewer, (req, res) => {
    const st = db.prepare(`SELECT s.id,s.nis,s.name,c.name AS class_name FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.id=?`).get(req.params.studentId);
    if (!st) return fail(res, 404, 'Siswa tidak ditemukan');
    const school = db.prepare('SELECT name,address,kop_lines FROM school WHERE id=1').get();
    res.json({ school, ...rapor(st, req.query.term || currentTerm(db)) });
  });

  r.get('/reports/rapor.xlsx', auth, viewer, async (req, res) => {
    const p = q.safeParse(req.query);
    if (!p.success) return fail(res, 400, 'Parameter tidak valid');
    const term = p.data.term || currentTerm(db);
    const data = studentsOf(p.data.class_id ?? null).map((s) => rapor(s, term));
    const subjects = db.prepare('SELECT name FROM subjects ORDER BY name').all().map((s) => s.name);
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Nilai');
    ws.addRow([`Daftar Nilai Akhir — ${term}`]).font = { bold: true, size: 14 };
    ws.addRow([]);
    ws.addRow(['No', 'NIS', 'Nama', ...subjects, 'Rata-rata', 'S', 'I', 'A']).font = { bold: true };
    data.forEach((d, i) => {
      const by = new Map(d.subjects.map((s) => [s.subject, s.final]));
      const row = ws.addRow([i + 1, d.student.nis ?? '', d.student.name, ...subjects.map((s) => by.get(s) ?? ''), d.average ?? '', d.absence.sakit, d.absence.izin, d.absence.alpa]);
      row.getCell(2).numFmt = '@';
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="nilai-${term.replace(/[^\w-]+/g, '_')}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });

  // Rekap S/I/A siswa untuk rapor: admin atau wali kelas dari kelas siswa tsb
  r.put('/absence-summary', auth, viewer, (req, res) => {
    const d = z.object({ student_id: z.number().int(), term: z.string().max(40).optional(), sakit: z.number().int().min(0).max(400), izin: z.number().int().min(0).max(400), alpa: z.number().int().min(0).max(400) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    const st = db.prepare('SELECT s.id, c.wali_user_id FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.id=?').get(d.data.student_id);
    if (!st) return fail(res, 404, 'Siswa tidak ditemukan');
    if (req.user.role !== 'admin' && st.wali_user_id !== req.user.id) return res.status(403).json({ error: 'Hanya admin atau wali kelas' });
    db.prepare(`INSERT INTO student_absence_summary (student_id,term,sakit,izin,alpa) VALUES (?,?,?,?,?)
      ON CONFLICT(student_id,term) DO UPDATE SET sakit=excluded.sakit, izin=excluded.izin, alpa=excluded.alpa`)
      .run(d.data.student_id, d.data.term || currentTerm(db), d.data.sakit, d.data.izin, d.data.alpa);
    res.json({ ok: true });
  });

  return r;
}
