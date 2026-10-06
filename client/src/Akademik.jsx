import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export default function Akademik() {
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [students, setStudents] = useState([]);
  const [className, setClassName] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [csv, setCsv] = useState('');
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      setClasses(await api('/classes'));
      setSubjects(await api('/subjects'));
      setStudents(await api(`/students${filter ? `?class_id=${filter}` : ''}`));
    } catch (e) { setErr(e.message); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setErr(''); setMsg('');
    try { await fn(); if (ok) setMsg(ok); load(); } catch (e) { setErr(e.message); }
  };

  const importCsv = () => run(async () => {
    const r = await api('/students/import', { method: 'POST', body: { csv } });
    setMsg(`Impor selesai: ${r.created} baru, ${r.updated} diperbarui${r.errors.length ? `, ${r.errors.length} baris ditolak (baris ${r.errors.map((x) => x.line).join(', ')})` : ''}`);
    setCsv('');
  });

  const saveWeights = (s, w) => run(() => api(`/subjects/${s.id}/weights`, { method: 'PUT', body: w }), `Bobot ${s.name} disimpan`);

  return (
    <>
      {err && <p className="err">{err}</p>}
      {msg && <p className="msg">{msg}</p>}
      <section className="panel">
        <h2>Kelas</h2>
        <form className="inline" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/classes', { method: 'POST', body: { name: className } }); setClassName(''); }); }}>
          <input placeholder="Nama kelas, mis. 7A" required value={className} onChange={(e) => setClassName(e.target.value)} /><button>Tambah</button>
        </form>
        <p>{classes.map((c) => `${c.name} (${c.student_count})`).join(' · ') || 'Belum ada kelas.'}</p>
      </section>

      <section className="panel">
        <h2>Mata pelajaran & bobot nilai</h2>
        <form className="inline" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('/subjects', { method: 'POST', body: { name: subjectName } }); setSubjectName(''); }); }}>
          <input placeholder="Nama mapel" required value={subjectName} onChange={(e) => setSubjectName(e.target.value)} /><button>Tambah</button>
        </form>
        <table>
          <thead><tr><th>Mapel</th><th>Harian %</th><th>UTS %</th><th>UAS %</th><th /></tr></thead>
          <tbody>{subjects.map((s) => <WeightRow key={s.id} s={s} onSave={saveWeights} />)}</tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Impor siswa</h2>
        <p className="small">Satu baris per siswa: <code>NIS,Nama,Kelas</code> (dipisah koma / titik koma / tab). Kelas yang belum ada dibuat otomatis. Tempel dari Excel juga bisa.</p>
        <textarea rows={5} placeholder={'1001,Citra Dewi,7A\n1002,Dedi Pratama,7A'} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <button disabled={!csv.trim()} onClick={importCsv}>Impor</button>
      </section>

      <section className="panel">
        <h2>Siswa ({students.length})</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Semua kelas</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <table>
          <thead><tr><th>NIS</th><th>Nama</th><th>Kelas</th><th>Kode siswa</th><th /></tr></thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}><td>{s.nis}</td><td>{s.name}</td><td>{s.class_name}</td><td className="mono">{s.access_code}</td>
                <td><button className="secondary" onClick={() => run(() => api(`/students/${s.id}/reset-code`, { method: 'POST' }))}>Ganti kode</button></td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function WeightRow({ s, onSave }) {
  const [w, setW] = useState({ harian: Math.round(s.w_harian * 100), uts: Math.round(s.w_uts * 100), uas: Math.round(s.w_uas * 100) });
  const sum = w.harian + w.uts + w.uas;
  const num = (k) => (e) => setW({ ...w, [k]: Number(e.target.value) });
  return (
    <tr>
      <td>{s.name}</td>
      {['harian', 'uts', 'uas'].map((k) => <td key={k}><input type="number" min="0" max="100" style={{ width: 64 }} value={w[k]} onChange={num(k)} /></td>)}
      <td><button disabled={sum !== 100} title={sum !== 100 ? `Jumlah ${sum}%, harus 100%` : ''} onClick={() => onSave(s, { harian: w.harian / 100, uts: w.uts / 100, uas: w.uas / 100 })}>Simpan</button></td>
    </tr>
  );
}
