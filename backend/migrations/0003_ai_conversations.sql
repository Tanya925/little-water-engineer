-- AI 對話的短期脈絡表。每一列是學生問題或助教回答，sequence 確保同一段對話可
-- 依實際寫入順序重建；Worker 只讀取有限筆數作為理解追問的輔助，絕不當教材證據。
CREATE TABLE IF NOT EXISTS ai_conversation_messages (
  conversation_id TEXT NOT NULL,
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- 依 conversation_id 倒序讀取最近訊息，避免每次學生提問都掃描所有歷史對話。
CREATE INDEX IF NOT EXISTS ai_conversation_messages_lookup
  ON ai_conversation_messages(conversation_id, sequence DESC);
