import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { autoScore } from './scoring.js';
import { seededShuffle } from './util.js';

async function setup() {
  const db = openDb(':memory:');
  const h = bcrypt.hashSync('password123', 4);
  for (const [u, n, role] of [['admin', 'Admin', 'admin'], ['kepsek', 'Kepsek', 'kepsek'], ['guru1', 'Ani', 'guru'], ['guru2', 'Budi', 'guru']]) {
    db.prepare('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)').run(u, h, n, role);
  }
  db.prepare("INSERT INTO school (id,name,address,kop_lines,current_term) VALUES (1,'SMA Uji','Jl. Contoh 1','[\"PEMERINTAH KOTA UJI\"]','2026/2027 Ganjil')").run();
  const server = createApp(db).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const call = async (path, { method = 'GET', body, token, raw, headers } = {}) => {
    const r = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
      body: body && JSON.stringify(body),
    });
    return raw ? r : { status: r.status, json: await r.json().catch(() => ({})) };
  };
  const login = async (u) => (await call('/api/auth/login', { method: 'POST', body: { username: u, password: 'password123' } })).json.token;
  const t = { admin: await login('admin'), kepsek: await login('kepsek'), g1: await login('guru1'), g2: await login('guru2') };
  // data akademik
  await call('/api/subjects', { method: 'POST', token: t.admin, body: { name: 'Matematika' } });
  const imp = await call('/api/students/import', { method: 'POST', token: t.admin, body: { csv: 'nis,nama,kelas\n1001,Citra,7A\n1002,Dedi,7A\n1003,Eka,7B\n,tanpa-nis,7A' } });
  const students = (await call('/api/students', { token: t.g1 })).json;
  const classes = (await call('/api/classes', { token: t.g1 })).json;
  const subj = (await call('/api/subjects', { token: t.g1 })).json[0].id;
  const code = (nis) => students.find((s) => s.nis === nis).access_code;
  const class7A = classes.find((c) => c.name === '7A').id;
  return { db, server, call, t, imp, students, subj, code, class7A, close: () => server.close() };
}

const Q = {
  pg: { type: 'pg', body: '2+2 = ?', options: ['3', '4', '5', '6'], answer: 1, points: 2 },
  bs: { type: 'bs', body: 'Bumi itu bulat', answer: true, points: 1 },
  isian: { type: 'isian', body: 'Ibu kota Indonesia?', answers: ['Jakarta', 'DKI Jakarta'], points: 2 },
  uraian: { type: 'uraian', body: 'Jelaskan fotosintesis', rubric: 'Menyebut cahaya, air, CO2', points: 5 },
};

async function makeExam(s, extra = {}) {
  const ids = [];
  for (const q of Object.values(Q)) ids.push((await s.call('/api/questions', { method: 'POST', token: s.t.g1, body: { ...q, subject_id: s.subj } })).json.id);
  const e = await s.call('/api/exams', { method: 'POST', token: s.t.g1, body: { title: 'UH 1', subject_id: s.subj, class_id: s.class7A, kind: 'harian', duration_min: 30, question_ids: ids, ...extra } });
  assert.equal(e.status, 201, JSON.stringify(e.json));
  return { exam: e.json, ids };
}
const join = (s, exam, nis) => s.call('/api/ujian/join', { method: 'POST', body: { token: exam.token, nis, code: s.code(nis) } });

test('autoScore: pg, bs, isian (toleran huruf/spasi), uraian manual', () => {
  const pg = { type: 'pg', answer_key: '1', points: 2 };
  assert.equal(autoScore(pg, '1'), 2);
  assert.equal(autoScore(pg, '0'), 0);
  assert.equal(autoScore(pg, ''), 0);
  assert.equal(autoScore({ type: 'bs', answer_key: 'true', points: 1 }, 'true'), 1);
  assert.equal(autoScore({ type: 'bs', answer_key: 'false', points: 1 }, 'true'), 0);
  const isi = { type: 'isian', answer_key: '["Jakarta","DKI Jakarta"]', points: 2 };
  assert.equal(autoScore(isi, '  dki   JAKARTA '), 2);
  assert.equal(autoScore(isi, 'Bandung'), 0);
  assert.equal(autoScore({ type: 'uraian', answer_key: '""', points: 5 }, 'apa saja'), null);
});

