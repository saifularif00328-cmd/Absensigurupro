import { useEffect, useState } from 'react';
import { api } from './api.js';
import Shell from './ui/Shell.jsx';
import Login from './Login.jsx';
import Guru from './Guru.jsx';
import Staff from './Staff.jsx';
import Admin from './Admin.jsx';
import Soal from './Soal.jsx';
import Ujian from './Ujian.jsx';
import Akademik from './Akademik.jsx';
import Nilai from './Nilai.jsx';
import Siswa from './Siswa.jsx';
import ChangePassword from './ui/ChangePassword.jsx';

const TABS = {
  guru: [['absensi', 'Absensi'], ['soal', 'Bank Soal'], ['ujian', 'Ujian'], ['nilai', 'Nilai']],
  admin: [['dasbor', 'Dasbor'], ['akademik', 'Kelas & Siswa'], ['soal', 'Bank Soal'], ['ujian', 'Ujian'], ['nilai', 'Nilai'], ['pengaturan', 'Pengaturan']],
  kepsek: [['dasbor', 'Dasbor'], ['ujian', 'Ujian'], ['nilai', 'Nilai']],
};

export default function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const h = () => setHash(location.hash);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return hash.startsWith('#/ujian') ? <Siswa /> : <StaffApp />;
}

function StaffApp() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState(null);
  const [pwOpen, setPwOpen] = useState(false);
  useEffect(() => {
    api('/me').then(setUser).catch(() => {}).finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  if (!user) return <Login onDone={setUser} />;
  const logout = () => { localStorage.removeItem('token'); setUser(null); setTab(null); setPwOpen(false); };
  if (user.must_change_password) {
    return <div className="login-wrap" style={{ display: 'grid', placeItems: 'center' }}><ChangePassword forced onCancel={logout} onDone={() => setUser({ ...user, must_change_password: false })} /></div>;
  }
  const tabs = TABS[user.role];
  const cur = tab ?? tabs[0][0];
  return (
    <Shell user={user} tabs={tabs} cur={cur} onTab={setTab} onLogout={logout} onChangePassword={() => setPwOpen(true)}>
      {pwOpen && <ChangePassword onCancel={() => setPwOpen(false)} onDone={() => setPwOpen(false)} />}
      {cur === 'absensi' && <Guru />}
      {cur === 'dasbor' && <Staff user={user} />}
      {cur === 'pengaturan' && <Admin />}
      {cur === 'akademik' && <Akademik />}
      {cur === 'soal' && <Soal />}
      {cur === 'ujian' && <Ujian role={user.role} />}
      {cur === 'nilai' && <Nilai user={user} />}
    </Shell>
  );
}
