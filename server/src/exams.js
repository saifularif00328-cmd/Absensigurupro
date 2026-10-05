import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { requireRole } from './auth.js';
import { hub, sessionRow, gradeAnswer, currentTerm } from './scoring.js';
import { randomCode } from './util.js';
import { buildExamDocx } from './print.js';

const fail = (res, code, error, extra = {}) => res.status(code).json({ error, ...extra });
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };

const questionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pg'), body: z.string().min(1).max(5000), options: z.array(z.string().min(1).max(500)).min(2).max(6), answer: z.number().int().min(0), points: z.number().positive().max(100).default(1), subject_id: z.number().int().nullable().optional() }),
  z.object({ type: z.literal('bs'), body: z.string().min(1).max(5000), answer: z.boolean(), points: z.number().positive().max(100).default(1), subject_id: z.number().int().nullable().optional() }),
  z.object({ type: z.literal('isian'), body: z.string().min(1).max(5000), answers: z.array(z.string().min(1).max(200)).min(1).max(10), points: z.number().positive().max(100).default(1), subject_id: z.number().int().nullable().optional() }),
  z.object({ type: z.literal('uraian'), body: z.string().min(1).max(5000), rubric: z.string().max(2000).default(''), points: z.number().positive().max(100).default(5), subject_id: z.number().int().nullable().optional() }),
]).refine((q) => q.type !== 'pg' || q.answer < q.options.length, { message: 'Kunci di luar pilihan' });

function toRow(q) {
  return {
    type: q.type, body: q.body, points: q.points, subject_id: q.subject_id ?? null,
    options: q.type === 'pg' ? JSON.stringify(q.options) : null,
    answer_key: JSON.stringify(q.type === 'pg' ? q.answer : q.type === 'bs' ? q.answer : q.type === 'isian' ? q.answers : q.rubric),
  };
}
export const questionOut = (q) => ({ ...q, options: J(q.options), answer_key: J(q.answer_key), ai_generated: !!q.ai_generated, verified: !!q.verified });

