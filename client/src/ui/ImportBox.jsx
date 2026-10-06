import { useRef, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { download, uploadFile } from '../api.js';

const CFG = {
  siswa: { path: '/students/import-xlsx', template: ['/templates/siswa.xlsx', 'template-siswa.xlsx'], hint: 'Kolom: NIS, Nama, Kelas.' },
  guru: { path: '/users/import-xlsx', template: ['/templates/guru.xlsx', 'template-guru.xlsx'], hint: 'Kolom: NIP, Nama, Username (opsional), Peran (opsional), Kelas Wali (opsional).' },
};

// Unduh template + unggah .xlsx + ringkasan hasil. onResult(hasil) dipanggil setelah berhasil.
export default function ImportBox({ kind, onResult }) {
  const cfg = CFG[kind];
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setRes(null); setBusy(true);
    try { const r = await uploadFile(cfg.path, file); setRes(r); onResult?.(r); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <div className="importbox">
      <p className="small">{cfg.hint} Gunakan file .xlsx (Excel). Maksimal 2000 baris.</p>
      <div className="inline">
        <button className="secondary" onClick={() => download(...cfg.template).catch((e) => setErr(e.message))}><FileSpreadsheet size={16} /> Unduh template Excel</button>
        <button disabled={busy} onClick={() => input.current.click()}><Upload size={16} /> {busy ? 'Mengunggah…' : 'Unggah file Excel'}</button>
        <input ref={input} type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={pick} aria-label={`Berkas Excel ${kind}`} />
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {res && (
        <div className="msg" role="status">
          Impor selesai: <b>{res.created}</b> baru, <b>{res.updated}</b> diperbarui, <b>{res.errors.length}</b> ditolak.
          {res.errors.length > 0 && <ul className="small">{res.errors.slice(0, 15).map((x) => <li key={x.line}>Baris {x.line}: {x.error}</li>)}{res.errors.length > 15 && <li>…dan {res.errors.length - 15} lainnya</li>}</ul>}
        </div>
      )}
    </div>
  );
}
