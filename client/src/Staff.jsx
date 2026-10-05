import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, download } from './api.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);

function QrPanel() {
  const [img, setImg] = useState('');
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const { token } = await api('/qr');
      const url = await QRCode.toDataURL(token, { width: 280 });
      if (alive) setImg(url);
    };
    tick();
    const id = setInterval(tick, 30000); // token berganti tiap menit
    return () => { alive = false; clearInterval(id); };
  }, []);
  return <section className="panel"><h2>QR absensi (berganti otomatis)</h2>{img && <img src={img} alt="QR absensi" />}</section>;
}

export default function Staff({ user }) {
  const [dash, setDash] = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [month, setMonth] = useState(thisMonth());
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try { setDash(await api('/dashboard/today')); setLeaves(await api('/leaves')); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);

  const decide = async (id, decision) => { try { await api(`/leaves/${id}`, { method: 'PATCH', body: { decision } }); load(); } catch (e) { setErr(e.message); } };

  return (
    <>
      {err && <p className="err">{err}</p>}
      <section className="panel">
        <h2>Kehadiran hari ini ({dash?.date})</h2>
        {dash && (
          <>
            <p>{Object.entries(dash.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')} · belum absen: {dash.belum_absen.length} / {dash.total_guru}</p>
            {dash.belum_absen.length > 0 && <p>Belum absen: {dash.belum_absen.map((g) => g.full_name).join(', ')}</p>}
          </>
        )}
      </section>
      <section className="panel">
        <h2>Pengajuan izin</h2>
        <ul>
          {leaves.map((l) => (
            <li key={l.id}>
              {l.full_name}: {l.type} {l.start_date} s.d. {l.end_date} ({l.reason || '-'}) — <b>{l.status}</b>
              {l.status === 'pending' && <> <button onClick={() => decide(l.id, 'approved')}>Setujui</button> <button onClick={() => decide(l.id, 'rejected')}>Tolak</button></>}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Rekap bulanan</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button onClick={() => download(`/reports/attendance.xlsx?month=${month}`, `rekap-guru-${month}.xlsx`).catch((e) => setErr(e.message))}>Unduh Excel</button>
      </section>
      {user.role !== 'guru' && <QrPanel />}
    </>
  );
}
