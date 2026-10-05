PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Satu instalasi = satu sekolah (id selalu 1)
CREATE TABLE IF NOT EXISTS school (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  logo_path TEXT,
  kop_lines TEXT NOT NULL DEFAULT '[]',        -- JSON array baris kop surat
  lat REAL, lng REAL,
  geofence_radius_m INTEGER NOT NULL DEFAULT 100,
  work_start TEXT NOT NULL DEFAULT '07:00',
  work_end TEXT NOT NULL DEFAULT '14:00',
  late_tolerance_min INTEGER NOT NULL DEFAULT 10,
  ai_enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  nip TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','kepsek','guru')),
  is_wali_kelas INTEGER NOT NULL DEFAULT 0,
  device_id TEXT,                               -- 1 perangkat per guru
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Absensi GURU
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,                           -- YYYY-MM-DD (waktu sekolah)
  check_in TEXT, check_out TEXT,                -- ISO timestamp
  method TEXT CHECK (method IN ('gps','qr','selfie','manual')),
  lat REAL, lng REAL,
  selfie_path TEXT,
  status TEXT NOT NULL DEFAULT 'hadir' CHECK (status IN ('hadir','terlambat','izin','sakit','cuti','dinas','alpa')),
  late_synced INTEGER NOT NULL DEFAULT 0,       -- disinkron terlambat dari offline
  UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('izin','sakit','cuti','dinas')),
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  attachment_path TEXT,
  substitute_user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY, name TEXT NOT NULL
);

-- Akademik
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  level TEXT,
  wali_user_id INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nis TEXT UNIQUE,
  name TEXT NOT NULL,
  class_id INTEGER REFERENCES classes(id),
  access_code TEXT                              -- kode masuk ujian siswa
);
CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time TEXT NOT NULL, end_time TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS teaching_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedule(id),
  date TEXT NOT NULL,
  checked_in_at TEXT,
  topic TEXT NOT NULL DEFAULT '',
  UNIQUE (schedule_id, date)
);
CREATE TABLE IF NOT EXISTS student_absence_summary (   -- rekap S/I/A untuk rapor
  student_id INTEGER NOT NULL REFERENCES students(id),
  term TEXT NOT NULL,
  sakit INTEGER NOT NULL DEFAULT 0,
  izin INTEGER NOT NULL DEFAULT 0,
  alpa INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (student_id, term)
);

-- Ujian (fase 2)
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  subject_id INTEGER REFERENCES subjects(id),
  type TEXT NOT NULL CHECK (type IN ('pg','bs','isian','uraian')),
  body TEXT NOT NULL,
  options TEXT,                                 -- JSON
  answer_key TEXT,                              -- JSON
  points REAL NOT NULL DEFAULT 1,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id),
  class_id INTEGER REFERENCES classes(id),
  kind TEXT NOT NULL DEFAULT 'harian' CHECK (kind IN ('harian','uts','uas')),
  token TEXT UNIQUE,
  duration_min INTEGER NOT NULL DEFAULT 60,
  starts_at TEXT, ends_at TEXT,
  require_safe_mode INTEGER NOT NULL DEFAULT 0,
  max_violations INTEGER NOT NULL DEFAULT 3,
  shuffle INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS exam_questions (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (exam_id, question_id)
);
CREATE TABLE IF NOT EXISTS exam_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  started_at TEXT NOT NULL, submitted_at TEXT,
  violations INTEGER NOT NULL DEFAULT 0,
  score REAL,
  UNIQUE (exam_id, student_id)
);
CREATE TABLE IF NOT EXISTS answers (
  session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  response TEXT, score REAL, graded_by INTEGER REFERENCES users(id),
  PRIMARY KEY (session_id, question_id)
);
CREATE TABLE IF NOT EXISTS violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Nilai & rapor
CREATE TABLE IF NOT EXISTS grades (
  student_id INTEGER NOT NULL REFERENCES students(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  term TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('harian','uts','uas')),
  exam_id INTEGER REFERENCES exams(id),
  score REAL NOT NULL,
  PRIMARY KEY (student_id, subject_id, term, kind, exam_id)
);
CREATE TABLE IF NOT EXISTS grade_weights (
  subject_id INTEGER PRIMARY KEY REFERENCES subjects(id),
  harian REAL NOT NULL DEFAULT 0.4, uts REAL NOT NULL DEFAULT 0.3, uas REAL NOT NULL DEFAULT 0.3
);
