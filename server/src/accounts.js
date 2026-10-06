import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireRole } from './auth.js';
import { randomCode } from './util.js';

const fail = (res, code, error, extra = {}) => res.status(code).json({ error, ...extra });

// Password awal: 10 karakter tanpa karakter yang mudah tertukar (0/O, 1/I)
export const generatePassword = () => randomCode(10);

// Pembatas percobaan login (memori): 5 gagal per 15 menit per username+IP
const WINDOW_MS = 15 * 60_000, MAX_FAILS = 5;
export function createLoginLimiter(now = () => Date.now()) {
  const fails = new Map();
  const key = (ip, username) => `${ip}|${String(username).toLowerCase()}`;
  const recent = (k) => (fails.get(k) ?? []).filter((t) => now() - t < WINDOW_MS);
  return {
    blockedMinutes(ip, username) {
      const f = recent(key(ip, username));
      if (f.length < MAX_FAILS) return 0;
      return Math.max(1, Math.ceil((WINDOW_MS - (now() - f[0])) / 60_000));
    },
    fail(ip, username) { const k = key(ip, username); fails.set(k, [...recent(k), now()]); },
    clear(ip, username) { fails.delete(key(ip, username)); },
  };
}

export function accountRoutes(db, auth) {
  const r = Router();
  const admin = requireRole('admin');

  r.post('/auth/change-password', auth, (req, res) => {
    const d = z.object({ old_password: z.string().min(1), new_password: z.string().min(8).max(100) }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Password baru minimal 8 karakter');
    const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
    if (!bcrypt.compareSync(d.data.old_password, u.password_hash)) return fail(res, 403, 'Password lama salah');
    if (d.data.old_password === d.data.new_password) return fail(res, 400, 'Password baru harus berbeda dari yang lama');
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(bcrypt.hashSync(d.data.new_password, 10), req.user.id);
    res.json({ ok: true });
  });

  // Reset oleh admin: password acak tampil sekali, pengguna wajib menggantinya saat login berikutnya
  r.post('/users/:id/reset-password', auth, admin, (req, res) => {
    const u = db.prepare('SELECT id, username, full_name FROM users WHERE id=?').get(req.params.id);
    if (!u) return fail(res, 404, 'Pengguna tidak ditemukan');
    const password = generatePassword();
    db.prepare('UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?').run(bcrypt.hashSync(password, 10), u.id);
    res.json({ username: u.username, full_name: u.full_name, password });
  });

  r.patch('/users/:id', auth, admin, (req, res) => {
    const d = z.object({
      active: z.boolean().optional(), full_name: z.string().min(1).max(100).optional(),
      nip: z.string().max(40).nullable().optional(), is_wali_kelas: z.boolean().optional(),
    }).safeParse(req.body);
    if (!d.success) return fail(res, 400, 'Data tidak valid');
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) return fail(res, 404, 'Pengguna tidak ditemukan');
    if (d.data.active === false && u.id === req.user.id) return fail(res, 400, 'Anda tidak bisa menonaktifkan akun sendiri');
    db.prepare('UPDATE users SET active=?, full_name=?, nip=?, is_wali_kelas=? WHERE id=?').run(
      d.data.active === undefined ? u.active : d.data.active ? 1 : 0,
      d.data.full_name ?? u.full_name,
      d.data.nip === undefined ? u.nip : d.data.nip,
      d.data.is_wali_kelas === undefined ? u.is_wali_kelas : d.data.is_wali_kelas ? 1 : 0,
      u.id,
    );
    res.json({ ok: true });
  });

  return r;
}
