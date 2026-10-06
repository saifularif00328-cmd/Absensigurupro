import { useCallback, useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { api, download } from './api.js';

function RaporPrint({ studentId, term, onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => { api(`/reports/rapor/${studentId}?term=${encodeURIComponent(term)}`).then(setD); }, [studentId, term]);
  if (!d) return null;
  const kop = (() => { try { return JSON.parse(d.school?.kop_lines || '[]'); } catch { return []; } })();
  return (
    <div className="modal light">
      <div className="printarea">
        {kop.map((k) => <p key={k} className="center"><b>{k}</b></p>)}
        <h2 className="center">{(d.school?.name ?? '').toUpperCase()}</h2>
        <p className="center">{d.school?.address}</p>
        <hr />
        <h3 className="center">LAPORAN HASIL BELAJAR</h3>
        <p>Nama: <b>{d.student.name}</b> &nbsp; NIS: {d.student.nis} &nbsp; Kelas: {d.student.class_name}<br />Semester: {d.term}</p>
        <table>
          <thead><tr><th>Mata Pelajaran</th><th>Harian</th><th>UTS</th><th>UAS</th><th>Nilai Akhir</th></tr></thead>
          <tbody>{d.subjects.map((s) => <tr key={s.subject_id}><td>{s.subject}</td><td>{s.harian ?? '-'}</td><td>{s.uts ?? '-'}</td><td>{s.uas ?? '-'}</td><td><b>{s.final ?? '-'}</b></td></tr>)}</tbody>
        </table>
        <p>Rata-rata: <b>{d.average ?? '-'}</b></p>
        <p>Ketidakhadiran — Sakit: {d.absence.sakit} · Izin: {d.absence.izin} · Tanpa keterangan: {d.absence.alpa}</p>
        <div className="noprint inline"><button onClick={() => window.print()}>Cetak</button><button className="secondary" onClick={onClose}>Tutup</button></div>
      </div>
    </div>
  );
}

export default function Nilai({ user }) {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [term, setTerm] = useState('');
  const [data, setData] = useState(null);
  const [print, setPrint] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { api('/classes').then(setClasses).catch((e) => setErr(e.message)); }, []);
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ ...(classId && { class_id: classId }), ...(term && { term }) });
      setData(await api(`/reports/rapor?${q}`));
    } catch (e) { setErr(e.message); }
  }, [classId, term]);
  useEffect(() => { load(); }, [load]);

  const subjects = [...new Set((data?.rows ?? []).flatMap((r) => r.subjects.map((s) => s.subject)))];
  const saveAbsence = async (r, field, value) => {
    const a = { ...r.absence, [field]: Math.max(0, Number(value) || 0) };
    try { await api('/absence-summary', { method: 'PUT', body: { student_id: r.student.id, term: data.term, ...a } }); setMsg('Rekap ketidakhadiran disimpan'); load(); } catch (e) { setErr(e.message); setMsg(''); }
  };
  const q = new URLSearchParams({ ...(classId && { class_id: classId }), ...(term && { term }) });

  return (
    <section className="panel">
      <h2><GraduationCap size={20} /> Nilai & rapor {data ? `— ${data.term}` : ''}</h2>
      <div className="inline">
        <select aria-label="Kelas" value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Semua kelas</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input aria-label="Semester" placeholder="Semester (kosong = berjalan)" value={term} onChange={(e) => setTerm(e.target.value)} />
        <button className="secondary" onClick={() => download(`/reports/rapor.xlsx?${q}`, 'nilai.xlsx').catch((e) => setErr(e.message))}>Unduh Excel</button>
      </div>
      <p className="small">Nilai ujian masuk otomatis setelah siswa selesai dan uraian dikoreksi. Nilai akhir = rata-rata tiap jenis × bobot mapel.</p>
      {err && <p className="err">{err}</p>}
      {msg && <p className="msg">{msg}</p>}
      <div className="scroll">
        <table>
          <thead><tr><th>Nama</th>{subjects.map((s) => <th key={s}>{s}</th>)}<th>Rata²</th><th>S</th><th>I</th><th>A</th><th /></tr></thead>
          <tbody>
            {(data?.rows ?? []).map((r) => {
              const by = new Map(r.subjects.map((s) => [s.subject, s.final]));
              return (
                <tr key={r.student.id}>
                  <td>{r.student.name}</td>
                  {subjects.map((s) => <td key={s}>{by.get(s) ?? '-'}</td>)}
                  <td><b>{r.average ?? '-'}</b></td>
                  {['sakit', 'izin', 'alpa'].map((f) => (
                    <td key={f}><input type="number" min="0" style={{ width: 52 }} aria-label={`${{ sakit: 'Sakit', izin: 'Izin', alpa: 'Alpa' }[f]} ${r.student.name}`} defaultValue={r.absence[f]} disabled={user.role === 'kepsek'} onBlur={(e) => Number(e.target.value) !== r.absence[f] && saveAbsence(r, f, e.target.value)} /></td>
                  ))}
                  <td><button className="secondary" onClick={() => setPrint(r.student.id)}>Rapor</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {print && <RaporPrint studentId={print} term={data.term} onClose={() => setPrint(null)} />}
    </section>
  );
}
