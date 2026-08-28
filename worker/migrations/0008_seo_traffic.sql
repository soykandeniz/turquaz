CREATE TABLE IF NOT EXISTS seo_traffic_daily (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  source TEXT NOT NULL,
  referrer_host TEXT NOT NULL DEFAULT '',
  medium TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  visits INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (day, path, source, referrer_host, medium, campaign)
);

CREATE INDEX IF NOT EXISTS idx_seo_traffic_daily_day
  ON seo_traffic_daily(day DESC);