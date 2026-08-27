CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  source_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  reservation_date TEXT NOT NULL,
  reservation_time TEXT NOT NULL,
  guests INTEGER NOT NULL CHECK (guests BETWEEN 1 AND 15),
  note TEXT NOT NULL DEFAULT '',
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner')),
  manage_token TEXT UNIQUE,
  token_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
  canceled_at TEXT
);

CREATE INDEX idx_reservations_schedule
  ON reservations (reservation_date, reservation_time, status);

CREATE INDEX idx_reservations_created
  ON reservations (created_at DESC);
