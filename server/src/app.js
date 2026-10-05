import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { signToken, requireAuth, requireRole } from './auth.js';

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
  app.use(helmet(), cors(), express.json({ limit: '1mb' }));
  const auth = requireAuth(db);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/auth/login', (req, res) => {
    const d = parse(z.object({ username: z.string().min(1), password: z.string().min(1) }), req.body, res);
    if (!d) return;
    const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(d.username);
    if (!u || !bcrypt.compareSync(d.password, u.password_hash)) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }
    res.json({
      token: signToken(u),
      user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, is_wali_kelas: u.is_wali_kelas },
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
    }), req.body, res);
    if (!d) return;
    db.prepare(`INSERT INTO school (id,name,address,kop_lines,lat,lng,geofence_radius_m,work_start,work_end,late_tolerance_min,ai_enabled)
      VALUES (1,@name,@address,@kop,@lat,@lng,@geofence_radius_m,@work_start,@work_end,@late_tolerance_min,@ai)
      ON CONFLICT(id) DO UPDATE SET name=@name,address=@address,kop_lines=@kop,lat=@lat,lng=@lng,
        geofence_radius_m=@geofence_radius_m,work_start=@work_start,work_end=@work_end,
        late_tolerance_min=@late_tolerance_min,ai_enabled=@ai`)
      .run({ ...d, kop: JSON.stringify(d.kop_lines), ai: d.ai_enabled ? 1 : 0 });
    res.json(db.prepare('SELECT * FROM school WHERE id=1').get());
  });

  // Manajemen pengguna (admin)
  app.get('/api/users', auth, requireRole('admin', 'kepsek'), (_req, res) =>
    res.json(db.prepare('SELECT id,username,full_name,nip,role,is_wali_kelas,active FROM users ORDER BY full_name').all()));

  app.post('/api/users', auth, requireRole('admin'), (req, res) => {
    const d = parse(z.object({
      username: z.string().min(3), password: z.string().min(8),
      full_name: z.string().min(1), nip: z.string().optional(),
      role: z.enum(['admin', 'kepsek', 'guru']), is_wali_kelas: z.boolean().default(false),
    }), req.body, res);
    if (!d) return;
    try {
      const r = db.prepare('INSERT INTO users (username,password_hash,full_name,nip,role,is_wali_kelas) VALUES (?,?,?,?,?,?)')
        .run(d.username, bcrypt.hashSync(d.password, 10), d.full_name, d.nip ?? null, d.role, d.is_wali_kelas ? 1 : 0);
      res.status(201).json({ id: r.lastInsertRowid });
    } catch (e) {
      if (String(e.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Username sudah dipakai' });
      throw e;
    }
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Kesalahan server' });
  });
  return app;
}
