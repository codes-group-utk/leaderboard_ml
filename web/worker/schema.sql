CREATE TABLE IF NOT EXISTS daily_cases (
  date TEXT NOT NULL,
  case_id INTEGER NOT NULL,
  airfoil TEXT NOT NULL,
  mach REAL NOT NULL,
  reynolds REAL NOT NULL,
  aoa REAL NOT NULL,
  coordinates_json TEXT NOT NULL,
  cl REAL NOT NULL,
  cd REAL NOT NULL,
  PRIMARY KEY (date, case_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  group_name TEXT,
  score REAL NOT NULL,
  total_error REAL NOT NULL,
  correct_cases INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (date, email)
);

CREATE INDEX IF NOT EXISTS idx_submissions_date_score
  ON submissions (date, score DESC, total_error ASC, created_at ASC);
