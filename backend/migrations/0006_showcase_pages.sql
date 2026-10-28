-- 可公開的學生成果與活動紀錄。圖片以縮小後的 data URL 儲存在 D1，讓前台可直接顯示；
-- 上傳大小與 MIME type 仍由 Worker 驗證，避免把任意檔案當成圖片寫入資料庫。
CREATE TABLE IF NOT EXISTS honor_showcases (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  student_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  design_idea TEXT NOT NULL DEFAULT '',
  images_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('published','draft')),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS honor_showcases_sort ON honor_showcases(status, sort_order, id);

CREATE TABLE IF NOT EXISTS activity_records (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  images_json TEXT NOT NULL DEFAULT '[]',
  album_url TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('published','draft')),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS activity_records_sort ON activity_records(status, event_date DESC, sort_order, id);
