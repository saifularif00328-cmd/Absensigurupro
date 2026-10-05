import { EventEmitter } from 'node:events';
import { normalizeText, round2 } from './util.js';
import { localParts } from './timeutil.js';
import { defaultTerm } from './util.js';

// Pemancar peristiwa ujian -> dasbor guru (SSE)
export const hub = new EventEmitter();
hub.setMaxListeners(0);

const J = (s) => { try { return JSON.parse(s); } catch { return null; } };

// Skor otomatis satu jawaban; null = perlu koreksi manual (uraian)
export function autoScore(q, response) {
  if (q.type === 'uraian') return null;
  if (response == null || response === '') return 0;
  const key = J(q.answer_key);
  let ok = false;
  if (q.type === 'pg') ok = Number(response) === key;
  else if (q.type === 'bs') ok = String(response) === String(key);
  else if (q.type === 'isian') ok = (Array.isArray(key) ? key : [key]).some((k) => normalizeText(k) === normalizeText(response));
  return ok ? q.points : 0;
}

export function currentTerm(db) {
  const t = db.prepare('SELECT current_term FROM school WHERE id=1').get()?.current_term;
  return t || defaultTerm(localParts().date);
}

// Ringkasan satu sesi: jumlah terjawab, skor, dan uraian yang menunggu koreksi
export function sessionSummary(db, sessionId) {
  const s = db.prepare('SELECT * FROM exam_sessions WHERE id=?').get(sessionId);
  const qs = db.prepare(`SELECT q.id,q.type,q.points FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=?`).all(s.exam_id);
  const ans = new Map(db.prepare('SELECT * FROM answers WHERE session_id=?').all(sessionId).map((a) => [a.question_id, a]));
  let total = 0, earned = 0, answered = 0, pending = 0;
  for (const q of qs) {
    total += q.points;
    const a = ans.get(q.id);
    if (a && a.response != null && a.response !== '') answered++;
    if (a?.score != null) earned += a.score;
    else if (q.type === 'uraian' && a && a.response) pending++;
  }
  return { total_questions: qs.length, answered, pending_grade: pending, total_points: total, earned, score: total ? round2((earned / total) * 100) : 0 };
}

// Tulis nilai ke tabel grades bila sesi selesai dan tidak ada uraian tertunda
function publishGrade(db, sessionId) {
  const s = db.prepare('SELECT * FROM exam_sessions WHERE id=?').get(sessionId);
  if (!s.submitted_at) return false;
  const sum = sessionSummary(db, sessionId);
  if (sum.pending_grade > 0) return false;
  db.prepare('UPDATE exam_sessions SET score=? WHERE id=?').run(sum.score, sessionId);
  const e = db.prepare('SELECT * FROM exams WHERE id=?').get(s.exam_id);
  if (e.subject_id) {
    db.prepare(`INSERT INTO grades (student_id,subject_id,term,kind,exam_id,score) VALUES (?,?,?,?,?,?)
      ON CONFLICT(student_id,subject_id,term,kind,exam_id) DO UPDATE SET score=excluded.score`)
      .run(s.student_id, e.subject_id, e.term || currentTerm(db), e.kind, e.id, sum.score);
  }
  return true;
}

export function broadcast(db, sessionId) {
  const s = db.prepare(`SELECT s.*, st.name, st.nis FROM exam_sessions s JOIN students st ON st.id=s.student_id WHERE s.id=?`).get(sessionId);
  hub.emit(`exam:${s.exam_id}`, { type: 'session', session: sessionRow(db, s) });
}

export function sessionRow(db, s) {
  const sum = sessionSummary(db, s.id);
  return {
    session_id: s.id, student_id: s.student_id, name: s.name, nis: s.nis,
    status: s.submitted_at ? 'selesai' : 'mengerjakan', submit_reason: s.submit_reason,
    started_at: s.started_at, submitted_at: s.submitted_at, violations: s.violations,
    answered: sum.answered, total_questions: sum.total_questions, pending_grade: sum.pending_grade,
    score: s.submitted_at && sum.pending_grade === 0 ? sum.score : null,
  };
}

// Akhiri sesi: uraian kosong = 0, hitung skor, terbitkan nilai bila lengkap
export function finalizeSession(db, sessionId, reason) {
  const s = db.prepare('SELECT * FROM exam_sessions WHERE id=?').get(sessionId);
  if (s.submitted_at) return false;
  db.transaction(() => {
    db.prepare('UPDATE exam_sessions SET submitted_at=?, submit_reason=? WHERE id=?').run(new Date().toISOString(), reason, sessionId);
    const qs = db.prepare(`SELECT q.* FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=?`).all(s.exam_id);
    const have = new Map(db.prepare('SELECT * FROM answers WHERE session_id=?').all(sessionId).map((a) => [a.question_id, a]));
    const up = db.prepare(`INSERT INTO answers (session_id,question_id,response,score) VALUES (?,?,?,?)
      ON CONFLICT(session_id,question_id) DO UPDATE SET score=excluded.score`);
    for (const q of qs) {
      const a = have.get(q.id);
      if (q.type === 'uraian') { if (!a || !a.response) up.run(sessionId, q.id, a?.response ?? null, 0); }
      else up.run(sessionId, q.id, a?.response ?? null, autoScore(q, a?.response));
    }
    publishGrade(db, sessionId);
  })();
  broadcast(db, sessionId);
  return true;
}

export function gradeAnswer(db, sessionId, questionId, score, graderId) {
  db.prepare('UPDATE answers SET score=?, graded_by=? WHERE session_id=? AND question_id=?').run(score, graderId, sessionId, questionId);
  publishGrade(db, sessionId);
  broadcast(db, sessionId);
}
