export async function api(path, { method = 'GET', body, token = localStorage.getItem('token') } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Permintaan gagal'), { status: res.status });
  return data;
}

export async function download(path, filename) {
  const res = await fetch('/api' + path, { headers: { authorization: `Bearer ${localStorage.getItem('token')}` } });
  if (!res.ok) throw new Error('Unduhan gagal');
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

// ID perangkat stabil per browser/HP (1 perangkat per guru)
export function deviceId() {
  let id = localStorage.getItem('device_id');
  if (!id) localStorage.setItem('device_id', (id = crypto.randomUUID()));
  return id;
}

// Antrean absen offline: disimpan lokal dengan waktu perangkat, dikirim saat online
const QKEY = 'pending_attendance';
export const pending = () => JSON.parse(localStorage.getItem(QKEY) || '[]');
const savePending = (q) => localStorage.setItem(QKEY, JSON.stringify(q));
// Mengembalikan false bila penyimpanan lokal penuh (selfie cukup besar)
export function enqueue(item) {
  try {
    savePending([...pending(), item]);
    return true;
  } catch {
    return false;
  }
}

// Ambil gambar berotorisasi sebagai object URL (untuk <img>)
export async function fetchImageUrl(path) {
  const res = await fetch('/api' + path, { headers: { authorization: `Bearer ${localStorage.getItem('token')}` } });
  if (!res.ok) throw new Error('Gambar tidak tersedia');
  return URL.createObjectURL(await res.blob());
}

export async function flushPending() {
  const left = [];
  let synced = 0, lastError = '';
  for (const item of pending()) {
    try {
      await api(item.path, { method: 'POST', body: item.body });
      synced++;
    } catch (e) {
      if (!e.status || e.status >= 500) left.push(item); // jaringan/server: coba lagi nanti
      else lastError = e.message;                        // ditolak server: buang agar tidak macet
    }
  }
  savePending(left);
  return { synced, remaining: left.length, lastError };
}

// Baca SSE lewat fetch agar header Authorization tetap dipakai. Berhenti saat signal dibatalkan.
export async function streamEvents(path, onEvent, signal) {
  const res = await fetch('/api' + path, { headers: { authorization: `Bearer ${localStorage.getItem('token')}` }, signal });
  if (!res.ok) throw new Error('Tidak bisa terhubung ke pemantauan');
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const c of parts) if (c.startsWith('data: ')) onEvent(JSON.parse(c.slice(6)));
  }
}
