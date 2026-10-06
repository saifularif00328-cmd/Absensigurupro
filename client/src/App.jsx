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
  useEffect(() => {
    api('/me').then(setUser).catch(() => {}).finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  if (!user) return <Login onDone={setUser} />;
  const tabs = TABS[user.role];
  const cur = tab ?? tabs[0][0];
  const logout = () => { localStorage.removeItem('token'); setUser(null); setTab(null); };
  return (
    <Shell user={user} tabs={tabs} cur={cur} onTab={setTab} onLogout={logout}>
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