test('seededShuffle deterministik dan permutasi lengkap', () => {
  const a = seededShuffle([1, 2, 3, 4, 5, 6], 42), b = seededShuffle([1, 2, 3, 4, 5, 6], 42);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5, 6]);
});

test('impor siswa: kelas dibuat otomatis, baris rusak dilaporkan, impor ulang memperbarui', async () => {
  const s = await setup();
  assert.equal(s.imp.json.created, 3);
  assert.equal(s.imp.json.errors.length, 1);
  assert.equal(s.students.length, 3);
  assert.match(s.students[0].access_code, /^[A-Z2-9]{6}$/);
  const again = await s.call('/api/students/import', { method: 'POST', token: s.t.admin, body: { csv: '1001;Citra Baru;7A' } });
  assert.deepEqual([again.json.created, again.json.updated], [0, 1]);
  assert.equal((await s.call('/api/students/import', { method: 'POST', token: s.t.g1, body: { csv: 'x' } })).status, 403);
  s.close();
});

test('bank soal: validasi, kepemilikan, dan kunci tidak bocor ke siswa', async () => {
  const s = await setup();
  const bad = await s.call('/api/questions', { method: 'POST', token: s.t.g1, body: { type: 'pg', body: 'x', options: ['a', 'b'], answer: 5 } });
  assert.equal(bad.status, 400);
  const { exam, ids } = await makeExam(s);
  assert.equal((await s.call('/api/questions', { token: s.t.g2 })).json.length, 0);       // guru lain tidak melihat
  assert.equal((await s.call('/api/questions', { token: s.t.kepsek })).json.length, 4);
  assert.equal((await s.call(`/api/questions/${ids[0]}`, { method: 'DELETE', token: s.t.g1 })).status, 409); // dipakai ujian
  const j = await join(s, exam, '1001');
  const me = (await s.call('/api/ujian/me', { token: j.json.token })).json;
  const txt = JSON.stringify(me);
  assert.equal(me.questions.length, 4);
  assert.ok(!/answer_key|rubric|"answer"/.test(txt), 'kunci tidak boleh bocor');
  assert.equal(me.student, 'Citra');
  s.close();
});

