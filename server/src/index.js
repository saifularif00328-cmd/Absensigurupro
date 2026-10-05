import { openDb } from './db.js';
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const db = openDb();
const port = Number(process.env.PORT) || 3000;
const app = createApp(db);
// Produksi: sajikan hasil build klien dari server yang sama
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}
app.listen(port, () => console.log(`Server jalan di http://localhost:${port}`));
