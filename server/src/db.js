import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// node:sqlite bawaan Node (tanpa kompilasi native). Menambah transaction() agar kode lama tetap sama.
class Db extends DatabaseSync {
  #depth = 0;

  transaction(fn) {
    return (...args) => {
      const outer = this.#depth === 0, sp = `sp${this.#depth}`;
      this.exec(outer ? 'BEGIN' : `SAVEPOINT ${sp}`);
      this.#depth++;
      try {
        const out = fn(...args);
        this.#depth--;
        this.exec(outer ? 'COMMIT' : `RELEASE ${sp}`);
        return out;
      } catch (e) {
        this.#depth--;
        this.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      }
    };
  }
}

export function openDb(file = process.env.DB_FILE || join(here, '..', 'data.db')) {
  const db = new Db(file);
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

// Pelanggaran UNIQUE/PRIMARY KEY (kode galat bawaan node:sqlite: ERR_SQLITE_ERROR + errcode)
export const isUniqueViolation = (e) => /UNIQUE constraint failed|PRIMARY KEY/i.test(String(e?.message)) || [2067, 1555].includes(e?.errcode);
