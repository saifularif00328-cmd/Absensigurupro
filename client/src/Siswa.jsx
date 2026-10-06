import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';

const SKEY = 'siswa_token';
const fmtClock = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

function JoinForm({ onJoined }) {
  const [f, setF] = useState({ token: '', nis: '', code: '' });
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/ujian/join', { method: 'POST', body: { token: f.token.trim(), nis: f.nis.trim(), code: f.code.trim() }, token: null });
      sessionStorage.setItem(SKEY, r.token);
      onJoined(r.token);
    } catch (e2) { setErr(e2.message); }
  };
  return (
    <form className="card" onSubmit={submit}>
      <h1>Masuk Ujian</h1>
      <input placeholder="Token ujian" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value.toUpperCase() })} autoCapitalize="characters" />
      <input placeholder="NIS" value={f.nis} onChange={(e) => setF({ ...f, nis: e.target.value })} inputMode="numeric" />
      <input placeholder="Kode siswa" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} autoCapitalize="characters" />
      {err && <p className="err">{err}</p>}
      <button>Masuk</button>
      <small>Token dari guru, kode siswa dari wali kelas/admin.</small>
    </form>
  );
}

function Exam({ token, data, onFinished }) {
  const [answers, setAnswers] = useState(data.answers ?? {});
  const [idx, setIdx] = useState(0);
  const [started, setStarted] = useState(false);
  const [warn, setWarn] = useState('');
  const [violations, setViolations] = useState(data.violations);
  const [saveState, setSaveState] = useState('tersimpan');
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState(false);
  const skew = useRef(new Date(data.server_time).getTime() - Date.now());
  const deadline = new Date(data.deadline).getTime();
  const unsent = useRef(new Map());           // question_id -> response yang belum terkirim
  const finishing = useRef(false);
  const q = data.questions[idx];
  const fsSupported = !!document.documentElement.requestFullscreen;

  const finish = useCallback((reason) => { if (!finishing.current) { finishing.current = true; onFinished(reason); } }, [onFinished]);

  const flush = useCallback(async () => {
    for (const [qid, response] of [...unsent.current]) {
      try {
        await api('/ujian/answer', { method: 'PUT', token, body: { question_id: qid, response } });
        if (unsent.current.get(qid) === response) unsent.current.delete(qid);
      } catch (e) {
        if (e.status === 403 || e.status === 409) return finish('Waktu habis atau ujian sudah dikumpulkan');
        if (e.status === 401) return finish('Sesi dipakai di perangkat lain');
        return setSaveState('menunggu jaringan…');
      }
    }
    if (!unsent.current.size) setSaveState('tersimpan');
  }, [token, finish]);

  useEffect(() => { const id = setInterval(flush, 4000); return () => clearInterval(id); }, [flush]);

  const answer = (qid, response) => {
    setAnswers((a) => ({ ...a, [qid]: response }));
    unsent.current.set(qid, response);
    setSaveState('menyimpan…');
    flush();
  };

  const submit = useCallback(async () => {
    await flush();
    try { await api('/ujian/submit', { method: 'POST', token }); } catch { /* sudah selesai */ }
    finish('Jawaban Anda sudah dikumpulkan');
  }, [flush, token, finish]);

  // Timer berbasis jam server
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + skew.current), 500);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { if (now >= deadline && !finishing.current) submit(); }, [now, deadline, submit]);

  // Anti-curang level web: deteksi, catat, dan kunci bila melewati batas
  const report = useCallback(async (kind, text) => {
    if (finishing.current) return;
    setWarn(text);
    try {
      const r = await api('/ujian/violation', { method: 'POST', token, body: { kind } });
      setViolations(r.violations ?? 0);
      if (r.locked) finish('Ujian dikunci karena pelanggaran melebihi batas');
    } catch (e) {
      if (e.status === 401 || e.status === 403) finish('Sesi ujian berakhir');
    }
  }, [token, finish]);

  useEffect(() => {
    if (!started) return undefined;
    let lastHidden = 0;
    const hidden = () => {
      if (document.hidden && Date.now() - lastHidden > 1500) { lastHidden = Date.now(); report('pindah_tab', 'Anda meninggalkan halaman ujian. Pelanggaran dicatat.'); }
    };
    const blur = () => { if (Date.now() - lastHidden > 1500) { lastHidden = Date.now(); report('pindah_tab', 'Fokus jendela hilang (aplikasi lain / split screen). Pelanggaran dicatat.'); } };
    const fs = () => { if (fsSupported && !document.fullscreenElement) report('keluar_fullscreen', 'Anda keluar dari layar penuh. Pelanggaran dicatat.'); };
    const block = (kind) => (e) => { e.preventDefault(); if (kind) report('salin_tempel', 'Salin/tempel dinonaktifkan selama ujian.'); };
    const leave = (e) => { e.preventDefault(); e.returnValue = ''; };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', blur);
    document.addEventListener('fullscreenchange', fs);
    const handlers = { copy: block(true), cut: block(true), paste: block(true), contextmenu: block(false), dragstart: block(false) };
    Object.entries(handlers).forEach(([k, h]) => document.addEventListener(k, h));
    window.addEventListener('beforeunload', leave);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blur);
      document.removeEventListener('fullscreenchange', fs);
      Object.entries(handlers).forEach(([k, h]) => document.removeEventListener(k, h));
      window.removeEventListener('beforeunload', leave);
    };
  }, [started, report, fsSupported]);

  const start = async () => {
    try { if (fsSupported) await document.documentElement.requestFullscreen(); } catch { /* ditolak browser */ }
    setStarted(true);
  };

  const answeredCount = useMemo(() => data.questions.filter((x) => answers[x.id] != null && answers[x.id] !== '').length, [answers, data.questions]);

  if (!started) {
    return (
      <div className="card">
        <h1>{data.exam.title}</h1>
        <p>Halo, <b>{data.student}</b>. Waktu {data.exam.duration_min} menit, {data.questions.length} soal.</p>
        <ul className="rules">
          <li>Ujian berjalan dalam layar penuh. Jangan berpindah aplikasi/tab atau membuka split screen.</li>
          <li>Setiap pelanggaran dicatat guru. Batas {data.exam.max_violations}x; setelah itu ujian dikunci dan dikumpulkan otomatis.</li>
          <li>Salin dan tempel dinonaktifkan. Jawaban tersimpan otomatis.</li>
        </ul>
        {violations > 0 && <p className="warn">Pelanggaran sebelumnya: {violations}</p>}
        <button onClick={start}>Mulai / Lanjutkan</button>
      </div>
    );
  }

  const remaining = deadline - now;
  return (
    <div className="exam" onCopy={(e) => e.preventDefault()}>
      {fsSupported && !document.fullscreenElement && (
        <div className="modal"><p>Kembali ke layar penuh untuk melanjutkan.</p><button onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>Layar penuh</button></div>
      )}
      <header className="exam-top">
        <b>{data.exam.title}</b>
        <span className={remaining < 60000 ? 'timer low' : 'timer'}>{fmtClock(remaining)}</span>
        <span className="small">{saveState} · {answeredCount}/{data.questions.length}</span>
      </header>
      {warn && <p className="warnbar" onClick={() => setWarn('')}>{warn} (Pelanggaran: {violations}/{data.exam.max_violations})</p>}

      <main className="qbox">
        <p className="qno">Soal {idx + 1} dari {data.questions.length}</p>
        <p className="qbody">{q.body}</p>
        {q.type === 'pg' && q.options.map((o, i) => (
          <label key={o.idx} className="opt"><input type="radio" name={`q${q.id}`} checked={String(answers[q.id]) === String(o.idx)} onChange={() => answer(q.id, String(o.idx))} /> <b>{'ABCDEF'[i]}.</b> {o.text}</label>
        ))}
        {q.type === 'bs' && ['true', 'false'].map((v) => (
          <label key={v} className="opt"><input type="radio" name={`q${q.id}`} checked={answers[q.id] === v} onChange={() => answer(q.id, v)} /> {v === 'true' ? 'Benar' : 'Salah'}</label>
        ))}
        {q.type === 'isian' && <input className="wide" value={answers[q.id] ?? ''} onChange={(e) => answer(q.id, e.target.value)} placeholder="Jawaban singkat" />}
        {q.type === 'uraian' && <textarea className="wide" rows={8} value={answers[q.id] ?? ''} onChange={(e) => answer(q.id, e.target.value)} placeholder="Tulis jawaban Anda" />}
      </main>

      <nav className="qnav">
        {data.questions.map((x, i) => (
          <button key={x.id} className={`${i === idx ? 'cur' : ''} ${answers[x.id] != null && answers[x.id] !== '' ? 'done' : ''}`} onClick={() => setIdx(i)}>{i + 1}</button>
        ))}
      </nav>
      <div className="row">
        <button className="secondary" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Sebelumnya</button>
        {idx < data.questions.length - 1 ? <button onClick={() => setIdx(idx + 1)}>Berikutnya</button> : <button onClick={() => setConfirm(true)}>Kumpulkan</button>}
      </div>
      {confirm && (
        <div className="modal">
          <p>{answeredCount < data.questions.length ? `Masih ${data.questions.length - answeredCount} soal belum dijawab. ` : ''}Kumpulkan sekarang? Jawaban tidak bisa diubah lagi.</p>
          <div className="row"><button onClick={submit}>Ya, kumpulkan</button><button className="secondary" onClick={() => setConfirm(false)}>Kembali</button></div>
        </div>
      )}
    </div>
  );
}

export default function Siswa() {
  const [token, setToken] = useState(sessionStorage.getItem(SKEY));
  const [data, setData] = useState(null);
  const [end, setEnd] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!token) return;
    api('/ujian/me', { token }).then((d) => (d.finished ? setEnd('Ujian ini sudah selesai.') : setData(d))).catch((e) => {
      sessionStorage.removeItem(SKEY);
      setToken(null);
      setErr(e.message);
    });
  }, [token]);

  const onFinished = useCallback((msg) => {
    sessionStorage.removeItem(SKEY);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setEnd(msg);
  }, []);

  if (end) return <div className="card"><h1>Selesai</h1><p>{end}</p><p>Nilai akan diumumkan guru.</p><button onClick={() => { setEnd(''); setData(null); setToken(null); }}>Kembali</button></div>;
  if (!token) return <>{err && <p className="err center">{err}</p>}<JoinForm onJoined={setToken} /></>;
  if (!data) return <div className="card">Memuat soal…</div>;
  return <Exam token={token} data={data} onFinished={onFinished} />;
}
