import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { api, download, streamEvents } from './api.js';

const kindLabel = { harian: 'Ulangan harian', uts: 'UTS', uas: 'UAS' };
const toIso = (v) => (v ? new Date(v).toISOString() : null);

function Monitor({ exam, onBack }) {
  const [rows, setRows] = useState([]);
  const [live, setLive] = useState(false);
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const m = await api(`/exams/${exam.id}/monitor`);
    setInfo(m.exam);
    setRows(m.rows);
  }, [exam.id]);

  useEffect(() => {
    const ctrl = new AbortController();
    load().catch((e) => setErr(e.message));
    // Pembaruan langsung dari server; bila terputus, muat ulang berkala sebagai cadangan
    streamEvents(`/exams/${exam.id}/stream`, (ev) => {
      if (ev.type === 'hello') setLive(true);
      if (ev.type === 'session') setRows((rs) => rs.map((r) => (r.student_id === ev.session.student_id ? ev.session : r)).concat(rs.some((r) => r.student_id === ev.session.student_id) ? [] : [ev.session]));
    }, ctrl.signal).catch(() => setLive(false));
    const id = setInterval(() => load().catch(() => {}), 30000);
    return () => { ctrl.abort(); clearInterval(id); };
  }, [exam.id, load]);

  const tag = (r) => (r.status === 'selesai' ? <span className="tag ok">selesai{r.submit_reason && r.submit_reason !== 'dikumpulkan siswa' ? ` (${r.submit_reason})` : ''}</span> : r.status === 'mengerjakan' ? <span className="tag run">mengerjakan</span> : <span className="tag">belum</span>);
  const done = rows.filter((r) => r.status === 'selesai').length;

  return (
    <section className="panel">
      <div className="inline"><button className="secondary" onClick={onBack}>← Kembali</button><h2>{exam.title}</h2><span className={`tag ${live ? 'ok' : 'bad'}`}>{live ? '● langsung' : 'terputus'}</span></div>
      {info && <p>Token ujian: <span className="big">{info.token}</span><br /><small>Siswa membuka <b>{location.origin}/#/ujian</b>, memasukkan token, NIS, dan kode siswa.</small></p>}
      <p>{done} / {rows.length} siswa selesai</p>
      {err && <p className="err">{err}</p>}
      <table>
        <thead><tr><th>Nama</th><th>Status</th><th>Progres</th><th>Pelanggaran</th><th>Nilai</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.student_id}>
              <td>{r.name}</td><td>{tag(r)}</td>
              <td><div className="bar"><i style={{ width: `${r.total_questions ? (100 * r.answered) / r.total_questions : 0}%` }} /></div><small>{r.status === 'belum' ? '-' : `${r.answered}/${r.total_questions}`}</small></td>
              <td className={r.violations ? 'flag' : ''}>{r.violations}</td>
              <td>{r.score ?? (r.pending_grade ? `menunggu koreksi (${r.pending_grade})` : '-')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Grading({ exam, onBack }) {
  const [items, setItems] = useState([]);
  const [vals, setVals] = useState({});
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api(`/exams/${exam.id}/grading`).then(setItems).catch((e) => setMsg(e.message)), [exam.id]);
  useEffect(() => { load(); }, [load]);

  const save = async (it) => {
    const key = `${it.session_id}-${it.question_id}`;
    const score = Number(vals[key] ?? it.score);
    try {
      await api(`/exams/${exam.id}/grade`, { method: 'PUT', body: { session_id: it.session_id, question_id: it.question_id, score } });
      setMsg(`Tersimpan: ${it.student_name}`);
      load();
    } catch (e) { setMsg(e.message); }
  };
  const pending = items.filter((i) => i.score == null).length;

  return (
    <section className="panel">
      <div className="inline"><button className="secondary" onClick={onBack}>← Kembali</button><h2>Koreksi uraian — {exam.title}</h2></div>
      <p>{pending} jawaban menunggu koreksi. Setelah semua dikoreksi, nilai siswa otomatis masuk rapor.</p>
      {msg && <p className="msg">{msg}</p>}
      {items.map((it) => {
        const key = `${it.session_id}-${it.question_id}`;
        return (
          <div key={key} className="gradecard">
            <b>{it.student_name}</b> <span className={`tag ${it.score == null ? 'bad' : 'ok'}`}>{it.score == null ? 'belum dinilai' : 'dinilai'}</span>
            <p className="small">Soal: {it.body}</p>
            {it.rubric && <p className="small">Rubrik: {it.rubric}</p>}
            <p className="answer">{it.response}</p>
            <div className="inline">
              <label>Skor (maks {it.points}) <input type="number" min="0" max={it.points} step="0.5" style={{ width: 80 }} value={vals[key] ?? it.score ?? ''} onChange={(e) => setVals({ ...vals, [key]: e.target.value })} /></label>
              <button onClick={() => save(it)}>Simpan</button>
            </div>
          </div>
        );
      })}
      {items.length === 0 && <p>Belum ada jawaban uraian yang dikumpulkan.</p>}
    </section>
  );
}

function PrintPanel({ exam, onBack }) {
  const [o, setO] = useState({ paket: 'A', kunci: '0', per_siswa: '0', kolom: '1' });
  const [err, setErr] = useState('');
  const go = () => download(`/exams/${exam.id}/print.docx?${new URLSearchParams(o)}`, `soal-${exam.id}-paket-${o.paket}.docx`).catch((e) => setErr(e.message));
  return (
    <section className="panel">
      <div className="inline"><button className="secondary" onClick={onBack}>← Kembali</button><h2>Cetak soal ke Word — {exam.title}</h2></div>
      <p>Hasil memuat kop sekolah (nama, alamat, baris kop dari Pengaturan) serta isian Nama / No. Absen / Hari-Tanggal.</p>
      <label>Paket <select value={o.paket} onChange={(e) => setO({ ...o, paket: e.target.value })}><option value="A">A (urutan asli)</option><option value="B">B (diacak)</option></select></label>
      <label>Kolom <select value={o.kolom} onChange={(e) => setO({ ...o, kolom: e.target.value })}><option value="1">1 kolom</option><option value="2">2 kolom</option></select></label>
      <label className="chk"><input type="checkbox" checked={o.kunci === '1'} onChange={(e) => setO({ ...o, kunci: e.target.checked ? '1' : '0' })} /> Sertakan halaman kunci jawaban</label>
      <label className="chk"><input type="checkbox" checked={o.per_siswa === '1'} onChange={(e) => setO({ ...o, per_siswa: e.target.checked ? '1' : '0' })} /> Satu naskah per siswa (nama terisi otomatis)</label>
      {err && <p className="err">{err}</p>}
      <button onClick={go}>Unduh .docx</button>
    </section>
  );
}

function Create({ onDone, onCancel }) {
  const [subjects, setSubjects] = useState([]);
  const [classes, setClasses] = useState([]);
  const [bank, setBank] = useState([]);
  const [picked, setPicked] = useState([]);
  const [f, setF] = useState({ title: '', subject_id: '', class_id: '', kind: 'harian', duration_min: 60, starts_at: '', ends_at: '', max_violations: 3, shuffle: true, require_safe_mode: false });
  const [err, setErr] = useState('');
  useEffect(() => { api('/subjects').then(setSubjects); api('/classes').then(setClasses); }, []);
  useEffect(() => { api(`/questions${f.subject_id ? `?subject_id=${f.subject_id}` : ''}`).then(setBank).catch(() => {}); }, [f.subject_id]);

  const total = bank.filter((q) => picked.includes(q.id)).reduce((a, q) => a + q.points, 0);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api('/exams', { method: 'POST', body: {
        title: f.title, subject_id: Number(f.subject_id), class_id: f.class_id ? Number(f.class_id) : null, kind: f.kind,
        duration_min: Number(f.duration_min), starts_at: toIso(f.starts_at), ends_at: toIso(f.ends_at),
        max_violations: Number(f.max_violations), shuffle: f.shuffle, require_safe_mode: f.require_safe_mode, question_ids: picked,
      } });
      onDone();
    } catch (e2) { setErr(e2.message); }
  };
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <section className="panel">
      <h2>Buat ujian</h2>
      <form onSubmit={submit} className="grid">
        <input required aria-label="Judul ujian" placeholder="Judul ujian" value={f.title} onChange={set('title')} />
        <div className="inline">
          <select required aria-label="Mata pelajaran" value={f.subject_id} onChange={set('subject_id')}><option value="">— mapel —</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select aria-label="Kelas" value={f.class_id} onChange={set('class_id')}><option value="">Semua kelas</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select aria-label="Jenis ujian" value={f.kind} onChange={set('kind')}>{Object.entries(kindLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
        <div className="inline">
          <label>Durasi (menit) <input type="number" min="1" style={{ width: 80 }} value={f.duration_min} onChange={set('duration_min')} /></label>
          <label>Buka <input type="datetime-local" value={f.starts_at} onChange={set('starts_at')} /></label>
          <label>Tutup <input type="datetime-local" value={f.ends_at} onChange={set('ends_at')} /></label>
        </div>
        <div className="inline">
          <label>Batas pelanggaran <input type="number" min="1" max="20" style={{ width: 70 }} value={f.max_violations} onChange={set('max_violations')} /></label>
          <label className="chk"><input type="checkbox" checked={f.shuffle} onChange={set('shuffle')} /> Acak soal & pilihan</label>
          <label className="chk"><input type="checkbox" checked={f.require_safe_mode} onChange={set('require_safe_mode')} /> Wajib aplikasi Ujian Aman (APK)</label>
        </div>
        <h3>Pilih soal ({picked.length} dipilih, total skor {total})</h3>
        <div className="picklist">
          {bank.map((q) => (
            <label key={q.id} className="chk"><input type="checkbox" checked={picked.includes(q.id)} onChange={() => toggle(q.id)} /> <span className="tag">{q.type}</span> {q.body.slice(0, 100)} <small>({q.points})</small></label>
          ))}
          {bank.length === 0 && <p>Belum ada soal. Tambahkan di tab Bank Soal.</p>}
        </div>
        {err && <p className="err">{err}</p>}
        <div className="inline"><button disabled={!picked.length}>Simpan ujian</button><button type="button" className="secondary" onClick={onCancel}>Batal</button></div>
      </form>
    </section>
  );
}

