import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Fingerprint, LogOut, MapPin, ScanFace, Send, ShieldCheck, WifiOff } from 'lucide-react';
import { api, deviceId, enqueue, flushPending, pending } from './api.js';
import FaceCapture from './face/FaceCapture.jsx';
import { prefetchFaceModels } from './face/faceEngine.js';
import { inSafeApp, nativeLocation } from './safeMode.js';

// Di aplikasi Android lokasi diambil native agar lokasi palsu (mock) bisa dideteksi; di browser memakai Geolocation API
const getPosition = () => {
  if (inSafeApp()) return nativeLocation().then((l) => ({ lat: l.lat, lng: l.lng, accuracy: l.accuracy, mock: l.mock }));
  return new Promise((resolve, reject) =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, mock: false }),
        () => reject(new Error('Izin lokasi ditolak / lokasi tidak tersedia')), { enableHighAccuracy: true, timeout: 15000 })
      : reject(new Error('Perangkat tidak mendukung lokasi')));
};

const fmt = (iso) => (iso ? new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—');

export default function Guru() {
  const [today, setToday] = useState(null);
  const [msg, setMsg] = useState('');
  const [queued, setQueued] = useState(pending().length);
  const [leaves, setLeaves] = useState([]);
  const [face, setFace] = useState({ enrolled: localStorage.getItem('face_enrolled') === '1', liveness: localStorage.getItem('face_liveness') !== '0' });
  const [step, setStep] = useState(null);        // null | 'enroll' | 'verify'
  const [pos, setPos] = useState(null);          // lokasi yang sudah diambil sebelum verifikasi wajah
  const [clock, setClock] = useState(new Date());
  const [lf, setLf] = useState({ type: 'izin', start_date: '', end_date: '', reason: '' });

  useEffect(() => { const id = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(id); }, []);

  const load = useCallback(async () => {
    try {
      setToday((await api('/attendance/today')).attendance);
      setLeaves(await api('/leaves'));
      const f = await api('/face/status');
      setFace(f);
      localStorage.setItem('face_enrolled', f.enrolled ? '1' : '0');   // diingat untuk saat offline
      localStorage.setItem('face_liveness', f.liveness ? '1' : '0');
    } catch { /* offline: pakai status tersimpan */ }
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
    prefetchFaceModels();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [load, sync]);

  // Langkah 1: lokasi. Langkah 2: wajah. Langkah 3: kirim (atau simpan lokal bila offline).
  const startCheckIn = async () => {
    setMsg('');
    if (!face.enrolled) return setMsg('Daftarkan wajah Anda dulu (tombol di atas).');
    try {
      setPos(await getPosition());
      setStep('verify');
    } catch (e) { setMsg(e.message); }
  };

  const submit = useCallback(async ({ selfie, descriptor }) => {
    setStep(null);
    const { lat, lng, accuracy, mock } = pos;
    const body = { method: 'selfie', lat, lng, ...(accuracy != null && { accuracy }), ...(mock && { mock_location: true }), selfie, descriptor, device_id: deviceId() };
    try {
      setToday(await api('/attendance/check-in', { method: 'POST', body }));
      setMsg('Check-in berhasil');
    } catch (e) {
      if (!e.status) {
        const ok = enqueue({ path: '/attendance/check-in', body: { ...body, client_time: new Date().toISOString() } });
        setQueued(pending().length);
        setMsg(ok ? 'Offline: absen disimpan di perangkat dan akan dikirim saat online' : 'Offline dan penyimpanan perangkat penuh. Sambungkan internet lalu coba lagi.');
      } else setMsg(e.message);
    }
  }, [pos]);

  const enroll = useCallback(async (data) => {
    setStep(null);
    try {
      await api('/face/enroll', { method: 'POST', body: data });
      setFace((f) => ({ ...f, enrolled: true }));
      localStorage.setItem('face_enrolled', '1');
      setMsg('Wajah berhasil didaftarkan. Sekarang Anda bisa absen.');
    } catch (e) { setMsg(e.message); }
  }, []);

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
      {step === 'verify' && <FaceCapture mode="verify" liveness={face.liveness} onDone={submit} onCancel={() => setStep(null)} />}
      {step === 'enroll' && <FaceCapture mode="enroll" liveness={face.liveness} onDone={enroll} onCancel={() => setStep(null)} />}

      {!face.enrolled && (
        <section className="panel callout">
          <h2><ScanFace size={20} /> Daftarkan wajah Anda</h2>
          <p>Absen memakai selfie yang dicocokkan dengan wajah Anda. Daftarkan sekali (3 foto singkat) di tempat yang terang.</p>
          <button onClick={() => { setMsg(''); setStep('enroll'); }}><ScanFace size={18} /> Daftarkan wajah sekarang</button>
        </section>
      )}

      <section className="panel">
        <h2><Fingerprint size={20} /> Absensi hari ini</h2>
        <div className="orbwrap">
          <div className="clock" aria-live="off">{clock.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
          <div className="small">{clock.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          {!today?.check_in && <button className="orb" onClick={startCheckIn} aria-label="Check-in dengan wajah"><ScanFace /> Check-in<small>(wajah)</small></button>}
          {today?.check_in && !today.check_out && <button className="orb done" onClick={checkOut} aria-label="Check-out"><LogOut /> Check-out</button>}
          {today?.check_in && today.check_out && <div className="orb done" style={{ animation: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><CheckCircle2 /> Selesai</div>}
          <div className="statusline">
            <span className={`tag ${today?.status === 'hadir' ? 'ok' : today?.status === 'terlambat' ? 'bad' : ''}`}>Status: <b>{today?.status ?? 'belum absen'}</b></span>
            <span className="tag">Masuk {fmt(today?.check_in)}</span>
            <span className="tag">Pulang {fmt(today?.check_out)}</span>
          </div>
          {!today?.check_in && <p className="small"><MapPin size={14} style={{ verticalAlign: '-2px' }} /> Anda harus berada di area sekolah. <ShieldCheck size={14} style={{ verticalAlign: '-2px' }} /> Wajah dicocokkan otomatis.</p>}
        </div>
        {queued > 0 && <p className="warn"><WifiOff size={16} style={{ verticalAlign: '-3px' }} /> {queued} absen menunggu sinkron <button className="secondary" onClick={sync}>Kirim sekarang</button></p>}
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
