import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(file = process.env.DB_FILE || join(here, '..', 'data.db')) {
  const db = new Database(file);
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  return db;
}
