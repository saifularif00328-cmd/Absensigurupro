import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from './db.js';

test('migrasi: DB lama tanpa kolom baru ditambah otomatis dan data tetap', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'mig-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE school (id INTEGER PRIMARY KEY CHECK (id=1), name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
    logo_path TEXT, kop_lines TEXT NOT NULL DEFAULT '[]', lat REAL, lng REAL, geofence_radius_m INTEGER NOT NULL DEFAULT 100,
    work_start TEXT NOT NULL DEFAULT '07:00', work_end TEXT NOT NULL DEFAULT '14:00', late_tolerance_min INTEGER NOT NULL DEFAULT 10,
    ai_enabled INTEGER NOT NULL DEFAULT 0);
    INSERT INTO school (id,name) VALUES (1,'Sekolah Lama');
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, full_name TEXT NOT NULL,
      nip TEXT, role TEXT NOT NULL, is_wali_kelas INTEGER NOT NULL DEFAULT 0, device_id TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL, check_in TEXT, check_out TEXT,
      method TEXT, lat REAL, lng REAL, selfie_path TEXT, status TEXT NOT NULL DEFAULT 'hadir', late_synced INTEGER NOT NULL DEFAULT 0, UNIQUE (user_id,date));`);
  old.close();
  for (let i = 0; i < 2; i++) { // dua kali: idempoten
    const db = openDb(file);
    const s = db.prepare('SELECT name, face_liveness FROM school').get();
    assert.deepEqual({ ...s }, { name: 'Sekolah Lama', face_liveness: 1 });
    const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    for (const c of ['face_descriptors', 'face_photo', 'face_enrolled_at', 'must_change_password']) assert.ok(cols('users').includes(c), c);
    for (const c of ['flags', 'face_distance']) assert.ok(cols('attendance').includes(c), c);
    db.close();
  }
});
