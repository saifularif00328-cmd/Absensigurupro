import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { signToken, requireAuth, requireRole } from './auth.js';
import { isUniqueViolation } from './db.js';
import { attendanceRoutes } from './attendance.js';
import { academicRoutes } from './academic.js';
import { examRoutes } from './exams.js';
import { studentExamRoutes } from './studentExam.js';
import { reportRoutes } from './reports.js';
import { accountRoutes, createLoginLimiter } from './accounts.js';
import { faceRoutes } from './face.js';
import { importRoutes } from './importer.js';

const parse = (schema, body, res) => {
  const r = schema.safeParse(body);
  if (!r.success) {
    res.status(400).json({ error: 'Data tidak valid', details: r.error.issues });
    return null;
  }
  return r.data;
};

export function createApp(db) {
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  const limiter = createLoginLimiter();
  // blob: dibutuhkan agar foto selfie (diambil dengan header Authorization) bisa tampil di <img>
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'] } } }), cors(), express.json({ limit: '1mb' }));
  const auth = requireAuth(db);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/auth/login', (req, res) => {
    const d = parse(z.object({ username: z.string().min(1), password: z.string().min(1) }), req.body, res);
    if (!d) return;
    const wait = limiter.blockedMinutes(req.ip, d.username);
    if (wait) return res.status(429).json({ error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${wait} menit.` });
    const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(d.username);
    if (!u || !bcrypt.compareSync(d.password, u.password_hash)) {
      limiter.fail(req.ip, d.username);
      return res.status(401).json({ error: 'Username atau password salah' });
    }
    limiter.clear(req.ip, d.username);
    res.json({
      token: signToken(u),
      user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, is_wali_kelas: u.is_wali_kelas, must_change_password: !!u.must_change_password },
    });
  });

  app.get('/api/me', auth, (req, res) => res.json(req.user));

  // Profil sekolah (kop, geofence, jam kerja)
  app.get('/api/school', auth, (_req, res) => res.json(db.prepare('SELECT * FROM school WHERE id=1').get() ?? null));
  app.put('/api/school', auth, requireRole('admin'), (req, res) => {
    const d = parse(z.object({
      name: z.string().min(1), address: z.string().default(''),
      kop_lines: z.array(z.string()).default([]),
      lat: z.number().min(-90).max(90).nullable().default(null),
      lng: z.number().min(-180).max(180).nullable().default(null),
      geofence_radius_m: z.number().int().min(10).max(5000).default(100),
      work_start: z.string().regex(/^\d\d:\d\d$/).default('07:00'),
      work_end: z.string().regex(/^\d\d:\d\d$/).default('14:00'),
      late_tolerance_min: z.number().int().min(0).max(120).default(10),
      ai_enabled: z.boolean().default(false),
      face_liveness: z.boolean().default(true),
      face_threshold: z.number().min(0.4).max(0.65).default(0.55),
      current_term: z.string().max(40).default(''),
    }), req.body, res);
    if (!d) return;
    db.prepare(`INSERT INTO school (id,name,address,kop_lines,lat,lng,geofence_radius_m,work_start,work_end,late_tolerance_min,ai_enabled,face_liveness,face_threshold,current_term)
      VALUES (1,@name,@address,@kop,@lat,@lng,@geofence_radius_m,@work_start,@work_end,@late_tolerance_min,@ai,@liveness,@threshold,@term)
      ON CONFLICT(id) DO UPDATE SET name=@name,address=@address,kop_lines=@kop,lat=@lat,lng=@lng,
        geofence_radius_m=@geofence_radius_m,work_start=@work_start,work_end=@work_end,
        late_tolerance_min=@late_tolerance_min,ai_enabled=@ai,face_liveness=@liveness,face_threshold=@threshold,current_term=@term`)
      .run({
        name: d.name, address: d.address, kop: JSON.stringify(d.kop_lines), lat: d.lat, lng: d.lng,
        geofence_radius_m: d.geofence_radius_m, work_start: d.work_start, work_end: d.work_end,
        late_tolerance_min: d.late_tolerance_min, ai: d.ai_enabled ? 1 : 0, liveness: d.face_liveness ? 1 : 0, threshold: d.face_threshold, term: d.current_term,
      });
    res.json(db.prepare('SELECT * FROM school WHERE id=1').get());
  });

  // Manajemen pengguna (admin)
  app.get('/api/users', auth, requireRole('admin', 'kepsek'), (_req, res) =>
    res.json(db.prepare(`SELECT id,username,full_name,nip,role,is_wali_kelas,active,must_change_password,
      (face_enrolled_at IS NOT NULL) AS face_enrolled, (device_id IS NOT NULL) AS has_device FROM users ORDER BY full_name`).all()));

  app.post('/api/users', auth, requireRole('admin'), (req, res) => {
    const d = parse(z.object({
      username: z.string().min(3), password: z.string().min(8),
      full_name: z.string().min(1), nip: z.string().optional(),
      role: z.enum(['admin', 'kepsek', 'guru']), is_wali_kelas: z.boolean().default(false),
    }), req.body, res);
    if (!d) return;
    try {
      const r = db.prepare('INSERT INTO users (username,password_hash,full_name,nip,role,is_wali_kelas,must_change_password) VALUES (?,?,?,?,?,?,1)')
        .run(d.username, bcrypt.hashSync(d.password, 10), d.full_name, d.nip ?? null, d.role, d.is_wali_kelas ? 1 : 0);
      res.status(201).json({ id: r.lastInsertRowid });
    } catch (e) {
      if (isUniqueViolation(e)) return res.status(409).json({ error: 'Username sudah dipakai' });
      throw e;
    }
  });

  app.use('/api', accountRoutes(db, auth));
  app.use('/api', faceRoutes(db, auth));
  app.use('/api', importRoutes(db, auth));
  app.use('/api', attendanceRoutes(db, auth));
  app.use('/api', academicRoutes(db, auth));
  app.use('/api', examRoutes(db, auth));
  app.use('/api', studentExamRoutes(db));
  app.use('/api', reportRoutes(db, auth));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Kesalahan server' });
  });
  return app;
}
