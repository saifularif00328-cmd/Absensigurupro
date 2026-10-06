import { useEffect, useState } from 'react';
import { CalendarCheck, ClipboardCheck, GraduationCap, KeyRound, LayoutDashboard, LibraryBig, LogOut, Settings, Users } from 'lucide-react';
import { api } from '../api.js';
import Logo from './Logo.jsx';

const ICONS = { absensi: CalendarCheck, dasbor: LayoutDashboard, akademik: Users, soal: LibraryBig, ujian: ClipboardCheck, nilai: GraduationCap, pengaturan: Settings };
const ROLE = { admin: 'Admin', kepsek: 'Kepala Sekolah', guru: 'Guru' };
const initials = (n) => n.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

// Bilah atas kaca + navigasi (pil di desktop, dock melayang di HP)
export default function Shell({ user, tabs, cur, onTab, onLogout, onChangePassword, children }) {
  const [school, setSchool] = useState('');
  useEffect(() => { api('/school').then((s) => setSchool(s?.name ?? '')).catch(() => {}); }, []);
  return (
    <main className="page">
      <header className="topbar">
        <div className="brand"><Logo /><div>Absensi Guru Pro<small>{school || 'Sekolah'}</small></div></div>
        <div className="spacer" />
        <div className="userchip">
          <span className="nm">{user.full_name}</span><span className="role">{ROLE[user.role]}</span>
          <span className="avatar" style={{ width: 34, height: 34, fontSize: 13 }}>{initials(user.full_name)}</span>
          <button className="secondary" onClick={onChangePassword} aria-label="Ganti password" title="Ganti password"><KeyRound size={16} /></button>
          <button className="secondary" onClick={onLogout} aria-label="Keluar" title="Keluar"><LogOut size={16} /> <span className="nm">Keluar</span></button>
        </div>
      </header>
      <nav className="tabs" aria-label="Menu utama">
        {tabs.map(([k, label]) => {
          const I = ICONS[k];
          return <button key={k} className={cur === k ? 'on' : ''} aria-current={cur === k ? 'page' : undefined} onClick={() => onTab(k)}>{I && <I />}{label}</button>;
        })}
      </nav>
      {children}
    </main>
  );
}
