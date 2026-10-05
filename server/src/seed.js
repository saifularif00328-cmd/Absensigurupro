import bcrypt from 'bcryptjs';
import { openDb } from './db.js';

const db = openDb();
const pw = process.env.ADMIN_PASSWORD || 'admin12345';
db.prepare("INSERT OR IGNORE INTO school (id,name) VALUES (1,'Nama Sekolah')").run();
db.prepare("INSERT OR IGNORE INTO users (username,password_hash,full_name,role) VALUES ('admin',?,'Administrator','admin')")
  .run(bcrypt.hashSync(pw, 10));
console.log('Seed selesai. Login: admin /', pw, '(segera ganti)');
