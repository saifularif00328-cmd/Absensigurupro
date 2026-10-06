// Jembatan ke aplikasi Android "Ujian Aman" (WebView). Di browser biasa semuanya no-op.
export const native = () => {
  const n = typeof window !== 'undefined' ? window.UjianAman : null;
  try { return n && typeof n.isAvailable === 'function' && n.isAvailable() ? n : null; } catch { return null; }
};
export const inSafeApp = () => !!native();
export const safeHeaders = () => (inSafeApp() ? { 'x-safe-mode': '1' } : {});

export function enterExam() { try { native()?.enterExam(); } catch { /* aplikasi lama tanpa fitur ini */ } }
export function exitExam() { try { native()?.exitExam(); } catch { /* abaikan */ } }

// Peristiwa dari aplikasi: 'keluar_aplikasi' | 'split_screen' | 'kiosk_lepas'. Mengembalikan fungsi berhenti-berlangganan.
export function onNativeEvent(cb) {
  window.__ujianAmanEvent = cb;
  return () => { if (window.__ujianAmanEvent === cb) delete window.__ujianAmanEvent; };
}

// Lokasi lewat aplikasi (membawa penanda lokasi palsu). Resolve { lat, lng, accuracy, mock }; reject Error berpesan ramah.
const pendingLoc = new Map();
export function nativeLocation(timeoutMs = 30000) {
  const n = native();
  if (!n) return Promise.reject(new Error('Bukan di aplikasi'));
  if (!window.__ujianAmanLocation) {
    window.__ujianAmanLocation = (id, data) => { const p = pendingLoc.get(id); if (p) { pendingLoc.delete(id); p(data); } };
  }
  const id = `loc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingLoc.delete(id); reject(new Error('Lokasi tidak ditemukan. Coba di area terbuka.')); }, timeoutMs);
    pendingLoc.set(id, (data) => {
      clearTimeout(timer);
      if (data && data.ok) resolve({ lat: data.lat, lng: data.lng, accuracy: data.accuracy >= 0 ? data.accuracy : undefined, mock: !!data.mock });
      else reject(new Error(data?.error || 'Lokasi tidak tersedia'));
    });
    try { n.requestLocation(id); } catch { pendingLoc.delete(id); clearTimeout(timer); reject(new Error('Gagal meminta lokasi')); }
  });
}
