const TZ = process.env.SCHOOL_TZ || 'Asia/Jakarta';

// Tanggal & jam dinding di zona waktu sekolah
export function localParts(d = new Date(), tz = TZ) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Daftar tanggal YYYY-MM-DD dari a..b (inklusif), maksimal 366 hari
export function dateRange(a, b) {
  const out = [];
  const cur = new Date(a + 'T00:00:00Z'), end = new Date(b + 'T00:00:00Z');
  while (cur <= end && out.length < 366) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export const isWeekend = (ymd) => [0, 6].includes(new Date(ymd + 'T00:00:00Z').getUTCDay());
