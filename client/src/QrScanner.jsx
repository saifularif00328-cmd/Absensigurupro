import { useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import { useCamera } from './Camera.jsx';

// Memindai QR lewat kamera belakang. BarcodeDetector bila ada, jsQR sebagai cadangan (iOS).
export default function QrScanner({ onToken, onCancel }) {
  const { videoRef, error, ready } = useCamera('environment');
  const done = useRef(false);

  useEffect(() => {
    if (!ready) return;
    const v = videoRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    let raf = 0, last = 0;

    const tick = async (now) => {
      raf = requestAnimationFrame(tick);
      if (done.current || now - last < 120 || !v.videoWidth) return; // ±8 fps
      last = now;
      let text = null;
      try {
        if (detector) {
          text = (await detector.detect(v))[0]?.rawValue ?? null;
        } else {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          text = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data ?? null;
        }
      } catch { /* frame belum siap */ }
      if (text && !done.current) {
        done.current = true;
        onToken(text);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, videoRef, onToken]);

  return (
    <div className="modal">
      <p>Arahkan kamera ke QR di layar sekolah</p>
      {error ? <p className="err">{error}</p> : <video ref={videoRef} muted className="preview" />}
      <button className="secondary" onClick={onCancel}>Batal</button>
    </div>
  );
}
