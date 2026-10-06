import { Router } from 'express';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// APK aplikasi Android "Ujian Aman" yang disimpan admin di server (hasil build GitHub Actions / Android Studio)
const apkFile = () => join(resolve(process.env.APK_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'downloads')), 'ujian-aman.apk');

export function appRoutes() {
  const r = Router();

  r.get('/api/app-info', (_req, res) => {
    const f = apkFile();
    res.json(existsSync(f) ? { apk: true, size: statSync(f).size, updated_at: statSync(f).mtime.toISOString() } : { apk: false });
  });

  r.get('/unduh/ujian-aman.apk', (_req, res) => {
    const f = apkFile();
    if (!existsSync(f)) return res.status(404).type('text/plain').send('APK belum tersedia di server. Minta admin mengunggahnya ke folder downloads.');
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="ujian-aman.apk"');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(f);
  });

  return r;
}
