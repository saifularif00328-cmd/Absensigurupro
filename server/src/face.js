import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from './auth.js';
import { decodeJpegDataUrl, savePhoto, deletePhoto, photoExists, photoPath } from './files.js';

// Ambang jarak Euclidean antar deskriptor wajah 128-dimensi (face-api). Orang yang sama biasanya 0,2-0,45;
// orang berbeda yang mirip bisa serendah ~0,55-0,6, jadi batas tolak dibuat ketat dan dapat diatur admin.
export const DEFAULT_FACE_THRESHOLD = 0.55;   // lebih besar dari ini ditolak
export const DOUBT_BAND = 0.1;                // (batas-0,1, batas]: sah tetapi ditandai untuk ditinjau
export const faceLimits = (school) => {
  const reject = school?.face_threshold ?? DEFAULT_FACE_THRESHOLD;
  return { reject, ok: reject - DOUBT_BAND };
};
export const ENROLL_CONSISTENCY = 0.45;
export const DESCRIPTOR_LEN = 128;

export const descriptorSchema = z.array(z.number().finite().min(-10).max(10)).length(DESCRIPTOR_LEN);

export function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

export const enrolledDescriptors = (db, userId) => {
  const raw = db.prepare('SELECT face_descriptors FROM users WHERE id=?').get(userId)?.face_descriptors;
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};

// Jarak terkecil ke salah satu deskriptor terdaftar
export const matchDistance = (enrolled, descriptor) => Math.min(...enrolled.map((e) => distance(e, descriptor)));

export function faceRoutes(db, auth) {
  const r = Router();
  const fail = (res, code, error) => res.status(code).json({ error });

  r.get('/face/status', auth, requireRole('guru'), (req, res) => {
    const u = db.prepare('SELECT face_enrolled_at FROM users WHERE id=?').get(req.user.id);
    const s = db.prepare('SELECT face_liveness FROM school WHERE id=1').get();
    res.json({ enrolled: !!u.face_enrolled_at, liveness: s ? !!s.face_liveness : true });
  });

  // Pendaftaran wajah: tiga deskriptor yang konsisten + satu foto. Daftar ulang hanya setelah admin mereset.
  r.post('/face/enroll', auth, requireRole('guru'), (req, res) => {
    const d = z.object({ descriptors: z.array(descriptorSchema).length(3), photo: z.string().max(500_000) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data wajah tidak valid');
    if (db.prepare('SELECT face_enrolled_at FROM users WHERE id=?').get(req.user.id).face_enrolled_at) {
      return fail(res, 409, 'Wajah sudah terdaftar. Minta admin mereset bila perlu mendaftar ulang.');
    }
    const buf = decodeJpegDataUrl(d.data.photo);
    if (!buf) return fail(res, 400, 'Foto tidak valid (JPEG, maks 300 KB)');
    const ds = d.data.descriptors;
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      if (distance(ds[i], ds[j]) > ENROLL_CONSISTENCY) return fail(res, 400, 'Ketiga pose tidak terlihat seperti wajah yang sama. Ulangi di tempat terang.');
    }
    const name = savePhoto(buf);
    db.prepare("UPDATE users SET face_descriptors=?, face_photo=?, face_enrolled_at=datetime('now') WHERE id=?").run(JSON.stringify(ds), name, req.user.id);
    res.status(201).json({ enrolled: true });
  });

  r.delete('/users/:id/face', auth, requireRole('admin'), (req, res) => {
    const u = db.prepare('SELECT id, face_photo FROM users WHERE id=?').get(req.params.id);
    if (!u) return fail(res, 404, 'Pengguna tidak ditemukan');
    db.prepare('UPDATE users SET face_descriptors=NULL, face_photo=NULL, face_enrolled_at=NULL WHERE id=?').run(u.id);
    deletePhoto(u.face_photo);
    res.json({ ok: true });
  });

  r.get('/users/:id/face-photo', auth, (req, res) => {
    const u = db.prepare('SELECT id, face_photo FROM users WHERE id=?').get(req.params.id);
    const allowed = u && (u.id === req.user.id || ['admin', 'kepsek'].includes(req.user.role));
    if (!allowed || !photoExists(u.face_photo)) return fail(res, 404, 'Foto tidak ditemukan');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.type('image/jpeg').sendFile(photoPath(u.face_photo));
  });

  return r;
}
