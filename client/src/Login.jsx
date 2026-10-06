import { useState } from 'react';
import { CalendarCheck, CheckCircle2, ClipboardCheck, GraduationCap, LogIn, UserRound } from 'lucide-react';
import { api } from './api.js';
import Logo from './ui/Logo.jsx';
import { useTilt } from './ui/useTilt.js';

export default function Login({ onDone }) {
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const tilt = useTilt(6);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/login', { method: 'POST', body: f });
      localStorage.setItem('token', r.token);
      onDone(r.user);
    } catch (e2) {
      setErr(e2.message);
    }
  };
  return (
    <div className="login-wrap">
      <section className="hero">
        <div className="brand"><Logo /><div>Absensi Guru Pro</div></div>
        <h1>Sekolah digital yang <span>rapi, cepat, dan tepercaya</span></h1>
        <p>Presensi guru, ujian online anti-curang, hingga rapor otomatis — dalam satu aplikasi.</p>
        <div className="stage" aria-hidden="true">
          <div className="stack3d">
            <div className="glass3d c1"><div className="gl-row"><GraduationCap /><div><b>Rapor otomatis</b><span>Nilai langsung masuk</span></div></div></div>
            <div className="glass3d c2"><div className="gl-row"><ClipboardCheck /><div><b>Ujian online</b><span>Dipantau real-time</span></div></div></div>
            <div className="glass3d c3"><div className="gl-row"><CalendarCheck /><div><b>Presensi guru</b><span>GPS · QR · Selfie</span></div></div><div className="bar"><i style={{ width: '82%' }} /></div></div>
          </div>
        </div>
        <ul>
          <li><CheckCircle2 size={20} /> Tetap bisa absen saat internet putus</li>
          <li><CheckCircle2 size={20} /> Ujian terkunci, pelanggaran tercatat</li>
          <li><CheckCircle2 size={20} /> Cetak soal ke Word lengkap kop sekolah</li>
        </ul>
      </section>
      <form className="card login-card" onSubmit={submit} ref={tilt}>
        <div>
          <h2>Selamat datang</h2>
          <p>Masuk untuk melanjutkan</p>
        </div>
        <input placeholder="Username" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input type="password" placeholder="Password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {err && <p className="err" role="alert">{err}</p>}
        <button><LogIn size={18} /> Masuk</button>
        <div className="divider">atau</div>
        <a className="btn secondary" href="#/ujian"><UserRound size={18} /> Saya siswa — masuk ujian</a>
      </form>
    </div>
  );
}
