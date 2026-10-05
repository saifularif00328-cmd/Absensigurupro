import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from './db.js';
import { createApp } from './app.js';

async function setup() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (username,password_hash,full_name,role) VALUES ('admin',?,'Admin','admin')").run(bcrypt.hashSync('admin12345', 4));
  db.prepare("INSERT INTO users (username,password_hash,full_name,role) VALUES ('guru1',?,'Guru Satu','guru')").run(bcrypt.hashSync('guru12345', 4));
  const server = createApp(db).listen(0);
  const base = `http://localhost:${server.address().port}`;
  const call = async (path, { method = 'GET', body, token } = {}) => {
    const r = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    });
    return { status: r.status, json: await r.json() };
  };
  const login = async (u, p) => (await call('/api/auth/login', { method: 'POST', body: { username: u, password: p } })).json.token;
  return { call, login, close: () => server.close() };
}

test('login salah ditolak, login benar mengembalikan token', async () => {
  const { call, close } = await setup();
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'x' } })).status, 401);
  const ok = await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin12345' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token);
  close();
});

test('endpoint butuh login dan role', async () => {
  const { call, login, close } = await setup();
  assert.equal((await call('/api/me')).status, 401);
  const guru = await login('guru1', 'guru12345');
  assert.equal((await call('/api/users', { token: guru })).status, 403);
  assert.equal((await call('/api/school', { method: 'PUT', token: guru, body: { name: 'X' } })).status, 403);
  close();
});

test('admin membuat guru dan mengatur sekolah', async () => {
  const { call, login, close } = await setup();
  const t = await login('admin', 'admin12345');
  const c = await call('/api/users', { method: 'POST', token: t, body: { username: 'budi', password: 'rahasia123', full_name: 'Budi', role: 'guru' } });
  assert.equal(c.status, 201);
  assert.equal((await call('/api/users', { method: 'POST', token: t, body: { username: 'budi', password: 'rahasia123', full_name: 'B', role: 'guru' } })).status, 409);
  assert.equal((await call('/api/users', { method: 'POST', token: t, body: { username: 'x', password: 'pendek', full_name: 'B', role: 'guru' } })).status, 400);
  const s = await call('/api/school', { method: 'PUT', token: t, body: { name: 'SMA 1', lat: -6.2, lng: 106.8, geofence_radius_m: 150 } });
  assert.equal(s.json.geofence_radius_m, 150);
  close();
});
