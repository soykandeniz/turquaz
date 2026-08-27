PRAGMA foreign_keys = ON;

CREATE TABLE content_entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('blog', 'local_page')),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  seo_title TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  social_image_url TEXT NOT NULL DEFAULT '',
  social_image_alt TEXT NOT NULL DEFAULT '',
  primary_query TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT 'Turquaz',
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (type, slug)
);

CREATE INDEX idx_content_entries_public
  ON content_entries (type, status, published_at DESC);

CREATE TABLE content_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'admin',
  FOREIGN KEY (entry_id) REFERENCES content_entries(id) ON DELETE CASCADE
);

CREATE INDEX idx_content_revisions_entry
  ON content_revisions (entry_id, created_at DESC);

CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE publish_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'admin',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES content_entries(id) ON DELETE SET NULL
);