test('alur lengkap: ujian -> koreksi otomatis -> koreksi uraian -> nilai masuk rapor berbobot', async () => {
  const s = await setup();
  const { exam, ids } = await makeExam(s);
  const j = await join(s, exam, '1001');
  const tok = j.json.token;
  const ans = (qid, response) => s.call('/api/ujian/answer', { method: 'PUT', token: tok, body: { question_id: qid, response } });
  assert.equal((await ans(ids[0], '1')).status, 200);                  // pg benar (2)
  assert.equal((await ans(ids[1], 'true')).status, 200);               // bs benar (1)
  assert.equal((await ans(ids[2], 'jakarta')).status, 200);            // isian benar (2)
  assert.equal((await ans(ids[3], 'Tumbuhan memakai cahaya, air, dan CO2')).status, 200);
  assert.equal((await ans(ids[0], '9')).status, 400);                  // opsi di luar jangkauan
  assert.equal((await ans(9999, '1')).status, 404);

  // dasbor guru melihat progres langsung sebelum dikumpulkan
  let mon = (await s.call(`/api/exams/${exam.id}/monitor`, { token: s.t.g1 })).json;
  const citra = mon.rows.find((r) => r.name === 'Citra');
  assert.equal(citra.status, 'mengerjakan');
  assert.equal(citra.answered, 4);
  assert.equal(mon.rows.find((r) => r.name === 'Dedi').status, 'belum');
  assert.equal(mon.rows.length, 2);                                     // hanya kelas 7A

  assert.equal((await s.call('/api/ujian/submit', { method: 'POST', token: tok })).status, 200);
  assert.equal((await ans(ids[0], '0')).status, 409);                   // setelah kumpul tidak bisa mengubah
  mon = (await s.call(`/api/exams/${exam.id}/monitor`, { token: s.t.g1 })).json;
  const done = mon.rows.find((r) => r.name === 'Citra');
  assert.equal(done.status, 'selesai');
  assert.equal(done.pending_grade, 1);
  assert.equal(done.score, null);                                       // menunggu koreksi uraian
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM grades').get().n, 0);

  // koreksi uraian
  const g = (await s.call(`/api/exams/${exam.id}/grading`, { token: s.t.g1 })).json;
  assert.equal(g.length, 1);
  assert.equal(g[0].student_name, 'Citra');
  assert.equal((await s.call(`/api/exams/${exam.id}/grade`, { method: 'PUT', token: s.t.g1, body: { session_id: g[0].session_id, question_id: g[0].question_id, score: 99 } })).status, 400);
  assert.equal((await s.call(`/api/exams/${exam.id}/grade`, { method: 'PUT', token: s.t.g2, body: { session_id: g[0].session_id, question_id: g[0].question_id, score: 4 } })).status, 404);
  assert.equal((await s.call(`/api/exams/${exam.id}/grade`, { method: 'PUT', token: s.t.g1, body: { session_id: g[0].session_id, question_id: g[0].question_id, score: 4 } })).status, 200);
  // (2+1+2+4)/10 = 90
  const row = s.db.prepare('SELECT * FROM grades').get();
  assert.equal(row.score, 90);
  assert.equal(row.kind, 'harian');
  assert.equal(row.term, '2026/2027 Ganjil');

  // rapor: tambah nilai UTS 70 secara langsung; bobot default 40/30/30 dengan UAS kosong -> dibagi ulang
  const utsId = s.db.prepare("INSERT INTO exams (owner_id,title,subject_id,class_id,kind,token) VALUES (1,'UTS',?,?,'uts','UTSTOK')").run(s.subj, s.class7A).lastInsertRowid;
  s.db.prepare("INSERT INTO grades (student_id,subject_id,term,kind,exam_id,score) VALUES (?,?,?,?,?,?)")
    .run(row.student_id, s.subj, '2026/2027 Ganjil', 'uts', utsId, 70);
  const rap = (await s.call(`/api/reports/rapor?class_id=${s.class7A}`, { token: s.t.g1 })).json;
  const c = rap.rows.find((x) => x.student.name === 'Citra');
  assert.equal(c.subjects[0].harian, 90);
  assert.equal(c.subjects[0].uts, 70);
  assert.equal(c.subjects[0].final, Math.round(((0.4 * 90 + 0.3 * 70) / 0.7) * 100) / 100);
  assert.equal(rap.rows.find((x) => x.student.name === 'Dedi').subjects.length, 0);

  // bobot kustom harus berjumlah 1
  assert.equal((await s.call(`/api/subjects/${s.subj}/weights`, { method: 'PUT', token: s.t.admin, body: { harian: 0.5, uts: 0.5, uas: 0.5 } })).status, 400);
  assert.equal((await s.call(`/api/subjects/${s.subj}/weights`, { method: 'PUT', token: s.t.admin, body: { harian: 0.5, uts: 0.25, uas: 0.25 } })).status, 200);
  const rap2 = (await s.call(`/api/reports/rapor?class_id=${s.class7A}`, { token: s.t.g1 })).json;
  assert.equal(rap2.rows.find((x) => x.student.name === 'Citra').subjects[0].final, Math.round(((0.5 * 90 + 0.25 * 70) / 0.75) * 100) / 100);

  // Excel nilai
  const x = await s.call(`/api/reports/rapor.xlsx?class_id=${s.class7A}`, { token: s.t.g1, raw: true });
  assert.equal(Buffer.from(await x.arrayBuffer()).slice(0, 2).toString(), 'PK');
  s.close();
});

test('uraian kosong otomatis 0 sehingga nilai langsung terbit tanpa antrean koreksi', async () => {
  const s = await setup();
  const { exam, ids } = await makeExam(s);
  const tok = (await join(s, exam, '1002')).json.token;
  await s.call('/api/ujian/answer', { method: 'PUT', token: tok, body: { question_id: ids[0], response: '1' } });
  await s.call('/api/ujian/submit', { method: 'POST', token: tok });
  assert.equal(s.db.prepare('SELECT score FROM grades').get().score, 20);   // 2 dari 10
  s.close();
});

