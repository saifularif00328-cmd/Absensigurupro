import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { seededShuffle } from './util.js';
import { finalizeSession, broadcast, autoScore } from './scoring.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-ganti-di-produksi';
const GRACE_MS = 5000; // toleransi jaringan saat menyimpan jawaban terakhir
const fail = (res, code, error, extra = {}) => res.status(code).json({ error, ...extra });
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };

export const deadlineOf = (exam, session) => {
  const byDuration = new Date(session.started_at).getTime() + exam.duration_min * 60_000;
  const byWindow = exam.ends_at ? new Date(exam.ends_at).getTime() : Infinity;
  return Math.min(byDuration, byWindow);
};

export function studentExamRoutes(db) {
  const r = Router();
  const base = '/ujian';

  // Satu siswa -> satu sesi aktif: join baru memutar nonce dan mematikan perangkat lama
  r.post(`${base}/join`, (req, res) => {
    const d = z.object({ token: z.string().min(4).max(20), nis: z.string().min(1).max(40), code: z.string().min(4).max(20) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    const exam = db.prepare('SELECT * FROM exams WHERE token=?').get(d.data.token.trim().toUpperCase());
    const st = db.prepare('SELECT * FROM students WHERE nis=?').get(d.data.nis.trim());
    // pesan seragam agar token/NIS tidak bisa ditebak satu per satu
    if (!exam || !st || st.access_code !== d.data.code.trim().toUpperCase() || (exam.class_id && st.class_id !== exam.class_id)) {
      return fail(res, 403, 'Token ujian, NIS, atau kode siswa salah');
    }
    if (exam.require_safe_mode && req.headers['x-safe-mode'] !== '1') {
      return fail(res, 403, 'Ujian ini hanya dapat dibuka lewat aplikasi Ujian Aman');
    }
    const now = Date.now();
    if (exam.starts_at && now < new Date(exam.starts_at).getTime()) return fail(res, 403, 'Ujian belum dimulai');
    if (exam.ends_at && now >= new Date(exam.ends_at).getTime()) return fail(res, 403, 'Ujian sudah ditutup');
    let s = db.prepare('SELECT * FROM exam_sessions WHERE exam_id=? AND student_id=?').get(exam.id, st.id);
    const nonce = randomBytes(8).toString('hex');
    if (s?.submitted_at) return fail(res, 409, 'Anda sudah menyelesaikan ujian ini');
    if (!s) {
      const id = db.prepare('INSERT INTO exam_sessions (exam_id,student_id,started_at,nonce) VALUES (?,?,?,?)').run(exam.id, st.id, new Date().toISOString(), nonce).lastInsertRowid;
      s = db.prepare('SELECT * FROM exam_sessions WHERE id=?').get(id);
    } else {
      db.prepare('UPDATE exam_sessions SET nonce=? WHERE id=?').run(nonce, s.id);
    }
    broadcast(db, s.id);
    res.json({ token: jwt.sign({ sid: s.id, nonce, kind: 'siswa' }, SECRET, { expiresIn: '12h' }), student: st.name });
  });

  const needSession = (req, res, next) => {
    try {
      const p = jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), SECRET);
      if (p.kind !== 'siswa') throw new Error('bukan siswa');
      const s = db.prepare('SELECT * FROM exam_sessions WHERE id=?').get(p.sid);
      if (!s || s.nonce !== p.nonce) return fail(res, 401, 'Sesi ujian dipakai di perangkat lain atau tidak valid');
      const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(s.exam_id);
      if (!s.submitted_at && Date.now() > deadlineOf(exam, s) + GRACE_MS) {
        finalizeSession(db, s.id, 'waktu habis');
        return fail(res, 403, 'Waktu ujian habis', { finished: true });
      }
      req.sess = db.prepare('SELECT * FROM exam_sessions WHERE id=?').get(s.id);
      req.exam = exam;
      next();
    } catch {
      fail(res, 401, 'Sesi ujian tidak valid');
    }
  };

  // Soal untuk siswa: tanpa kunci; urutan soal & opsi diacak tetap per sesi; id opsi asli dikirim
  r.get(`${base}/me`, needSession, (req, res) => {
    const { sess: s, exam: e } = req;
    let qs = db.prepare(`SELECT q.* FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.position`).all(e.id);
    if (e.shuffle) qs = seededShuffle(qs, s.id);
    const questions = qs.map((q) => {
      const opts = J(q.options);
      const options = opts ? (e.shuffle ? seededShuffle(opts.map((t, i) => ({ idx: i, text: t })), s.id * 31 + q.id) : opts.map((t, i) => ({ idx: i, text: t }))) : null;
      return { id: q.id, type: q.type, body: q.body, points: q.points, options };
    });
    const answers = Object.fromEntries(db.prepare('SELECT question_id,response FROM answers WHERE session_id=?').all(s.id).map((a) => [a.question_id, a.response]));
    const student = db.prepare('SELECT name FROM students WHERE id=?').get(s.student_id);
    res.json({
      exam: { title: e.title, max_violations: e.max_violations, duration_min: e.duration_min },
      student: student.name, finished: !!s.submitted_at, violations: s.violations,
      deadline: new Date(deadlineOf(e, s)).toISOString(), server_time: new Date().toISOString(),
      questions, answers,
    });
  });

  r.put(`${base}/answer`, needSession, (req, res) => {
    if (req.sess.submitted_at) return fail(res, 409, 'Ujian sudah dikumpulkan');
    const d = z.object({ question_id: z.number().int(), response: z.string().max(5000) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    const q = db.prepare(`SELECT q.* FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? AND q.id=?`).get(req.exam.id, d.data.question_id);
    if (!q) return fail(res, 404, 'Soal bukan bagian dari ujian ini');
    if (q.type === 'pg') {
      const n = Number(d.data.response);
      if (d.data.response !== '' && !(Number.isInteger(n) && n >= 0 && n < J(q.options).length)) return fail(res, 400, 'Pilihan tidak valid');
    }
    if (q.type === 'bs' && !['', 'true', 'false'].includes(d.data.response)) return fail(res, 400, 'Jawaban tidak valid');
    // Skor objektif langsung dihitung sehingga dasbor guru ikut bergerak; uraian menunggu koreksi
    const score = autoScore(q, d.data.response);
    db.prepare(`INSERT INTO answers (session_id,question_id,response,score) VALUES (?,?,?,?)
      ON CONFLICT(session_id,question_id) DO UPDATE SET response=excluded.response, score=excluded.score`).run(req.sess.id, q.id, d.data.response, score);
    broadcast(db, req.sess.id);
    res.json({ ok: true });
  });

  r.post(`${base}/violation`, needSession, (req, res) => {
    if (req.sess.submitted_at) return res.json({ locked: true });
    const d = z.object({ kind: z.enum(['pindah_tab', 'keluar_fullscreen', 'salin_tempel', 'perangkat_lain', 'lainnya']) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    db.prepare('INSERT INTO violations (session_id,kind) VALUES (?,?)').run(req.sess.id, d.data.kind);
    db.prepare('UPDATE exam_sessions SET violations = violations + 1 WHERE id=?').run(req.sess.id);
    const v = db.prepare('SELECT violations FROM exam_sessions WHERE id=?').get(req.sess.id).violations;
    if (v >= req.exam.max_violations) {
      finalizeSession(db, req.sess.id, 'pelanggaran melebihi batas');
      return res.json({ violations: v, locked: true });
    }
    broadcast(db, req.sess.id);
    res.json({ violations: v, locked: false, max: req.exam.max_violations });
  });

  r.post(`${base}/submit`, needSession, (req, res) => {
    finalizeSession(db, req.sess.id, 'dikumpulkan siswa');
    res.json({ ok: true });
  });

  return r;
}
