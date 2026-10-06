// Fungsi murni untuk menilai "orang hidup" dari 68 titik landmark wajah (face-api).
// Dipisah dari kamera/TensorFlow agar bisa diuji unit.

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Rasio bukaan mata (EAR): ~0,28-0,35 saat terbuka, <0,2 saat terpejam
export function eyeAspectRatio(p) { // p: 6 titik mata berurutan
  return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]));
}

export function meanEar(lm) { // lm: array 68 titik {x,y}
  return (eyeAspectRatio(lm.slice(36, 42)) + eyeAspectRatio(lm.slice(42, 48))) / 2;
}

// Posisi hidung relatif terhadap rahang: ~0,5 menghadap depan; menjauh dari 0,5 saat menoleh
export function yawRatio(lm) {
  const left = lm[0].x, right = lm[16].x;
  return (lm[30].x - left) / (right - left);
}

export const CHALLENGES = ['kedip', 'toleh'];
export const CHALLENGE_TEXT = { kedip: 'Kedipkan mata Anda', toleh: 'Tolehkan kepala ke kiri atau kanan, lalu hadap depan' };

// Mesin keadaan sederhana: umpankan satu frame demi satu frame; done=true saat tantangan terpenuhi.
export function createChallenge(kind) {
  let maxEar = 0, closed = false, sawFront = false, turned = false;
  return {
    kind,
    done: false,
    update(lm) {
      if (this.done) return true;
      if (kind === 'kedip') {
        const ear = meanEar(lm);
        maxEar = Math.max(maxEar * 0.995, ear);          // acuan "mata terbuka" menyesuaikan diri
        if (maxEar < 0.2) return false;                   // belum ada pembacaan mata terbuka yang wajar
        if (!closed && ear < maxEar * 0.72) closed = true;
        else if (closed && ear > maxEar * 0.88) this.done = true;
      } else {
        const off = Math.abs(yawRatio(lm) - 0.5);
        if (!sawFront && off < 0.08) sawFront = true;
        else if (sawFront && !turned && off > 0.16) turned = true;
        else if (turned && off < 0.09) this.done = true;
      }
      return this.done;
    },
  };
}

export const randomChallenge = () => CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
