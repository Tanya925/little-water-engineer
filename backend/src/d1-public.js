/*
 * 公開網站的 D1 讀取層。所有函式只回傳已發布且可公開的欄位，絕不把題庫正解、
 * 老師管理欄位、AI 教材全文或未發布資料送往瀏覽器。site-worker.js 的公開 API 只
 * 應經由此檔讀資料，避免新頁面不小心繞過 status 篩選。
 */

function parseJSON(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function listVideos(db) {
  const { results } = await db
    .prepare(
      `SELECT id, drive_file_id AS driveFileId, title, description, filename,
        mime_type AS mimeType, size_bytes AS sizeBytes, sort_order AS sortOrder, cover_path AS coverPath
       FROM experiment_videos WHERE status = 'published' ORDER BY sort_order, id`,
    )
    .all();

  return results.map((video) => ({
    ...video,
    coverUrl:
      video.coverPath || `/assets/images/experiments/${encodeURIComponent(video.driveFileId)}.jpg`,
    previewUrl: `https://drive.google.com/file/d/${encodeURIComponent(video.driveFileId)}/preview`,
    viewUrl: `https://drive.google.com/file/d/${encodeURIComponent(video.driveFileId)}/view`,
  }));
}

export async function listResources(db) {
  const { results } = await db
    .prepare(
      `SELECT id, title, folder_url AS folderUrl, description, sections_json
       FROM teaching_resources WHERE status = 'published' ORDER BY sort_order, id`,
    )
    .all();

  return results.map(({ sections_json: sectionsJSON, ...resource }) => ({
    ...resource,
    sections: parseJSON(sectionsJSON, []),
  }));
}

async function publishedQuestions(db) {
  const { results } = await db
    .prepare(
      `SELECT id, type, topic, difficulty, question, options_json
       FROM quiz_questions WHERE status = 'published' ORDER BY id`,
    )
    .all();
  return results;
}

export async function quizCatalog(db) {
  const rows = await publishedQuestions(db);
  const topics = [...new Set(rows.map((row) => row.topic))];
  const types = [...new Set(rows.map((row) => row.type))];
  const difficulties = ["易", "中", "難"].filter((difficulty) =>
    rows.some((row) => row.difficulty === difficulty),
  );
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.topic, row.type, row.difficulty]);
    groups.set(key, (groups.get(key) || 0) + 1);
  }

  return {
    total: rows.length,
    topics,
    topicCounts: Object.fromEntries(
      topics.map((topic) => [topic, rows.filter((row) => row.topic === topic).length]),
    ),
    groups: [...groups].map(([key, count]) => {
      const [topic, type, difficulty] = JSON.parse(key);
      return { topic, type, difficulty, count };
    }),
    types,
    difficulties,
  };
}

export async function quizQuestions(db, { topic = "", topics = [], type = "", difficulty = "", count = 10 }) {
  const selectedTopics = topics.length ? topics : topic ? [topic] : [];
  const rows = (await publishedQuestions(db)).filter(
    (row) =>
      (!selectedTopics.length || selectedTopics.includes(row.topic)) &&
      (!type || row.type === type) &&
      (!difficulty || row.difficulty === difficulty),
  );
  for (let index = rows.length - 1; index > 0; index -= 1) {
    const other = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [rows[index], rows[other]] = [rows[other], rows[index]];
  }

  return {
    available: rows.length,
    questions: rows.slice(0, count).map(({ options_json: optionsJSON, ...question }) => ({
      ...question,
      options: parseJSON(optionsJSON, {}),
    })),
  };
}

export async function gradeQuestion(db, id, choice) {
  const question = await db
    .prepare("SELECT * FROM quiz_questions WHERE id = ? AND status = 'published'")
    .bind(id)
    .first();
  if (!question) return null;
  const options = parseJSON(question.options_json, {});
  if (typeof choice !== "string" || !Object.hasOwn(options, choice)) {
    throw new Error("Invalid choice");
  }
  const answer = question.type === "是非題" ? question.answer.slice(0, 1) : question.answer;
  return {
    id,
    revision: question.revision,
    choice,
    correct: choice === answer,
    answer,
    answerText: question.answer_text,
    explanation: question.explanation,
    basis: question.basis,
    sources: parseJSON(question.sources_json, []),
  };
}

export async function listUpdates(db) {
  const { results } = await db
    .prepare(
      `SELECT id, title, description, event_date AS eventDate, link_url AS linkUrl
       FROM latest_updates WHERE status = 'published' ORDER BY event_date DESC, sort_order, id`,
    )
    .all();
  return results;
}

export async function publicPage(db, id) {
  const page = await db
    .prepare("SELECT title, sections_json FROM site_pages WHERE id = ? AND status = 'published'")
    .bind(id)
    .first();
  return page ? { title: page.title, sections: parseJSON(page.sections_json, []) } : null;
}
