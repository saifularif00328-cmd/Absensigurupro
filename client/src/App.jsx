import { useEffect, useState } from 'react';
import { api } from './api.js';
import Guru from './Guru.jsx';
import Staff from './Staff.jsx';
import Admin from './Admin.jsx';
import Soal from './Soal.jsx';
import Ujian from './Ujian.jsx';
import Akademik from './Akademik.jsx';
import Nilai from './Nilai.jsx';
import Siswa from './Siswa.jsx';

const TABS = {
  guru: [['absensi', 'Absensi'], ['soal', 'Bank Soal'], ['ujian', 'Ujian'], ['nilai', 'Nilai']],
  admin: [['dasbor', 'Dasbor'], ['akademik', 'Kelas & Siswa'], ['soal', 'Bank Soal'], ['ujian', 'Ujian'], ['nilai', 'Nilai'], ['pengaturan', 'Pengaturan']],
  kepsek: [['dasbor', 'Dasbor'], ['ujian', 'Ujian'], ['nilai', 'Nilai']],
};

function Login({ onDone }) {
  const [f, setF] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
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
    <form className="card" onSubmit={submit}>
      <h1>Absensi Guru Pro</h1>
      <input placeholder="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
      <input type="password" placeholder="Password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      {err && <p className="err">{err}</p>}
      <button>Masuk</button>
      <a href="#/ujian">Saya siswa — masuk ujian</a>
    </form>
  );
}

export default function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const h = () => setHash(location.hash); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  if (hash.startsWith('#/ujian')) return <Siswa />;
  return <Staff2 />;
}

function Staff2() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState(null);
  useEffect(() => {
    api('/me').then(setUser).catch(() => {}).finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  if (!user) return <Login onDone={setUser} />;
  const tabs = TABS[user.role];
  const cur = tab ?? tabs[0][0];
  return (
    <main className="page">
      <header>
        <h1>Halo, {user.full_name} <small>({user.role})</small></h1>
        <button onClick={() => { localStorage.removeItem('token'); setUser(null); }}>Keluar</button>
      </header>
      <nav className="tabs">
        {tabs.map(([k, label]) => <button key={k} className={cur === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </nav>
      {cur === 'absensi' && <Guru />}
      {cur === 'dasbor' && <Staff user={user} />}
      {cur === 'pengaturan' && <Admin />}
      {cur === 'akademik' && <Akademik />}
      {cur === 'soal' && <Soal />}
      {cur === 'ujian' && <Ujian role={user.role} />}
      {cur === 'nilai' && <Nilai user={user} />}
    </main>
  );
}
