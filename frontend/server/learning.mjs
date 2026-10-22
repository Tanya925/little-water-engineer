// 主要功能：匯入教材與題庫，提供教材清單、練習選題、題目篩選和伺服器端答案核對。
/*
 * 題庫分成兩條資料路徑：出題只取公開欄位；交卷核對才讀答案及解析。
 * JSON 只負責初次匯入／補齊缺少 ID，實際顯示以已發布的 SQLite 紀錄為準。
 * 回傳的教材供 resources-page.js 使用，選題及評分結果供 quiz-page.js 使用；
 * 伺服器不保存學生跨次練習紀錄。
 */
import { readFile } from "node:fs/promises";
import { randomInt } from "node:crypto";

// 是非題統一成 O／X 鍵值，畫面不必處理原始資料中不同的答案表示法。
export function normalizeOptions(question) {
  if (question.type === "是非題") {
    return { O: "正確", X: "錯誤" };
  }

  return question.options;
}

// 原始是非題可能含說明文字，核對時只取第一個 O／X 字元。
export function normalizedAnswer(question) {
  return question.type === "是非題" ? question.answer.slice(0, 1) : question.answer;
}

// 讀取 questions.json、resources.json 並檢查題目；ON CONFLICT DO NOTHING 保留已存在的老師修改。
export async function seedLearningContent(database) {
  // questions.json：id 是穩定題號，type／topic／difficulty 供篩選；options 為選項鍵值物件。
  // answer、answer_text、explanation、basis、sources 只供伺服器評分與解析使用。
  const questions = JSON.parse(
    await readFile(new URL("../database/questions.json", import.meta.url), "utf8"),
  );
  // resources.json：id 是教材代號，folderUrl 是 Drive 入口，sections 為章節清單。
  const resources = JSON.parse(
    await readFile(new URL("../database/resources.json", import.meta.url), "utf8"),
  );
  const ids = new Set();
  for (const question of questions) {
    const options = normalizeOptions(question);
    if (
      ids.has(question.id) ||
      !["選擇題", "是非題"].includes(question.type) ||
      !question.question ||
      !options?.[normalizedAnswer(question)] ||
      !Array.isArray(question.sources)
    ) {
      throw new Error(`題庫資料格式不符：${question.id}`);
    }
    ids.add(question.id);
  }
  const insertQuestion = database.prepare(`INSERT INTO quiz_questions
    (id, type, topic, difficulty, question, options_json, answer, answer_text, explanation, basis, sources_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
  const insertResource = database.prepare(`INSERT INTO teaching_resources
    (id, title, folder_url, description, sections_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
  for (const question of questions) {
    insertQuestion.run(
      question.id,
      question.type,
      question.topic,
      question.difficulty,
      question.question,
      JSON.stringify(normalizeOptions(question)),
      question.answer,
      question.answer_text,
      question.explanation,
      question.basis,
      JSON.stringify(question.sources),
    );
  }
  resources.forEach((resource, index) =>
    insertResource.run(
      resource.id,
      resource.title,
      resource.folderUrl,
      resource.description,
      JSON.stringify(resource.sections),
      index + 1,
    ),
  );
  // 舊版曾把預設說明存進第一個章節；遷移時將它移到頁面介紹欄位，
  // 但若老師已自訂介紹文字便完整保留，不以新版預設值覆蓋。
  database
    .prepare(
      `UPDATE teaching_resources SET description = '', revision = revision + 1
    WHERE id = ? AND description = ?`,
    )
    .run(
      "fluid-mechanics-chapter-1",
      "教材以完整資料夾提供，請進入 Google Drive 選擇需要的教材，或下載整個資料夾。",
    );
}

// 公開選題查詢刻意不選 answer／explanation；gradeQuestion 才能讀完整題目並回傳解析。
export function learningStore(database) {
  const list = database.prepare(`SELECT id, type, topic, difficulty, question, options_json
    FROM quiz_questions WHERE status = 'published' ORDER BY id`);
  const find = database.prepare(
    "SELECT * FROM quiz_questions WHERE id = ? AND status = 'published'",
  );

  return {
    listResources() {
      return database
        .prepare(
          `SELECT id, title, folder_url AS folderUrl, description,
        sections_json FROM teaching_resources WHERE status = 'published' ORDER BY sort_order, id`,
        )
        .all()
        .map(({ sections_json, ...row }) => ({ ...row, sections: JSON.parse(sections_json) }));
    },
    quizCatalog() {
      const rows = list.all();

      return {
        total: rows.length,
        topics: [...new Set(rows.map((row) => row.topic))],
        topicCounts: Object.fromEntries(
          [...new Set(rows.map((row) => row.topic))].map((topic) => [
            topic,
            rows.filter((row) => row.topic === topic).length,
          ]),
        ),
        groups: [
          ...new Set(rows.map((row) => JSON.stringify([row.topic, row.type, row.difficulty]))),
        ].map((key) => {
          const [topic, type, difficulty] = JSON.parse(key);

          return {
            topic,
            type,
            difficulty,
            count: rows.filter(
              (row) => row.topic === topic && row.type === type && row.difficulty === difficulty,
            ).length,
          };
        }),
        types: [...new Set(rows.map((row) => row.type))],
        difficulties: ["易", "中", "難"].filter((value) =>
          rows.some((row) => row.difficulty === value),
        ),
      };
    },
    quizQuestions({ topic = "", topics = [], type = "", difficulty = "", count = 10 } = {}) {
      const selectedTopics = topics.length ? topics : topic ? [topic] : [];
      const rows = list
        .all()
        .filter(
          (row) =>
            (!selectedTopics.length || selectedTopics.includes(row.topic)) &&
            (!type || row.type === type) &&
            (!difficulty || row.difficulty === difficulty),
        );
      const available = rows.length;
      for (let index = rows.length - 1; index > 0; index--) {
        const other = randomInt(index + 1);
        [rows[index], rows[other]] = [rows[other], rows[index]];
      }

      return {
        available,
        questions: rows
          .slice(0, count)
          .map(({ options_json, ...row }) => ({ ...row, options: JSON.parse(options_json) })),
      };
    },
    gradeQuestion(id, choice) {
      const question = find.get(id);
      if (!question) {
        return null;
      }
      const options = JSON.parse(question.options_json);
      if (typeof choice !== "string" || !Object.hasOwn(options, choice)) {
        throw new Error("Invalid choice");
      }
      const answer = normalizedAnswer(question);

      return {
        id,
        choice,
        correct: choice === answer,
        answer,
        originalAnswer: question.answer,
        answerText: question.answer_text,
        explanation: question.explanation,
        basis: question.basis,
        sources: JSON.parse(question.sources_json),
      };
    },
  };
}
