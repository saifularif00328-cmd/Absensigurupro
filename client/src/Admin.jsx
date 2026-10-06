import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, CalendarOff, Users } from 'lucide-react';
import { api, fetchImageUrl } from './api.js';
import ImportBox from './ui/ImportBox.jsx';
import Credentials from './ui/Credentials.jsx';

const EMPTY = { name: '', address: '', lat: '', lng: '', geofence_radius_m: 100, work_start: '07:00', work_end: '14:00', late_tolerance_min: 10, face_liveness: true, face_threshold: 0.55, current_term: '' };
const num = (v) => (v === '' || v == null ? null : Number(v));

function SchoolSettings({ onError }) {
  const [f, setF] = useState(EMPTY);
  const [saved, setSaved] = useState('');
  const touched = useRef(new Set()); // kolom yang sudah diubah pengguna tidak ditimpa saat data awal baru tiba
  useEffect(() => {
    api('/school').then((s) => s && setF((prev) => ({ ...EMPTY, ...s, lat: s.lat ?? '', lng: s.lng ?? '', face_liveness: !!s.face_liveness, ...Object.fromEntries([...touched.current].map((k) => [k, prev[k]])) }))).catch((e) => onError(e.message));
  }, [onError]);
  const set = (k) => (e) => { touched.current.add(k); setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); };

  const useMyLocation = () =>
    navigator.geolocation.getCurrentPosition(
      (p) => { touched.current.add('lat'); touched.current.add('lng'); setF((x) => ({ ...x, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) })); },
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
          late_tolerance_min: Number(f.late_tolerance_min), face_liveness: f.face_liveness, face_threshold: Number(f.face_threshold), current_term: f.current_term,
        },
      });
      setSaved('Tersimpan');
    } catch (e2) { onError(e2.message); }
  };

  return (
    <section className="panel">
      <h2><Settings size={20} /> Pengaturan sekolah</h2>
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
        <label>Batas kecocokan wajah (jarak maks.) <input type="number" step="0.01" min="0.4" max="0.65" style={{ width: 90 }} value={f.face_threshold} onChange={set('face_threshold')} /></label>
        <p className="small" style={{ margin: 0 }}>Makin kecil makin ketat (0,40–0,65; bawaan 0,55). Terlalu longgar bisa meloloskan orang mirip; terlalu ketat bisa menolak guru yang sah saat gelap/berkacamata.</p>
        <label className="chk"><input type="checkbox" checked={f.face_liveness} onChange={set('face_liveness')} /> Wajib tantangan kedip/menoleh saat absen wajah (anti foto)</label>
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
      <h2><CalendarOff size={20} /> Hari libur</h2>
      <form onSubmit={add} className="inline">
        <input type="date" required aria-label="Tanggal libur" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
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

function FacePhoto({ user, onClose }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let url = '';
    fetchImageUrl(`/users/${user.id}/face-photo`).then((u) => { url = u; setSrc(u); }).catch(() => setSrc('-'));
    return () => url && URL.revokeObjectURL(url);
  }, [user.id]);
  return (
    <div className="modal" role="dialog" aria-label={`Foto wajah ${user.full_name}`}>
      <h2>{user.full_name}</h2>
      {src && src !== '-' ? <img src={src} alt={`Wajah terdaftar ${user.full_name}`} className="preview" /> : <p>{src ? 'Foto tidak tersedia' : 'Memuat…'}</p>}
      <button className="secondary" onClick={onClose}>Tutup</button>
    </div>
  );
}

function Teachers({ onError }) {
  const [users, setUsers] = useState([]);
  const [school, setSchool] = useState('');
  const [f, setF] = useState({ username: '', password: '', full_name: '', nip: '' });
  const [msg, setMsg] = useState('');
  const [creds, setCreds] = useState(null);
  const [photo, setPhoto] = useState(null);
  const load = useCallback(() => api('/users').then(setUsers).catch((e) => onError(e.message)), [onError]);
  useEffect(() => { load(); api('/school').then((s) => setSchool(s?.name ?? '')).catch(() => {}); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', body: { ...f, nip: f.nip || undefined, role: 'guru' } });
      setCreds([{ full_name: f.full_name, nip: f.nip, username: f.username, password: f.password, role: 'guru' }]);
      setF({ username: '', password: '', full_name: '', nip: '' });
      setMsg('Guru ditambahkan');
      load();
    } catch (e2) { onError(e2.message); }
  };
  const act = async (fn, ok) => { try { await fn(); if (ok) setMsg(ok); load(); } catch (e) { onError(e.message); } };
  const resetPw = (u) => confirm(`Reset password ${u.full_name}? Password lama tidak berlaku lagi.`) && act(async () => {
    const r = await api(`/users/${u.id}/reset-password`, { method: 'POST' });
    setCreds([{ full_name: r.full_name, nip: u.nip ?? '', username: r.username, password: r.password, role: u.role }]);
  });

  return (
    <section className="panel">
      <h2><Users size={20} /> Guru</h2>
      <ImportBox kind="guru" onResult={(r) => { load(); if (r.credentials?.length) setCreds(r.credentials); }} />
      <details>
        <summary>Tambah satu guru secara manual</summary>
        <form onSubmit={add} className="inline" style={{ marginTop: 10 }}>
          <input placeholder="Nama lengkap" required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
          <input placeholder="NIP (opsional)" value={f.nip} onChange={(e) => setF({ ...f, nip: e.target.value })} />
          <input placeholder="Username" required minLength={3} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          <input type="password" placeholder="Password (min 8)" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <button>Tambah guru</button>
        </form>
      </details>
      {msg && <p className="msg">{msg}</p>}
      <div className="scroll">
        <table>
          <thead><tr><th>Nama</th><th>Username</th><th>Status</th><th>Tindakan</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.full_name}</b><br /><span className="small">{u.nip || '—'} · {u.role}</span></td>
                <td>{u.username}</td>
                <td>
                  <span className={`tag ${u.active ? 'ok' : 'bad'}`}>{u.active ? 'aktif' : 'nonaktif'}</span>{' '}
                  {u.role === 'guru' && <span className={`tag ${u.face_enrolled ? 'ok' : ''}`}>{u.face_enrolled ? 'wajah terdaftar' : 'wajah belum'}</span>}{' '}
                  {u.must_change_password ? <span className="tag run">belum ganti password</span> : null}
                </td>
                <td>
                  {u.role !== 'admin' && (
                    <div className="actionrow">
                      <button className="secondary" onClick={() => resetPw(u)}>Reset password</button>
                      {u.role === 'guru' && <button className="secondary" onClick={() => act(() => api(`/users/${u.id}/reset-device`, { method: 'POST' }), `Perangkat ${u.full_name} direset`)}>Reset perangkat</button>}
                      {u.role === 'guru' && !!u.face_enrolled && <button className="secondary" onClick={() => setPhoto(u)}>Foto wajah</button>}
                      {u.role === 'guru' && !!u.face_enrolled && <button className="secondary" onClick={() => confirm(`Hapus wajah terdaftar ${u.full_name}? Guru harus mendaftar ulang.`) && act(() => api(`/users/${u.id}/face`, { method: 'DELETE' }), `Wajah ${u.full_name} direset`)}>Reset wajah</button>}
                      <button className="secondary" onClick={() => act(() => api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }), u.active ? `${u.full_name} dinonaktifkan` : `${u.full_name} diaktifkan`)}>{u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creds && <Credentials rows={creds} school={school} onClose={() => setCreds(null)} />}
      {photo && <FacePhoto user={photo} onClose={() => setPhoto(null)} />}
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
