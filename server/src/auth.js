import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret-ganti-di-produksi';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET wajib diset di production');
}

const MUST_CHANGE_ALLOWED = ['/api/me', '/api/auth/change-password'];

export const signToken = (u) =>
  jwt.sign({ sub: u.id, role: u.role }, SECRET, { expiresIn: '12h' });

export function requireAuth(db) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    try {
      const p = jwt.verify(h.replace(/^Bearer /, ''), SECRET);
      const user = db.prepare('SELECT id,username,full_name,role,is_wali_kelas,active,must_change_password FROM users WHERE id=?').get(p.sub);
      if (!user || !user.active) throw new Error('inactive');
      req.user = user;
      // Akun baru/hasil reset hanya boleh membuka profil dan mengganti password
      if (user.must_change_password && !MUST_CHANGE_ALLOWED.includes(req.originalUrl.split('?')[0])) {
        return res.status(403).json({ error: 'Ganti password terlebih dahulu', must_change_password: true });
      }
      next();
    } catch {
      res.status(401).json({ error: 'Belum login atau sesi berakhir' });
    }
  };
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Akses ditolak' });
