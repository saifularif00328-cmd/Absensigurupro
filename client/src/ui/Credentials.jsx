import { Download, Printer, X } from 'lucide-react';
import { downloadPost } from '../api.js';
import { useState } from 'react';

// Lembar akun hasil impor/reset: password awal hanya tampil di sini sekali
export default function Credentials({ rows, school, onClose }) {
  const [err, setErr] = useState('');
  return (
    <div className="modal light" role="dialog" aria-label="Kredensial akun">
      <div className="printarea">
        <h2>Akun Aplikasi Absensi Guru — {school || 'Sekolah'}</h2>
        <p className="noprint warnbox">Password awal hanya ditampilkan sekali. Unduh atau cetak sekarang, lalu bagikan kepada yang bersangkutan. Guru wajib mengganti password saat login pertama.</p>
        <div className="cards">
          {rows.map((r) => (
            <div key={r.username} className="credcard">
              <b>{r.full_name}</b>
              {r.nip && <span>NIP: {r.nip}</span>}
              <span>Username: <code>{r.username}</code></span>
              <span>Password awal: <code>{r.password}</code></span>
            </div>
          ))}
        </div>
        {err && <p className="err noprint">{err}</p>}
        <div className="noprint inline">
          <button onClick={() => downloadPost('/users/credentials.xlsx', { rows }, 'kredensial-guru.xlsx').catch((e) => setErr(e.message))}><Download size={16} /> Unduh Excel</button>
          <button className="secondary" onClick={() => window.print()}><Printer size={16} /> Cetak</button>
          <button className="secondary" onClick={onClose}><X size={16} /> Tutup</button>
        </div>
      </div>
    </div>
  );
}
