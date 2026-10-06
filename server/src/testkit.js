// Peralatan bersama untuk tes server: aplikasi di memori, klien HTTP kecil, dan data wajah sintetis.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';

process.env.SELFIE_DIR ??= mkdtempSync(join(tmpdir(), 'selfie-'));
const { openDb } = await import('./db.js');
const { createApp } = await import('./app.js');

export const SEKOLAH = { lat: -6.2, lng: 106.8 };
export const DEV = 'device-aaaaaaaa';
export const JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64');
// Deskriptor sintetis: jarak Euclidean ke desc(0) persis |offset|
export const desc = (offset = 0) => Array.from({ length: 128 }, (_, i) => (i === 0 ? offset : 0));
export const ENROLL = { descriptors: [desc(0), desc(0.05), desc(-0.05)], photo: JPEG };

export async function setup({ school = {}, users } = {}) {
  const db = openDb(':memory:');
  const h = bcrypt.hashSync('password123', 4);
  for (const [u, n, role] of users ?? [['admin', 'Admin', 'admin'], ['kepsek', 'Kepsek', 'kepsek'], ['guru1', 'Ani', 'guru'], ['guru2', 'Budi', 'guru']]) {
    db.prepare('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)').run(u, h, n, role);
  }
  db.prepare(`INSERT INTO school (id,name,lat,lng,geofence_radius_m,work_start,late_tolerance_min)
    VALUES (1,'SMA Uji',?,?,100,?,?)`).run(school.lat ?? SEKOLAH.lat, school.lng ?? SEKOLAH.lng, school.work_start ?? '00:00', school.late_tolerance_min ?? 1440);
  const server = createApp(db).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const call = async (path, { method = 'GET', body, token, raw, headers, rawBody } = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(rawBody ? {} : { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }), ...headers },
      body: rawBody ?? (body && JSON.stringify(body)),
    });
    return raw ? r : { status: r.status, json: await r.json().catch(() => ({})) };
  };
  const login = async (u, p = 'password123') => (await call('/api/auth/login', { method: 'POST', body: { username: u, password: p } })).json.token;
  const tokens = {};
  for (const [u] of users ?? [['admin'], ['kepsek'], ['guru1'], ['guru2']]) tokens[u] = await login(u);
  const userId = (username) => db.prepare('SELECT id FROM users WHERE username=?').get(username).id;
  const enroll = (token, body = ENROLL) => call('/api/face/enroll', { method: 'POST', token, body });
  const checkIn = (token, extra = {}) => call('/api/attendance/check-in', {
    method: 'POST', token, body: { method: 'selfie', ...SEKOLAH, device_id: DEV, selfie: JPEG, descriptor: desc(0.1), ...extra },
  });
  return { db, server, call, login, t: tokens, userId, enroll, checkIn, close: () => { server.closeAllConnections?.(); server.close(); } };
}
