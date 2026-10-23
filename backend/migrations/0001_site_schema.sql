-- 正式網站的第一版 D1 結構：集中建立公開影片、章節、題庫、活動、頁面文字與
-- AI 教材／片段資料表。這是只向前追加的 migration；已在正式資料庫執行後不可
-- 改寫，後續欄位或資料表請建立新的 migration，避免新舊環境 schema 不一致。
-- 所有公開讀取仍由 Worker 依 status 篩選；資料表中的內容不是自動公開的權限依據。
CREATE TABLE IF NOT EXISTS experiment_videos (
  id INTEGER PRIMARY KEY,
  drive_file_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(title) > 0),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  source_folder_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','draft','archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT '',
  cover_path TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS experiment_videos_sort ON experiment_videos(sort_order, id);

CREATE TABLE IF NOT EXISTS teaching_resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  folder_url TEXT NOT NULL,
  description TEXT NOT NULL,
  sections_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','draft','archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT '',
  ai_material_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS resource_materials (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  title TEXT NOT NULL,
  material_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  ai_material_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  image_url TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS resource_materials_resource ON resource_materials(resource_id, sort_order, id);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('選擇題', '是非題')),
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('易', '中', '難')),
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  answer TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  explanation TEXT NOT NULL,
  basis TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','draft','archived')),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS quiz_questions_filter ON quiz_questions(topic, type, difficulty);

CREATE TABLE IF NOT EXISTS latest_updates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','draft')),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS site_pages (
  id TEXT PRIMARY KEY CHECK (id IN ('home', 'about')),
  title TEXT NOT NULL,
  sections_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published','draft')),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_materials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  source_url TEXT NOT NULL,
  full_text TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  index_state TEXT NOT NULL DEFAULT 'pending',
  index_error TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  index_format INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ai_chunks (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_chunks_material ON ai_chunks(material_id);

CREATE TABLE IF NOT EXISTS app_migrations (id TEXT PRIMARY KEY);
