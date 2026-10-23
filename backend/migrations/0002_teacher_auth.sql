-- 僅保存既有帳號的密碼雜湊與 salt，不保存明碼密碼。
CREATE TABLE IF NOT EXISTS teacher_accounts (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cookie 僅含不可猜測的 session token；可在 Worker 重啟後維持登入狀態。
CREATE TABLE IF NOT EXISTS teacher_sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS teacher_sessions_expires ON teacher_sessions(expires_at);
