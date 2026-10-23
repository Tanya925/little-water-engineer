CREATE TABLE IF NOT EXISTS ai_conversation_messages (
  conversation_id TEXT NOT NULL,
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_conversation_messages_lookup
  ON ai_conversation_messages(conversation_id, sequence DESC);
