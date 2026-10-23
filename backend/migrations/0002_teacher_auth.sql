-- 老師身分驗證的獨立 schema。帳號表只保存 scrypt 雜湊與每個帳號各自的 salt，
-- 不保存、也不能由資料庫還原明碼密碼；雜湊格式須與 d1-auth.js 保持相容。
CREATE TABLE IF NOT EXISTS teacher_accounts (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cookie 僅含不可猜測的 session token；資料庫保存 token 的 SHA-256 雜湊及到期時間。
-- 因此 D1 外洩時不能直接拿資料庫值冒用登入；Worker 重啟也不會讓有效 session 消失。
CREATE TABLE IF NOT EXISTS teacher_sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS teacher_sessions_expires ON teacher_sessions(expires_at);
