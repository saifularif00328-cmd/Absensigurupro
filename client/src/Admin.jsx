import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const EMPTY = { name: '', address: '', lat: '', lng: '', geofence_radius_m: 100, work_start: '07:00', work_end: '14:00', late_tolerance_min: 10, require_selfie: false, current_term: '' };
const num = (v) => (v === '' || v == null ? null : Number(v));

function SchoolSettings({ onError }) {
  const [f, setF] = useState(EMPTY);
  const [saved, setSaved] = useState('');
  useEffect(() => {
    api('/school').then((s) => s && setF({ ...EMPTY, ...s, lat: s.lat ?? '', lng: s.lng ?? '', require_selfie: !!s.require_selfie })).catch((e) => onError(e.message));
  }, [onError]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const useMyLocation = () =>
    navigator.geolocation.getCurrentPosition(
      (p) => setF((x) => ({ ...x, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) })),
      () => onError('Izin lokasi ditolak'),
      { enableHighAccuracy: true },
    );

  const save = async (e) => {
    e.preventDefault();
    setSaved('');
    try {
      await api('/school', {
        method: 'PUT',
        body: {
          name: f.name, address: f.address, lat: num(f.lat), lng: num(f.lng),
          geofence_radius_m: Number(f.geofence_radius_m), work_start: f.work_start, work_end: f.work_end,
          late_tolerance_min: Number(f.late_tolerance_min), require_selfie: f.require_selfie, current_term: f.current_term,
        },
      });
      setSaved('Tersimpan');
    } catch (e2) { onError(e2.message); }
  };

  return (
    <section className="panel">
      <h2>Pengaturan sekolah</h2>
      <form onSubmit={save} className="grid">
        <input placeholder="Nama sekolah" required value={f.name} onChange={set('name')} />
        <input placeholder="Alamat" value={f.address} onChange={set('address')} />
        <div className="inline">
          <input placeholder="Lintang (lat)" value={f.lat} onChange={set('lat')} />
          <input placeholder="Bujur (lng)" value={f.lng} onChange={set('lng')} />
          <button type="button" className="secondary" onClick={useMyLocation}>Gunakan lokasi saya sekarang</button>
        </div>
        <label>Radius absen (meter) <input type="number" min="10" max="5000" value={f.geofence_radius_m} onChange={set('geofence_radius_m')} /></label>
        <div className="inline">
          <label>Jam masuk <input type="time" value={f.work_start} onChange={set('work_start')} /></label>
          <label>Jam pulang <input type="time" value={f.work_end} onChange={set('work_end')} /></label>
          <label>Toleransi (menit) <input type="number" min="0" max="120" value={f.late_tolerance_min} onChange={set('late_tolerance_min')} /></label>
        </div>
        <label>Semester berjalan <input placeholder="mis. 2026/2027 Ganjil (kosong = otomatis)" style={{ minWidth: 260 }} value={f.current_term} onChange={set('current_term')} /></label>
        <label className="chk"><input type="checkbox" checked={f.require_selfie} onChange={set('require_selfie')} /> Wajib selfie saat absen</label>
        <button>Simpan</button>
        {saved && <p className="msg">{saved}</p>}
      </form>
    </section>
  );
}

function Holidays({ onError }) {
  const [list, setList] = useState([]);
  const [f, setF] = useState({ date: '', name: '' });
  const load = useCallback(() => api('/holidays').then(setList).catch((e) => onError(e.message)), [onError]);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try { await api('/holidays', { method: 'POST', body: f }); setF({ date: '', name: '' }); load(); } catch (e2) { onError(e2.message); }
  };
  const del = async (date) => {
    try { await api(`/holidays/${date}`, { method: 'DELETE' }); load(); } catch (e) { onError(e.message); }
  };

  return (
    <section className="panel">
      <h2>Hari libur</h2>
      <form onSubmit={add} className="inline">
        <input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <input placeholder="Nama hari libur" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <button>Tambah</button>
      </form>
      {list.length === 0 ? <p>Belum ada hari libur.</p> : (
        <table>
          <tbody>
            {list.map((h) => (
              <tr key={h.date}><td>{h.date}</td><td>{h.name}</td><td><button className="secondary" onClick={() => del(h.date)}>Hapus</button></td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Teachers({ onError }) {
  const [users, setUsers] = useState([]);
  const [f, setF] = useState({ username: '', password: '', full_name: '', nip: '' });
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api('/users').then(setUsers).catch((e) => onError(e.message)), [onError]);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', body: { ...f, nip: f.nip || undefined, role: 'guru' } });
      setF({ username: '', password: '', full_name: '', nip: '' });
      setMsg('Guru ditambahkan');
      load();
    } catch (e2) { onError(e2.message); }
  };
  const reset = async (u) => {
    try { await api(`/users/${u.id}/reset-device`, { method: 'POST' }); setMsg(`Perangkat ${u.full_name} direset`); } catch (e) { onError(e.message); }
  };

  return (
    <section className="panel">
      <h2>Guru</h2>
      <form onSubmit={add} className="inline">
        <input placeholder="Nama lengkap" required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        <input placeholder="NIP (opsional)" value={f.nip} onChange={(e) => setF({ ...f, nip: e.target.value })} />
        <input placeholder="Username" required minLength={3} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input type="password" placeholder="Password (min 8)" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <button>Tambah guru</button>
      </form>
      {msg && <p className="msg">{msg}</p>}
      <table>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.full_name}</td><td>{u.username}</td><td>{u.role}</td>
              <td>{u.role === 'guru' && <button className="secondary" onClick={() => reset(u)}>Reset perangkat</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function Admin() {
  const [err, setErr] = useState('');
  const onError = useCallback((m) => setErr(m), []);
  return (
    <>
      {err && <p className="err">{err}</p>}
      <SchoolSettings onError={onError} />
      <Holidays onError={onError} />
      <Teachers onError={onError} />
    </>
  );
}