test('join: kode salah, kelas salah, jendela waktu, selesai, dan satu sesi aktif', async () => {
  const s = await setup();
  const { exam } = await makeExam(s);
  const bad = await s.call('/api/ujian/join', { method: 'POST', body: { token: exam.token, nis: '1001', code: 'SALAH1' } });
  assert.equal(bad.status, 403);
  assert.equal((await join(s, exam, '1003')).status, 403);                  // siswa kelas lain
  const first = (await join(s, exam, '1001')).json.token;
  const second = (await join(s, exam, '1001')).json.token;                  // login dari perangkat lain
  assert.equal((await s.call('/api/ujian/me', { token: first })).status, 401);
  assert.equal((await s.call('/api/ujian/me', { token: second })).status, 200);
  await s.call('/api/ujian/submit', { method: 'POST', token: second });
  assert.equal((await join(s, exam, '1001')).status, 409);                  // sudah selesai
  assert.equal((await s.call('/api/ujian/me')).status, 401);
  const future = await makeExam(s, { title: 'Nanti', starts_at: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal((await join(s, future.exam, '1002')).status, 403);
  const closed = await makeExam(s, { title: 'Tutup', starts_at: new Date(Date.now() - 7200_000).toISOString(), ends_at: new Date(Date.now() - 3600_000).toISOString() });
  assert.equal((await join(s, closed.exam, '1002')).status, 403);
  s.close();
});

test('mode aman: ujian wajib mode aman menolak browser biasa', async () => {
  const s = await setup();
  const { exam } = await makeExam(s, { require_safe_mode: true });
  const body = { token: exam.token, nis: '1001', code: s.code('1001') };
  assert.equal((await s.call('/api/ujian/join', { method: 'POST', body })).status, 403);
  assert.equal((await s.call('/api/ujian/join', { method: 'POST', body, headers: { 'x-safe-mode': '1' } })).status, 200);
  s.close();
});

test('waktu habis: sesi diakhiri otomatis dan jawaban terlambat ditolak', async () => {
  const s = await setup();
  const { exam, ids } = await makeExam(s);
  const tok = (await join(s, exam, '1001')).json.token;
  await s.call('/api/ujian/answer', { method: 'PUT', token: tok, body: { question_id: ids[1], response: 'true' } });
  s.db.prepare("UPDATE exam_sessions SET started_at=? ").run(new Date(Date.now() - 31 * 60_000).toISOString());
  const late = await s.call('/api/ujian/answer', { method: 'PUT', token: tok, body: { question_id: ids[0], response: '1' } });
  assert.equal(late.status, 403);
  assert.equal(late.json.finished, true);
  const row = s.db.prepare('SELECT submit_reason, submitted_at FROM exam_sessions').get();
  assert.equal(row.submit_reason, 'waktu habis');
  assert.ok(row.submitted_at);
  assert.equal(s.db.prepare('SELECT score FROM answers WHERE question_id=?').get(ids[1]).score, 1);  // jawaban sebelum habis tetap dihitung
  s.close();
});

test('pelanggaran: dihitung, dan melewati batas mengunci serta mengumpulkan otomatis', async () => {
  const s = await setup();
  const { exam, ids } = await makeExam(s, { max_violations: 2 });
  const tok = (await join(s, exam, '1001')).json.token;
  await s.call('/api/ujian/answer', { method: 'PUT', token: tok, body: { question_id: ids[0], response: '1' } });
  const v1 = await s.call('/api/ujian/violation', { method: 'POST', token: tok, body: { kind: 'pindah_tab' } });
  assert.deepEqual([v1.json.violations, v1.json.locked], [1, false]);
  assert.equal((await s.call('/api/ujian/violation', { method: 'POST', token: tok, body: { kind: 'bukan_jenis' } })).status, 400);
  const v2 = await s.call('/api/ujian/violation', { method: 'POST', token: tok, body: { kind: 'keluar_fullscreen' } });
  assert.equal(v2.json.locked, true);
  const row = (await s.call(`/api/exams/${exam.id}/monitor`, { token: s.t.g1 })).json.rows.find((r) => r.name === 'Citra');
  assert.equal(row.status, 'selesai');
  assert.equal(row.violations, 2);
  assert.equal(row.submit_reason, 'pelanggaran melebihi batas');
  assert.equal((await s.call('/api/ujian/answer', { method: 'PUT', token: tok, body: { question_id: ids[1], response: 'true' } })).status, 409);
  s.close();
});

test('hak akses ujian: guru lain tidak melihat, kepsek hanya membaca, ujian terkunci setelah dimulai', async () => {
  const s = await setup();
  const { exam, ids } = await makeExam(s);
  assert.equal((await s.call(`/api/exams/${exam.id}`, { token: s.t.g2 })).status, 404);
  assert.equal((await s.call(`/api/exams/${exam.id}/monitor`, { token: s.t.g2 })).status, 404);
  assert.equal((await s.call(`/api/exams/${exam.id}`, { token: s.t.kepsek })).status, 200);
  assert.equal((await s.call(`/api/exams/${exam.id}/grading`, { token: s.t.kepsek })).status, 403);
  assert.equal((await s.call('/api/exams', { token: s.t.g2 })).json.length, 0);
  assert.equal((await s.call('/api/questions', { method: 'POST', token: s.t.kepsek, body: Q.bs })).status, 403);
  // guru lain tak boleh memakai soal milik guru1
  const steal = await s.call('/api/exams', { method: 'POST', token: s.t.g2, body: { title: 'Curi', subject_id: s.subj, question_ids: ids } });
  assert.equal(steal.status, 400);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM exams WHERE title='Curi'").get().n, 0);   // transaksi dibatalkan
  await join(s, exam, '1001');
  const put = await s.call(`/api/exams/${exam.id}`, { method: 'PUT', token: s.t.g1, body: { title: 'Ubah', subject_id: s.subj, question_ids: ids } });
  assert.equal(put.status, 409);
  assert.equal((await s.call(`/api/exams/${exam.id}`, { method: 'DELETE', token: s.t.g1 })).status, 409);
  assert.equal((await s.call(`/api/questions/${ids[0]}`, { method: 'PUT', token: s.t.g1, body: { ...Q.pg, body: 'ubah' } })).status, 409);
  s.close();
});

test('SSE: dasbor guru menerima pembaruan saat siswa menjawab', async () => {
  const s = await setup();
  const { exam, ids } = await makeExam(s);
  const port = s.server.address().port;
  const ctrl = new AbortController();
  const res = await fetch(`http://localhost:${port}/api/exams/${exam.id}/stream`, { headers: { authorization: `Bearer ${s.t.g1}` }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const events = [];
  const pump = (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const chunk of parts) if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)));
      }
    } catch { /* dibatalkan */ }
  })();
  const waitFor = async (pred) => { for (let i = 0; i < 100 && !events.some(pred); i++) await new Promise((r) => setTimeout(r, 20)); return events.find(pred); };
  assert.ok(await waitFor((e) => e.type === 'hello'));
  const tok = (await join(s, exam, '1001')).json.token;
  await s.call('/api/ujian/answer', { method: 'PUT', token: tok, body: { question_id: ids[0], response: '1' } });
  const ev = await waitFor((e) => e.type === 'session' && e.session.answered === 1);
  assert.ok(ev, 'pembaruan jawaban harus tiba lewat SSE');
  assert.equal(ev.session.name, 'Citra');
  assert.equal((await s.call(`/api/exams/${exam.id}/stream`, { token: s.t.g2 })).status, 404);   // guru lain ditolak
  ctrl.abort();
  await pump;
  s.server.closeAllConnections();
  s.close();
});

test('cetak Word: paket A/B, kunci, per siswa, dan hak akses', async () => {
  const s = await setup();
  const { exam } = await makeExam(s);
  for (const qs of ['', '?paket=B&kunci=1', '?per_siswa=1&kolom=2']) {
    const r = await s.call(`/api/exams/${exam.id}/print.docx${qs}`, { token: s.t.g1, raw: true });
    assert.equal(r.status, 200, qs);
    assert.match(r.headers.get('content-type'), /wordprocessingml/);
    assert.equal(Buffer.from(await r.arrayBuffer()).slice(0, 2).toString(), 'PK');
  }
  assert.equal((await s.call(`/api/exams/${exam.id}/print.docx`, { token: s.t.g2, raw: true })).status, 404);
  assert.equal((await s.call(`/api/exams/${exam.id}/print.docx?paket=Z`, { token: s.t.g1, raw: true })).status, 400);
  const r = await s.call(`/api/exams/${exam.id}/results.xlsx`, { token: s.t.g1, raw: true });
  assert.equal(r.status, 200);
  s.close();
});
