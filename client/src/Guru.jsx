import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Camera, CheckCircle2, Fingerprint, LogOut, MapPin, QrCode, Send, WifiOff } from 'lucide-react';
import { api, deviceId, enqueue, flushPending, pending } from './api.js';
import { SelfieCapture } from './Camera.jsx';
import QrScanner from './QrScanner.jsx';

const getPosition = () =>
  new Promise((resolve, reject) =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Izin lokasi ditolak / lokasi tidak tersedia')), { enableHighAccuracy: true, timeout: 15000 })
      : reject(new Error('Perangkat tidak mendukung lokasi')));

const fmt = (iso) => (iso ? new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—');

export default function Guru() {
  const [today, setToday] = useState(null);
  const [msg, setMsg] = useState('');
  const [qr, setQr] = useState('');
  const [queued, setQueued] = useState(pending().length);
  const [leaves, setLeaves] = useState([]);
  const [requireSelfie, setRequireSelfie] = useState(false);
  const [step, setStep] = useState(null);       // null | 'scan' | 'selfie'
  const [proof, setProof] = useState(null);     // bukti utama (gps / qr) menunggu selfie
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(id); }, []);
  const [lf, setLf] = useState({ type: 'izin', start_date: '', end_date: '', reason: '' });

  const load = useCallback(async () => {
    try {
      setToday((await api('/attendance/today')).attendance);
      setLeaves(await api('/leaves'));
      const s = await api('/school');
      setRequireSelfie(!!s?.require_selfie);
      localStorage.setItem('require_selfie', s?.require_selfie ? '1' : '0'); // diingat untuk saat offline
    } catch {
      setRequireSelfie(localStorage.getItem('require_selfie') === '1');
    }
  }, []);

  const sync = useCallback(async () => {
    if (!pending().length) return;
    const r = await flushPending();
    setQueued(r.remaining);
    if (r.synced) setMsg(`${r.synced} absen offline berhasil disinkronkan`);
    if (r.lastError) setMsg(`Sebagian absen offline ditolak: ${r.lastError}`);
    load();
  }, [load]);

  useEffect(() => {
    load();
    sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [load, sync]);

  // Kirim absen; offline hanya untuk GPS (QR harus online)
  const submit = async (p, selfie) => {
    setStep(null);
    setProof(null);
    const body = { ...p, device_id: deviceId(), ...(selfie && { selfie }) };
    try {
      setToday(await api('/attendance/check-in', { method: 'POST', body }));
      setMsg('Check-in berhasil');
    } catch (e) {
      if (!e.status && p.method === 'gps') {
        const ok = enqueue({ path: '/attendance/check-in', body: { ...body, client_time: new Date().toISOString() } });
        setQueued(pending().length);
        setMsg(ok ? 'Offline: absen disimpan di perangkat dan akan dikirim saat online' : 'Offline dan penyimpanan perangkat penuh. Sambungkan internet lalu coba lagi.');
      } else setMsg(e.message);
    }
  };

  // Bukti utama sudah ada -> minta selfie bila diwajibkan, kalau tidak langsung kirim
  const withProof = (p) => {
    if (requireSelfie) { setProof(p); setStep('selfie'); } else submit(p);
  };

  const checkInGps = async () => {
    setMsg('');
    try {
      const pos = await getPosition();
      withProof({ method: 'gps', lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    } catch (e) { setMsg(e.message); }
  };

  const onScanned = useCallback((token) => {
    setStep(null);
    setQr(token);
    withProof({ method: 'qr', qr_token: token });
  }, [requireSelfie]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkOut = async () => {
    try { setToday(await api('/attendance/check-out', { method: 'POST', body: {} })); setMsg('Check-out berhasil'); }
    catch (e) {
      if (!e.status) { enqueue({ path: '/attendance/check-out', body: { client_time: new Date().toISOString() } }); setQueued(pending().length); setMsg('Offline: check-out disimpan'); }
      else setMsg(e.message);
    }
  };

  const submitLeave = async (e) => {
    e.preventDefault();
    try { await api('/leaves', { method: 'POST', body: lf }); setLf({ ...lf, reason: '' }); setMsg('Pengajuan terkirim'); load(); }
    catch (e2) { setMsg(e2.message); }
  };

  return (
    <>
      {step === 'scan' && <QrScanner onToken={onScanned} onCancel={() => setStep(null)} />}
      {step === 'selfie' && <SelfieCapture onCancel={() => { setStep(null); setProof(null); }} onCapture={(img) => (img ? submit(proof, img) : setMsg('Gagal mengambil foto, coba lagi'))} />}

      <section className="panel">
        <h2><Fingerprint size={20} /> Absensi hari ini</h2>
        <div className="orbwrap">
          <div className="clock" aria-live="off">{clock.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
          <div className="small">{clock.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          {!today?.check_in && <button className="orb" onClick={checkInGps} aria-label="Check-in (lokasi)"><MapPin /> Check-in<small>(lokasi)</small></button>}
          {today?.check_in && !today.check_out && <button className="orb done" onClick={checkOut} aria-label="Check-out"><LogOut /> Check-out</button>}
          {today?.check_in && today.check_out && <div className="orb done" style={{ animation: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><CheckCircle2 /> Selesai</div>}
          <div className="statusline">
            <span className={`tag ${today?.status === 'hadir' ? 'ok' : today?.status === 'terlambat' ? 'bad' : ''}`}>Status: <b>{today?.status ?? 'belum absen'}</b></span>
            <span className="tag">Masuk {fmt(today?.check_in)}</span>
            <span className="tag">Pulang {fmt(today?.check_out)}</span>
          </div>
        </div>
        {queued > 0 && <p className="warn"><WifiOff size={16} style={{ verticalAlign: '-3px' }} /> {queued} absen menunggu sinkron <button className="secondary" onClick={sync}>Kirim sekarang</button></p>}
        {!today?.check_in && (
          <>
            {requireSelfie && <p className="warn"><Camera size={16} style={{ verticalAlign: '-3px' }} /> Sekolah mewajibkan foto selfie saat absen.</p>}
            <div className="actions">
              <button className="action secondary" onClick={() => setStep('scan')}><QrCode /> Scan QR dengan kamera</button>
            </div>
            <div className="row">
              <input placeholder="Atau tempel kode QR" value={qr} onChange={(e) => setQr(e.target.value)} aria-label="Kode QR" />
              <button className="secondary" onClick={() => (qr.trim() ? withProof({ method: 'qr', qr_token: qr.trim() }) : setMsg('Isi kode QR dulu'))}>Check-in QR</button>
            </div>
          </>
        )}
        {msg && <p className="msg" role="status">{msg}</p>}
      </section>

      <section className="panel">
        <h2><CalendarClock size={20} /> Ajukan izin / sakit / cuti</h2>
        <form onSubmit={submitLeave} className="grid">
          <select aria-label="Jenis" value={lf.type} onChange={(e) => setLf({ ...lf, type: e.target.value })}>
            {['izin', 'sakit', 'cuti', 'dinas'].map((t) => <option key={t}>{t}</option>)}
          </select>
          <input type="date" required aria-label="Tanggal mulai" value={lf.start_date} onChange={(e) => setLf({ ...lf, start_date: e.target.value })} />
          <input type="date" required aria-label="Tanggal selesai" value={lf.end_date} onChange={(e) => setLf({ ...lf, end_date: e.target.value })} />
          <input placeholder="Alasan" value={lf.reason} onChange={(e) => setLf({ ...lf, reason: e.target.value })} />
          <button><Send size={16} /> Kirim</button>
        </form>
        <div className="grid">{leaves.map((l) => <div key={l.id} className="inline"><span className="tag">{l.type}</span><span className="small">{l.start_date} s.d. {l.end_date}</span><span className={`tag ${l.status === 'approved' ? 'ok' : l.status === 'rejected' ? 'bad' : 'run'}`}>{l.status}</span></div>)}</div>
      </section>
    </>
  );
}
