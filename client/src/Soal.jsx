import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const TYPES = { pg: 'Pilihan ganda', bs: 'Benar/Salah', isian: 'Isian singkat', uraian: 'Uraian' };
const blank = () => ({ id: null, type: 'pg', body: '', options: ['', '', '', ''], answer: 0, bs: true, answers: '', rubric: '', points: 1, subject_id: '' });

function toPayload(f) {
  const base = { type: f.type, body: f.body, points: Number(f.points), subject_id: f.subject_id ? Number(f.subject_id) : null };
  if (f.type === 'pg') return { ...base, options: f.options.filter((o) => o.trim()), answer: Number(f.answer) };
  if (f.type === 'bs') return { ...base, answer: !!f.bs };
  if (f.type === 'isian') return { ...base, answers: f.answers.split('\n').map((x) => x.trim()).filter(Boolean) };
  return { ...base, rubric: f.rubric };
}

function fromQuestion(q) {
  return {
    id: q.id, type: q.type, body: q.body, points: q.points, subject_id: q.subject_id ?? '',
    options: q.type === 'pg' ? q.options : ['', '', '', ''], answer: q.type === 'pg' ? q.answer_key : 0,
    bs: q.type === 'bs' ? q.answer_key : true, answers: q.type === 'isian' ? q.answer_key.join('\n') : '', rubric: q.type === 'uraian' ? q.answer_key : '',
  };
}

export default function Soal({ readOnly = false }) {
  const [list, setList] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [f, setF] = useState(blank());
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      setSubjects(await api('/subjects'));
      setList(await api(`/questions${filter ? `?subject_id=${filter}` : ''}`));
    } catch (e) { setErr(e.message); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault(); setErr(''); setMsg('');
    try {
      await api(f.id ? `/questions/${f.id}` : '/questions', { method: f.id ? 'PUT' : 'POST', body: toPayload(f) });
      setMsg(f.id ? 'Soal diperbarui' : 'Soal ditambahkan');
      setF({ ...blank(), subject_id: f.subject_id, type: f.type });
      load();
    } catch (e2) { setErr(e2.message); }
  };
  const del = async (id) => {
    if (!confirm('Hapus soal ini?')) return;
    try { await api(`/questions/${id}`, { method: 'DELETE' }); load(); } catch (e) { setErr(e.message); }
  };
  const setOpt = (i, v) => setF({ ...f, options: f.options.map((o, j) => (j === i ? v : o)) });

  return (
    <>
      {err && <p className="err">{err}</p>}
      {msg && <p className="msg">{msg}</p>}
      {!readOnly && (
        <section className="panel">
          <h2>{f.id ? `Ubah soal #${f.id}` : 'Tambah soal'}</h2>
          <form onSubmit={save} className="grid">
            <div className="inline">
              <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, points: e.target.value === 'uraian' ? 5 : 1 })} disabled={!!f.id}>
                {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}>
                <option value="">— mapel —</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <label>Skor <input type="number" min="0.5" step="0.5" style={{ width: 70 }} value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} /></label>
            </div>
            <textarea required rows={3} placeholder="Teks soal" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
            {f.type === 'pg' && (
              <>
                {f.options.map((o, i) => (
                  <label key={i} className="inline">
                    <input type="radio" name="kunci" checked={Number(f.answer) === i} onChange={() => setF({ ...f, answer: i })} title="Kunci jawaban" />
                    <b>{'ABCDEF'[i]}.</b> <input style={{ flex: 1 }} placeholder={`Pilihan ${'ABCDEF'[i]}`} value={o} onChange={(e) => setOpt(i, e.target.value)} />
                  </label>
                ))}
                <div className="inline">
                  {f.options.length < 6 && <button type="button" className="secondary" onClick={() => setF({ ...f, options: [...f.options, ''] })}>+ Pilihan</button>}
                  <small>Pilih bulat di sebelah jawaban yang benar.</small>
                </div>
              </>
            )}
            {f.type === 'bs' && (
              <div className="inline">
                <label className="chk"><input type="radio" checked={f.bs} onChange={() => setF({ ...f, bs: true })} /> Kunci: Benar</label>
                <label className="chk"><input type="radio" checked={!f.bs} onChange={() => setF({ ...f, bs: false })} /> Kunci: Salah</label>
              </div>
            )}
            {f.type === 'isian' && <textarea required rows={3} placeholder="Jawaban yang diterima, satu per baris (huruf besar/kecil diabaikan)" value={f.answers} onChange={(e) => setF({ ...f, answers: e.target.value })} />}
            {f.type === 'uraian' && <textarea rows={3} placeholder="Rubrik/pedoman penilaian (hanya terlihat guru)" value={f.rubric} onChange={(e) => setF({ ...f, rubric: e.target.value })} />}
            <div className="inline">
              <button>{f.id ? 'Simpan perubahan' : 'Tambah soal'}</button>
              {f.id && <button type="button" className="secondary" onClick={() => setF(blank())}>Batal</button>}
            </div>
          </form>
        </section>
      )}
      <section className="panel">
        <h2>Bank soal ({list.length})</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Semua mapel</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <table>
          <tbody>
            {list.map((q) => (
              <tr key={q.id}>
                <td><span className="tag">{TYPES[q.type]}</span></td>
                <td>{q.body.length > 90 ? `${q.body.slice(0, 90)}…` : q.body}</td>
                <td>{q.points}</td>
                {!readOnly && <td className="nowrap"><button className="secondary" onClick={() => { setF(fromQuestion(q)); window.scrollTo(0, 0); }}>Ubah</button> <button className="secondary" onClick={() => del(q.id)}>Hapus</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
