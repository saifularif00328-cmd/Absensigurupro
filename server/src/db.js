import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(file = process.env.DB_FILE || join(here, '..', 'data.db')) {
  const db = new Database(file);
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

// Kolom yang ditambahkan setelah rilis awal; aman dijalankan berulang pada DB lama
const ADDED_COLUMNS = [
  ['school', 'require_selfie', 'INTEGER NOT NULL DEFAULT 0'],
  ['attendance', 'flags', "TEXT NOT NULL DEFAULT '[]'"],
  ['school', 'current_term', "TEXT NOT NULL DEFAULT ''"],
  ['exams', 'term', "TEXT NOT NULL DEFAULT ''"],
  ['exam_sessions', 'nonce', 'TEXT'],
  ['exam_sessions', 'submit_reason', 'TEXT'],
];

function migrate(db) {
  for (const [table, col, def] of ADDED_COLUMNS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}
