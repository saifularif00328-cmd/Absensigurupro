import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.APK_DIR = mkdtempSync(join(tmpdir(), 'apk-'));
const { setup } = await import('./testkit.js');

test('unduh APK: belum ada -> 404 & app-info false; ada -> tipe berkas Android & publik', async () => {
  const s = await setup();
  assert.deepEqual((await s.call('/api/app-info')).json, { apk: false });
  assert.equal((await s.call('/unduh/ujian-aman.apk', { raw: true })).status, 404);
  writeFileSync(join(process.env.APK_DIR, 'ujian-aman.apk'), Buffer.from('PK\x03\x04-apk-uji'));
  const info = (await s.call('/api/app-info')).json;
  assert.equal(info.apk, true);
  assert.ok(info.size > 0);
  const r = await s.call('/unduh/ujian-aman.apk', { raw: true });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.match(r.headers.get('content-disposition'), /ujian-aman\.apk/);
  assert.equal(Buffer.from(await r.arrayBuffer()).slice(0, 2).toString(), 'PK');
  s.close();
});
