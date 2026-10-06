// Memuat face-api secara lazy (hanya saat layar wajah dibuka) dan menyediakan deteksi + deskriptor 128 dimensi.
let loading;
export function loadFace() {
  loading ??= (async () => {
    const faceapi = await import('@vladmandic/face-api');
    try { await faceapi.tf.setBackend('webgl'); await faceapi.tf.ready(); } catch { await faceapi.tf.setBackend('cpu'); await faceapi.tf.ready(); }
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    ]);
    return faceapi;
  })().catch((e) => { loading = undefined; throw e; });
  return loading;
}

// Unduh model di latar belakang agar tersimpan di cache peramban (absen tetap bisa saat offline)
export function prefetchFaceModels() {
  const files = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'].flatMap((n) => [`${n}-weights_manifest.json`, `${n}.bin`]);
  files.forEach((f) => fetch(`/models/${f}`).catch(() => {}));
}

// TinyFaceDetector paling akurat bila ukuran masukan sesuai besar wajah: selfie (wajah besar) cocok di 320/224,
// wajah yang lebih kecil/jauh di 416. Coba berurutan; berhenti di ukuran pertama yang menemukan wajah.
const SIZES = [320, 224, 416];
const opts = (faceapi, inputSize) => new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.5 });

// Deteksi cepat untuk umpan balik/liveness: { count: 0 } atau { count, box, landmarks, score } untuk wajah terbaik
export async function detectFrame(faceapi, source) {
  for (const size of SIZES) {
    const all = await faceapi.detectAllFaces(source, opts(faceapi, size)).withFaceLandmarks();
    if (!all.length) continue;
    const best = all.reduce((a, b) => (a.detection.score >= b.detection.score ? a : b));
    return { count: all.length, box: best.detection.box, landmarks: best.landmarks.positions, score: best.detection.score };
  }
  return { count: 0 };
}

// Deskriptor 128 angka dari satu frame (kanvas); null bila tidak ada wajah
export async function descriptorOf(faceapi, canvas) {
  for (const size of SIZES) {
    const r = await faceapi.detectSingleFace(canvas, opts(faceapi, size)).withFaceLandmarks().withFaceDescriptor();
    if (r) return Array.from(r.descriptor);
  }
  return null;
}
