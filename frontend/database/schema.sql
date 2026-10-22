-- 主要功能：定義 SQLite 初始內容資料表與索引；其他管理、頁面與 AI 欄位由伺服器模組補建或遷移。
-- 影片僅保存 Drive ID 與顯示資訊，不儲存影片本體；唯一 ID 避免重複匯入。
CREATE TABLE IF NOT EXISTS experiment_videos (
  id INTEGER PRIMARY KEY,
  drive_file_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(title) > 0),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  source_folder_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS experiment_videos_sort
  ON experiment_videos(sort_order, id);

-- 教材入口保存 Drive 資料夾網址；sections_json 是章節陣列序列化後的文字，AI 全文另存 ai_materials。
CREATE TABLE IF NOT EXISTS teaching_resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  folder_url TEXT NOT NULL,
  description TEXT NOT NULL,
  sections_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
-- 題庫包含答案、解析及來源，屬伺服器資料；出題 API 只選公開欄位，提交答案後才提供評分。
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
  sources_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quiz_questions_filter ON quiz_questions(topic, type, difficulty);
