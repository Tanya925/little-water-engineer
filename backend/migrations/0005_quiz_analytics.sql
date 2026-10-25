-- 匿名彙總答題結果；不保存姓名、IP、裝置或學生識別碼。
CREATE TABLE IF NOT EXISTS quiz_answer_stats (
  question_id TEXT NOT NULL,
  question_revision INTEGER NOT NULL,
  topic TEXT NOT NULL,
  question TEXT NOT NULL,
  choice TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK(correct IN (0, 1)),
  day TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (question_id, question_revision, choice, correct, day)
);
