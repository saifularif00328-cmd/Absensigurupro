import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ScanFace, X } from 'lucide-react';
import { useCamera } from '../Camera.jsx';
import { detectFrame, descriptorOf, loadFace } from './faceEngine.js';
import { CHALLENGE_TEXT, createChallenge, randomChallenge } from './liveness.js';

const ENROLL_PROMPTS = ['Hadap lurus ke kamera', 'Hadap lurus lalu tersenyum', 'Hadap lurus, miringkan kepala sedikit'];

// mode "verify": satu foto + deskriptor untuk absen. mode "enroll": tiga foto + deskriptor untuk pendaftaran.
export default function FaceCapture({ mode = 'verify', liveness = true, onDone, onCancel }) {
  const { videoRef, error: camError, ready, grab } = useCamera('user');
  const [status, setStatus] = useState('Memuat model wajah…');
  const [stage, setStage] = useState('loading');            // loading | challenge | capturing | done
  const [challenge, setChallenge] = useState(null);
  const [captured, setCaptured] = useState(0);
  const [err, setErr] = useState('');
  const doneRef = useRef(false);
  const doneCb = useRef(onDone);
  doneCb.current = onDone;                       // agar efek tidak mulai ulang bila induk membuat fungsi baru

  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    (async () => {
      let faceapi;
      try { faceapi = await loadFace(); } catch { if (alive) setErr('Model wajah gagal dimuat. Periksa koneksi lalu coba lagi.'); return; }
      const kind = liveness ? randomChallenge() : null;
      const tracker = kind ? createChallenge(kind) : null;
      if (alive) { setChallenge(kind); setStage(kind ? 'challenge' : 'capturing'); }
      const shots = [], photos = [];
      let passed = !kind, lastShot = 0;
      const need = mode === 'enroll' ? 3 : 1;

      const loop = async () => {
        if (!alive || doneRef.current) return;
        const v = videoRef.current;
        let wait = 140;
        try {
          const f = v && v.videoWidth ? await detectFrame(faceapi, v) : { count: 0 };
          if (!alive) return;
          if (f.count === 0) setStatus('Wajah tidak terlihat. Hadapkan wajah ke kamera.');
          else if (f.count > 1) setStatus('Hanya boleh satu wajah di layar.');
          else if (f.box.width < v.videoWidth * 0.22) setStatus('Terlalu jauh. Dekatkan wajah.');
          else {
            if (!passed) {
              setStatus(CHALLENGE_TEXT[kind]);
              passed = tracker.update(f.landmarks);
              if (passed) { setStage('capturing'); setStatus('Bagus! Tahan sebentar…'); }
            } else if (Date.now() - lastShot > 900) {
              setStatus(mode === 'enroll' ? ENROLL_PROMPTS[shots.length] : 'Tahan, mengambil foto…');
              const canvas = grab(640);
              const d = canvas && await descriptorOf(faceapi, canvas);
              if (d) {
                shots.push(d);
                photos.push(canvas.toDataURL('image/jpeg', 0.7));
                lastShot = Date.now();
                if (alive) setCaptured(shots.length);
                if (shots.length >= need) {
                  doneRef.current = true;
                  if (alive) { setStage('done'); setStatus('Selesai'); }
                  doneCb.current(mode === 'enroll' ? { descriptors: shots, photo: photos[0] } : { descriptor: shots[0], selfie: photos[0] });
                  return;
                }
                wait = 700;
              }
            }
          }
        } catch { /* frame gagal diproses; coba lagi */ }
        if (alive) setTimeout(loop, wait);
      };
      loop();
    })();
    return () => { alive = false; };
  }, [ready, liveness, mode, grab, videoRef]);

  const need = mode === 'enroll' ? 3 : 1;
  return (
    <div className="modal facecap" role="dialog" aria-label={mode === 'enroll' ? 'Daftarkan wajah' : 'Verifikasi wajah'}>
      <h2><ScanFace size={22} /> {mode === 'enroll' ? 'Daftarkan wajah Anda' : 'Verifikasi wajah'}</h2>
      {camError || err ? <p className="err" role="alert">{camError || err}</p> : (
        <div className="faceview">
          <video ref={videoRef} muted className="preview mirror" />
          <div className={`oval ${stage}`} aria-hidden="true" />
        </div>
      )}
      {!camError && !err && (
        <>
          <p className="facestatus" role="status" aria-live="polite">{status}</p>
          <div className="statusline">
            {liveness && challenge && <span className={`tag ${stage === 'capturing' || stage === 'done' ? 'ok' : 'run'}`}>{stage === 'challenge' ? `Tantangan: ${challenge}` : <><CheckCircle2 size={14} /> Tantangan lulus</>}</span>}
            <span className="tag">{captured}/{need} foto</span>
          </div>
        </>
      )}
      <button className="secondary" onClick={onCancel}><X size={16} /> Batal</button>
    </div>
  );
}
