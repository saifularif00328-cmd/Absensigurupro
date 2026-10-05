import { useCallback, useEffect, useRef, useState } from 'react';

// Membuka kamera (default: depan) dan membersihkan stream saat unmount.
export function useCamera(facing = 'user') {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return setError('Kamera tidak tersedia (butuh HTTPS atau localhost)');
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current;
        v.srcObject = stream;
        v.setAttribute('playsinline', 'true');
        await v.play();
        setReady(true);
      } catch {
        setError('Izin kamera ditolak atau kamera tidak ditemukan');
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  // Ambil frame saat ini sebagai JPEG data URL (maks sisi panjang 640 px)
  const snapshot = useCallback((maxSide = 640, quality = 0.7) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const k = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k);
    c.height = Math.round(v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }, []);

  return { videoRef, error, ready, snapshot };
}

export function SelfieCapture({ onCapture, onCancel }) {
  const { videoRef, error, ready, snapshot } = useCamera('user');
  return (
    <div className="modal">
      <p>Ambil foto selfie untuk absen</p>
      {error ? <p className="err">{error}</p> : <video ref={videoRef} muted className="preview mirror" />}
      <div className="row">
        <button disabled={!ready} onClick={() => onCapture(snapshot())}>Ambil foto</button>
        <button className="secondary" onClick={onCancel}>Batal</button>
      </div>
    </div>
  );
}
