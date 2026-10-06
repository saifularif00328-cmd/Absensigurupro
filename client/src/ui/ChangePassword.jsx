import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '../api.js';
import Logo from './Logo.jsx';

// forced = true: layar penuh wajib saat login pertama; false: dialog dari menu
export default function ChangePassword({ forced = false, onDone, onCancel }) {
  const [f, setF] = useState({ old_password: '', new_password: '', confirm: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (f.new_password.length < 8) return setErr('Password baru minimal 8 karakter');
    if (f.new_password !== f.confirm) return setErr('Konfirmasi password tidak sama');
    setBusy(true);
    try { await api('/auth/change-password', { method: 'POST', body: { old_password: f.old_password, new_password: f.new_password } }); onDone(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const form = (
    <form className="card joincard" onSubmit={submit}>
      {forced && <div className="brand"><Logo /><div>Absensi Guru Pro</div></div>}
      <h1 style={{ fontSize: 22 }}><KeyRound size={22} style={{ verticalAlign: '-3px' }} /> {forced ? 'Buat password baru' : 'Ganti password'}</h1>
      {forced && <p className="small">Demi keamanan, ganti password awal Anda sebelum melanjutkan.</p>}
      <input type="password" autoComplete="current-password" placeholder="Password saat ini" aria-label="Password saat ini" value={f.old_password} onChange={set('old_password')} />
      <input type="password" autoComplete="new-password" placeholder="Password baru (min. 8 karakter)" aria-label="Password baru" value={f.new_password} onChange={set('new_password')} />
      <input type="password" autoComplete="new-password" placeholder="Ulangi password baru" aria-label="Ulangi password baru" value={f.confirm} onChange={set('confirm')} />
      {err && <p className="err" role="alert">{err}</p>}
      <button disabled={busy}>Simpan password</button>
      {onCancel && <button type="button" className="secondary" onClick={onCancel}>{forced ? 'Keluar' : 'Batal'}</button>}
    </form>
  );
  return forced ? form : <div className="modal" role="dialog">{form}</div>;
}
