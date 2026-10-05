import { useEffect, useState } from 'react';
import { api } from './api.js';
import Guru from './Guru.jsx';
import Staff from './Staff.jsx';
import Admin from './Admin.jsx';

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
    </form>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('dasbor');
  useEffect(() => {
    api('/me').then(setUser).catch(() => {}).finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  if (!user) return <Login onDone={setUser} />;
  return (
    <main className="page">
      <header>
        <h1>Halo, {user.full_name} <small>({user.role})</small></h1>
        <button onClick={() => { localStorage.removeItem('token'); setUser(null); }}>Keluar</button>
      </header>
      {user.role === 'admin' && (
        <nav className="tabs">
          <button className={tab === 'dasbor' ? 'on' : ''} onClick={() => setTab('dasbor')}>Dasbor</button>
          <button className={tab === 'pengaturan' ? 'on' : ''} onClick={() => setTab('pengaturan')}>Pengaturan</button>
        </nav>
      )}
      {user.role === 'guru' ? <Guru /> : user.role === 'admin' && tab === 'pengaturan' ? <Admin /> : <Staff user={user} />}
    </main>
  );
}
