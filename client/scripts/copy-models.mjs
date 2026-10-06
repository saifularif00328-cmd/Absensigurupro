// Menyalin model pengenalan wajah dari paket npm ke public/models agar disajikan dari server sendiri (jalan tanpa internet).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
const dest = join(here, '..', 'public', 'models');
const NEED = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'];

mkdirSync(dest, { recursive: true });
let bytes = 0;
for (const name of NEED) {
  for (const ext of ['-weights_manifest.json', '.bin']) {
    const from = join(src, name + ext), to = join(dest, name + ext);
    if (!existsSync(from)) throw new Error(`Model tidak ditemukan: ${from}`);
    if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to);
    bytes += statSync(to).size;
  }
}
console.log(`Model wajah siap di public/models (${(bytes / 1048576).toFixed(1)} MB)`);
