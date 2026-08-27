CREATE TABLE public_rate_limits (
  client_key TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL
);