export function examRoutes(db, auth) {
  const r = Router();
  const teacher = requireRole('admin', 'guru');
  const viewer = requireRole('admin', 'kepsek', 'guru');
  const mayManage = (u, row) => u.role === 'admin' || row.owner_id === u.id;
  const mayView = (u, row) => u.role === 'kepsek' || mayManage(u, row);

  // ---------- Bank soal ----------
  r.get('/questions', auth, viewer, (req, res) => {
    const sid = req.query.subject_id ? Number(req.query.subject_id) : null;
    const rows = db.prepare(`SELECT * FROM questions WHERE (? OR owner_id=?) AND (? IS NULL OR subject_id=?) AND (? IS NULL OR body LIKE '%' || ? || '%')
      ORDER BY id DESC LIMIT 500`).all(req.user.role === 'guru' ? 0 : 1, req.user.id, sid, sid, req.query.q ?? null, req.query.q ?? null);
    res.json(rows.map(questionOut));
  });

  r.post('/questions', auth, teacher, (req, res) => {
    const d = questionSchema.safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data soal tidak valid', { details: d.error.issues });
    const q = toRow(d.data);
    const i = db.prepare(`INSERT INTO questions (owner_id,subject_id,type,body,options,answer_key,points) VALUES (?,?,?,?,?,?,?)`)
      .run(req.user.id, q.subject_id, q.type, q.body, q.options, q.answer_key, q.points);
    res.status(201).json(questionOut(db.prepare('SELECT * FROM questions WHERE id=?').get(i.lastInsertRowid)));
  });

  r.put('/questions/:id', auth, teacher, (req, res) => {
    const old = db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id);
    if (!old || !mayManage(req.user, old)) return fail(res, 404, 'Soal tidak ditemukan');
    const used = db.prepare(`SELECT 1 FROM exam_questions eq JOIN exam_sessions s ON s.exam_id=eq.exam_id WHERE eq.question_id=? LIMIT 1`).get(old.id);
    if (used) return fail(res, 409, 'Soal sudah dipakai ujian yang telah dikerjakan; buat salinan baru.');
    const d = questionSchema.safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data soal tidak valid', { details: d.error.issues });
    const q = toRow(d.data);
    db.prepare('UPDATE questions SET subject_id=?,type=?,body=?,options=?,answer_key=?,points=?,verified=1 WHERE id=?')
      .run(q.subject_id, q.type, q.body, q.options, q.answer_key, q.points, old.id);
    res.json(questionOut(db.prepare('SELECT * FROM questions WHERE id=?').get(old.id)));
  });

  r.delete('/questions/:id', auth, teacher, (req, res) => {
    const old = db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id);
    if (!old || !mayManage(req.user, old)) return fail(res, 404, 'Soal tidak ditemukan');
    if (db.prepare('SELECT 1 FROM exam_questions WHERE question_id=? LIMIT 1').get(old.id)) return fail(res, 409, 'Soal dipakai oleh ujian; lepaskan dulu dari ujian.');
    db.prepare('DELETE FROM questions WHERE id=?').run(old.id);
    res.json({ ok: true });
  });

  // ---------- Ujian ----------
  const examSchema = z.object({
    title: z.string().min(1).max(120),
    subject_id: z.number().int(),
    class_id: z.number().int().nullable().default(null),
    kind: z.enum(['harian', 'uts', 'uas']).default('harian'),
    duration_min: z.number().int().min(1).max(600).default(60),
    starts_at: z.string().datetime().nullable().default(null),
    ends_at: z.string().datetime().nullable().default(null),
    require_safe_mode: z.boolean().default(false),
    max_violations: z.number().int().min(1).max(20).default(3),
    shuffle: z.boolean().default(true),
    question_ids: z.array(z.number().int()).min(1).max(200),
  });

  const setQuestions = (examId, ids, user) => {
    const uniq = [...new Set(ids)];
    const rows = db.prepare(`SELECT id,owner_id FROM questions WHERE id IN (${uniq.map(() => '?').join(',')})`).all(...uniq);
    if (rows.length !== uniq.length) return 'Ada soal yang tidak ditemukan';
    if (user.role !== 'admin' && rows.some((q) => q.owner_id !== user.id)) return 'Hanya boleh memakai soal milik sendiri';
    db.prepare('DELETE FROM exam_questions WHERE exam_id=?').run(examId);
    const ins = db.prepare('INSERT INTO exam_questions (exam_id,question_id,position) VALUES (?,?,?)');
    uniq.forEach((qid, i) => ins.run(examId, qid, i + 1));
    return null;
  };

  r.post('/exams', auth, teacher, (req, res) => {
    const d = examSchema.safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data ujian tidak valid', { details: d.error.issues });
    const b = d.data;
    if (b.starts_at && b.ends_at && b.ends_at <= b.starts_at) return fail(res, 400, 'Waktu selesai harus setelah waktu mulai');
    if (!db.prepare('SELECT 1 FROM subjects WHERE id=?').get(b.subject_id)) return fail(res, 400, 'Mapel tidak ditemukan');
    let id, err = null;
    try {
      db.transaction(() => {
        let token;
        do token = randomCode(6); while (db.prepare('SELECT 1 FROM exams WHERE token=?').get(token));
        id = db.prepare(`INSERT INTO exams (owner_id,title,subject_id,class_id,kind,token,duration_min,starts_at,ends_at,require_safe_mode,max_violations,shuffle,term)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, b.title, b.subject_id, b.class_id, b.kind, token, b.duration_min, b.starts_at, b.ends_at,
          b.require_safe_mode ? 1 : 0, b.max_violations, b.shuffle ? 1 : 0, currentTerm(db)).lastInsertRowid;
        err = setQuestions(id, b.question_ids, req.user);
        if (err) throw new Error('rollback');   // batalkan pembuatan ujian
      })();
    } catch (x) { if (!err) throw x; }
    if (err) return fail(res, 400, err);
    res.status(201).json(db.prepare('SELECT * FROM exams WHERE id=?').get(id));
  });

  r.get('/exams', auth, viewer, (req, res) => {
    res.json(db.prepare(`SELECT e.*, s.name AS subject_name, c.name AS class_name,
        (SELECT COUNT(*) FROM exam_questions q WHERE q.exam_id=e.id) AS question_count,
        (SELECT COUNT(*) FROM exam_sessions x WHERE x.exam_id=e.id) AS session_count
      FROM exams e LEFT JOIN subjects s ON s.id=e.subject_id LEFT JOIN classes c ON c.id=e.class_id
      WHERE (? OR e.owner_id=?) ORDER BY e.id DESC`).all(req.user.role === 'guru' ? 0 : 1, req.user.id));
  });

  const loadExam = (req, res, need = 'view') => {
    const e = db.prepare('SELECT * FROM exams WHERE id=?').get(req.params.id);
    const ok = e && (need === 'manage' ? mayManage(req.user, e) : mayView(req.user, e));
    if (!ok) { fail(res, 404, 'Ujian tidak ditemukan'); return null; }
    return e;
  };

  r.get('/exams/:id', auth, viewer, (req, res) => {
    const e = loadExam(req, res); if (!e) return;
    const qs = db.prepare(`SELECT q.*, eq.position FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.position`).all(e.id);
    res.json({ ...e, questions: qs.map(questionOut) });
  });

  r.put('/exams/:id', auth, teacher, (req, res) => {
    const e = loadExam(req, res, 'manage'); if (!e) return;
    if (db.prepare('SELECT 1 FROM exam_sessions WHERE exam_id=? LIMIT 1').get(e.id)) return fail(res, 409, 'Ujian sudah dimulai siswa; tidak bisa diubah.');
    const d = examSchema.safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data ujian tidak valid', { details: d.error.issues });
    const b = d.data;
    if (b.starts_at && b.ends_at && b.ends_at <= b.starts_at) return fail(res, 400, 'Waktu selesai harus setelah waktu mulai');
    let err = null;
    try {
      db.transaction(() => {
        db.prepare(`UPDATE exams SET title=?,subject_id=?,class_id=?,kind=?,duration_min=?,starts_at=?,ends_at=?,require_safe_mode=?,max_violations=?,shuffle=? WHERE id=?`)
          .run(b.title, b.subject_id, b.class_id, b.kind, b.duration_min, b.starts_at, b.ends_at, b.require_safe_mode ? 1 : 0, b.max_violations, b.shuffle ? 1 : 0, e.id);
        err = setQuestions(e.id, b.question_ids, req.user);
        if (err) throw new Error('rollback');
      })();
    } catch (x) { if (!err) throw x; }
    if (err) return fail(res, 400, err);
    res.json(db.prepare('SELECT * FROM exams WHERE id=?').get(e.id));
  });

  r.delete('/exams/:id', auth, teacher, (req, res) => {
    const e = loadExam(req, res, 'manage'); if (!e) return;
    if (db.prepare('SELECT 1 FROM exam_sessions WHERE exam_id=? LIMIT 1').get(e.id)) return fail(res, 409, 'Ujian sudah dikerjakan; tidak bisa dihapus.');
    db.prepare('DELETE FROM exams WHERE id=?').run(e.id);
    res.json({ ok: true });
  });

  // ---------- Pemantauan real-time ----------
  const monitorRows = (e) => {
    const sessions = db.prepare(`SELECT s.*, st.name, st.nis FROM exam_sessions s JOIN students st ON st.id=s.student_id WHERE s.exam_id=?`).all(e.id);
    const byStudent = new Map(sessions.map((s) => [s.student_id, sessionRow(db, s)]));
    const roster = e.class_id ? db.prepare('SELECT id,name,nis FROM students WHERE class_id=? ORDER BY name').all(e.class_id) : [];
    const rows = roster.map((st) => byStudent.get(st.id) ?? { session_id: null, student_id: st.id, name: st.name, nis: st.nis, status: 'belum', violations: 0, answered: 0, pending_grade: 0, score: null });
    for (const [id, row] of byStudent) if (!roster.some((x) => x.id === id)) rows.push(row);
    return rows;
  };

  r.get('/exams/:id/monitor', auth, viewer, (req, res) => {
    const e = loadExam(req, res); if (!e) return;
    res.json({ exam: { id: e.id, title: e.title, token: e.token, duration_min: e.duration_min }, rows: monitorRows(e) });
  });

  // SSE (dibaca klien lewat fetch streaming agar header Authorization tetap dipakai)
  r.get('/exams/:id/stream', auth, viewer, (req, res) => {
    const e = loadExam(req, res); if (!e) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    send({ type: 'hello' });
    const on = (ev) => send(ev);
    hub.on(`exam:${e.id}`, on);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); hub.off(`exam:${e.id}`, on); });
  });

  // ---------- Koreksi uraian ----------
  r.get('/exams/:id/grading', auth, teacher, (req, res) => {
    const e = loadExam(req, res, 'manage'); if (!e) return;
    res.json(db.prepare(`SELECT a.session_id, a.question_id, a.response, a.score, st.name AS student_name, q.body, q.points, q.answer_key AS rubric
      FROM answers a JOIN exam_sessions s ON s.id=a.session_id JOIN students st ON st.id=s.student_id JOIN questions q ON q.id=a.question_id
      WHERE s.exam_id=? AND q.type='uraian' AND s.submitted_at IS NOT NULL AND a.response IS NOT NULL AND a.response<>''
      ORDER BY (a.score IS NOT NULL), st.name, q.id`).all(e.id).map((x) => ({ ...x, rubric: J(x.rubric) })));
  });

  r.put('/exams/:id/grade', auth, teacher, (req, res) => {
    const e = loadExam(req, res, 'manage'); if (!e) return;
    const d = z.object({ session_id: z.number().int(), question_id: z.number().int(), score: z.number().min(0) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    const row = db.prepare(`SELECT a.*, q.points, q.type FROM answers a JOIN exam_sessions s ON s.id=a.session_id JOIN questions q ON q.id=a.question_id
      WHERE a.session_id=? AND a.question_id=? AND s.exam_id=? AND s.submitted_at IS NOT NULL`).get(d.data.session_id, d.data.question_id, e.id);
    if (!row || row.type !== 'uraian') return fail(res, 404, 'Jawaban uraian tidak ditemukan');
    if (d.data.score > row.points) return fail(res, 400, `Skor maksimal ${row.points}`);
    gradeAnswer(db, d.data.session_id, d.data.question_id, d.data.score, req.user.id);
    res.json({ ok: true });
  });

  // ---------- Hasil Excel ----------
  r.get('/exams/:id/results.xlsx', auth, viewer, async (req, res) => {
    const e = loadExam(req, res); if (!e) return;
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Hasil');
    ws.addRow([e.title]).font = { bold: true, size: 14 };
    ws.addRow([]);
    ws.addRow(['No', 'NIS', 'Nama', 'Status', 'Pelanggaran', 'Nilai']).font = { bold: true };
    monitorRows(e).forEach((x, i) => {
      const row = ws.addRow([i + 1, x.nis ?? '', x.name, x.status + (x.pending_grade ? ' (menunggu koreksi)' : ''), x.violations, x.score ?? '']);
      row.getCell(2).numFmt = '@';
    });
    ws.columns = [{ width: 5 }, { width: 16 }, { width: 30 }, { width: 28 }, { width: 12 }, { width: 10 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="hasil-ujian-${e.id}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });

  // ---------- Cetak Word ----------
  r.get('/exams/:id/print.docx', auth, teacher, async (req, res) => {
    const e = loadExam(req, res, 'manage'); if (!e) return;
    const q = z.object({
      paket: z.enum(['A', 'B']).default('A'),
      kunci: z.enum(['0', '1']).default('0'),
      per_siswa: z.enum(['0', '1']).default('0'),
      kolom: z.enum(['1', '2']).default('1'),
    }).safeParse(req.query);
    if (!q.success) return fail(res, 400, 'Parameter tidak valid');
    const school = db.prepare('SELECT * FROM school WHERE id=1').get();
    const questions = db.prepare(`SELECT q.* FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.position`).all(e.id).map(questionOut);
    const klass = e.class_id ? db.prepare('SELECT name FROM classes WHERE id=?').get(e.class_id)?.name : '';
    const subject = e.subject_id ? db.prepare('SELECT name FROM subjects WHERE id=?').get(e.subject_id)?.name : '';
    const students = q.data.per_siswa === '1' && e.class_id ? db.prepare('SELECT name,nis FROM students WHERE class_id=? ORDER BY name').all(e.class_id) : [];
    if (q.data.per_siswa === '1' && students.length === 0) return fail(res, 400, 'Kelas ujian belum punya siswa untuk cetak per siswa');
    const buf = await buildExamDocx({
      school, exam: e, questions, className: klass, subjectName: subject, students,
      paket: q.data.paket, withKey: q.data.kunci === '1', columns: Number(q.data.kolom),
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="soal-${e.id}-paket-${q.data.paket}.docx"`);
    res.send(buf);
  });

  return r;
}