export default function Ujian({ role }) {
  const [list, setList] = useState([]);
  const [view, setView] = useState({ name: 'list' });
  const [err, setErr] = useState('');
  const canEdit = role !== 'kepsek';
  const load = useCallback(() => api('/exams').then(setList).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  if (view.name === 'create') return <Create onCancel={() => setView({ name: 'list' })} onDone={() => { setView({ name: 'list' }); load(); }} />;
  if (view.name === 'monitor') return <Monitor exam={view.exam} onBack={() => { setView({ name: 'list' }); load(); }} />;
  if (view.name === 'grading') return <Grading exam={view.exam} onBack={() => { setView({ name: 'list' }); load(); }} />;
  if (view.name === 'print') return <PrintPanel exam={view.exam} onBack={() => setView({ name: 'list' })} />;

  const del = async (e) => {
    if (!confirm(`Hapus ujian "${e.title}"?`)) return;
    try { await api(`/exams/${e.id}`, { method: 'DELETE' }); load(); } catch (x) { setErr(x.message); }
  };
  return (
    <section className="panel">
      <div className="inline"><h2><ClipboardCheck size={20} /> Ujian</h2>{canEdit && <button onClick={() => setView({ name: 'create' })}>+ Buat ujian</button>}</div>
      {err && <p className="err">{err}</p>}
      {list.length === 0 && <p>Belum ada ujian.</p>}
      {list.map((e) => (
        <div key={e.id} className="gradecard">
          <b>{e.title}</b> <span className="tag">{kindLabel[e.kind]}</span> <small>{e.subject_name} · {e.class_name ?? 'semua kelas'} · {e.question_count} soal · {e.duration_min} menit · {e.session_count} siswa mulai</small>
          <div>Token: <b className="mono">{e.token}</b></div>
          <div className="inline">
            <button onClick={() => setView({ name: 'monitor', exam: e })}>Pantau</button>
            {canEdit && <button onClick={() => setView({ name: 'grading', exam: e })}>Koreksi</button>}
            {canEdit && <button className="secondary" onClick={() => setView({ name: 'print', exam: e })}>Cetak Word</button>}
            <button className="secondary" onClick={() => download(`/exams/${e.id}/results.xlsx`, `hasil-${e.id}.xlsx`).catch((x) => setErr(x.message))}>Hasil Excel</button>
            {canEdit && !e.session_count && <button className="secondary" onClick={() => del(e)}>Hapus</button>}
          </div>
        </div>
      ))}
    </section>
  );
}
