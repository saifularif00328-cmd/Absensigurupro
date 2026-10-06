import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { AlertTriangle, BadgeCheck, Briefcase, CalendarDays, CheckCircle2, Clock, Download, FileHeart, Plane, QrCode, UserX, XCircle } from 'lucide-react';
import { api, download, fetchImageUrl } from './api.js';
import { useTilt } from './ui/useTilt.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const FLAG_TEXT = { akurasi_mencurigakan: 'akurasi GPS mencurigakan', lokasi_loncat: 'lokasi berpindah tak wajar' };
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-');
const initials = (n) => n.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const STATUS_TAG = { hadir: 'ok', terlambat: 'bad', izin: 'run', sakit: 'run', cuti: 'run', dinas: 'run', alpa: 'bad' };

function Selfie({ id, name }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let url = '';
    fetchImageUrl(`/attendance/${id}/selfie`).then((u) => { url = u; setSrc(u); }).catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [id]);
  return src ? <img className="thumb" src={src} alt={`Selfie ${name}`} /> : <span className="avatar">{initials(name)}</span>;
}

function Tile({ icon: Icon, label, value, tone }) {
  const ref = useTilt(10);
  return (
    <div className={`stat ${tone}`} ref={ref}>
      <div className="ico"><Icon size={20} /></div>
      <div className="num">{value}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

function QrPanel() {
  const [img, setImg] = useState('');
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const { token } = await api('/qr');
      const url = await QRCode.toDataURL(token, { width: 320, margin: 1 });
      if (alive) setImg(url);
    };
    tick();
    const id = setInterval(tick, 30000); // token berganti tiap menit
    return () => { alive = false; clearInterval(id); };
  }, []);
  return (
    <section className="panel">
      <h2><QrCode size={20} /> QR absensi <span className="tag live">berganti otomatis</span></h2>
      <p className="small">Tampilkan di layar gerbang/ruang guru. Foto QR yang dititip kedaluwarsa dalam ±2 menit.</p>
      {img && <div className="qrframe"><img src={img} alt="QR absensi" /></div>}
    </section>
  );
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
  const c = dash?.counts;
  const date = dash ? new Date(dash.date + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';

  return (
    <>
      {err && <p className="err" role="alert">{err}</p>}
      <section className="panel">
        <h2><CalendarDays size={20} /> Kehadiran hari ini <small className="small">{date}</small></h2>
        {(dash?.holiday || dash?.weekend) && <p className="msg">{dash.holiday ? `Hari libur: ${dash.holiday}` : 'Akhir pekan'} — tidak ada kewajiban absen.</p>}
        {dash && (
          <div className="stats">
            <Tile icon={CheckCircle2} label="Hadir" value={c.hadir} tone="ok" />
            <Tile icon={Clock} label="Terlambat" value={c.terlambat} tone="warn" />
            <Tile icon={BadgeCheck} label="Izin" value={c.izin} tone="info" />
            <Tile icon={FileHeart} label="Sakit" value={c.sakit} tone="vio" />
            <Tile icon={Plane} label="Cuti" value={c.cuti} tone="info" />
            <Tile icon={Briefcase} label="Dinas" value={c.dinas} tone="vio" />
            <Tile icon={UserX} label={`Belum absen / ${dash.total_guru}`} value={dash.belum_absen.length} tone="bad" />
          </div>
        )}
        {dash?.belum_absen.length > 0 && <p className="small">Belum absen: {dash.belum_absen.map((g) => g.full_name).join(', ')}</p>}
        {dash?.entries.length > 0 && (
          <div className="scroll">
            <table>
              <thead><tr><th>Guru</th><th>Status</th><th>Masuk – Pulang</th><th>Catatan</th></tr></thead>
              <tbody>
                {dash.entries.map((e) => (
                  <tr key={e.id}>
                    <td><div className="who">{e.has_selfie ? <Selfie id={e.id} name={e.full_name} /> : <span className="avatar">{initials(e.full_name)}</span>}<b>{e.full_name}</b></div></td>
                    <td><span className={`tag ${STATUS_TAG[e.status] ?? ''}`}>{e.status}</span></td>
                    <td className="nowrap">{hhmm(e.check_in)} – {e.check_out ? hhmm(e.check_out) : '…'}</td>
                    <td>{e.flags.length > 0 && <span className="flag" title={e.flags.map((x) => FLAG_TEXT[x] ?? x).join(', ')}><AlertTriangle size={14} style={{ verticalAlign: '-2px' }} /> {e.flags.map((x) => FLAG_TEXT[x] ?? x).join(', ')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2><BadgeCheck size={20} /> Pengajuan izin</h2>
        {leaves.length === 0 && <p className="small">Belum ada pengajuan.</p>}
        <div className="grid">
          {leaves.map((l) => (
            <div key={l.id} className="gradecard">
              <div className="inline"><b>{l.full_name}</b><span className="tag">{l.type}</span><span className={`tag ${l.status === 'approved' ? 'ok' : l.status === 'rejected' ? 'bad' : 'run'}`}>{l.status}</span></div>
              <span className="small">{l.start_date} s.d. {l.end_date} · {l.reason || 'tanpa keterangan'}</span>
              {l.status === 'pending' && (
                <div className="inline">
                  <button className="good" onClick={() => decide(l.id, 'approved')}><CheckCircle2 size={16} /> Setujui</button>
                  <button className="secondary" onClick={() => decide(l.id, 'rejected')}><XCircle size={16} /> Tolak</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2><Download size={20} /> Rekap bulanan</h2>
        <div className="inline">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Bulan rekap" />
          <button onClick={() => download(`/reports/attendance.xlsx?month=${month}`, `rekap-guru-${month}.xlsx`).catch((e) => setErr(e.message))}><Download size={16} /> Unduh Excel</button>
        </div>
      </section>
      {user.role !== 'guru' && <QrPanel />}
    </>
  );
}
