// Cloudflare 後台資料層：白名單限制可管理資料表，並把章節與小教材完整組裝給管理介面。
// 所有值一律使用 D1 參數繫結；前端不可指定 SQL 表名、發布狀態以外的資料庫欄位或教材關聯。
const tables = {
  experiments: "experiment_videos",
  resources: "teaching_resources",
  questions: "quiz_questions",
  updates: "latest_updates",
};
const parse = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

function cleanText(value, label, max, required = true) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw new Error(`${label}需填寫，且不可超過 ${max} 個字。`);
  }
  return value.trim();
}

function validGoogleUrl(value, label, imageOnly = false) {
  const text = cleanText(value, label, 1500, !imageOnly);
  if (!text && imageOnly) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${label}格式不正確。`);
  }
  const allowed = imageOnly ? ["drive.google.com"] : ["drive.google.com", "docs.google.com"];
  if (url.protocol !== "https:" || !allowed.includes(url.hostname) || url.username || url.password || url.port) {
    throw new Error(`${label}需使用 Google Drive${imageOnly ? " 圖片檔" : " 或 Google 文件"}的 HTTPS 連結。`);
  }
  return url.href;
}

export function validateResourceMaterial(input) {
  return {
    title: cleanText(input?.title, "教材名稱", 200),
    materialType: cleanText(input?.materialType, "教材類型", 50),
    sourceUrl: validGoogleUrl(input?.sourceUrl, "教材連結"),
    imageUrl: validGoogleUrl(input?.imageUrl || "", "教材圖片連結", true),
    fullText: cleanText(input?.fullText, "教材文字", 100000),
  };
}

export async function materialRows(db, resourceId) {
  const { results } = await db
    .prepare(
      `SELECT rm.id,rm.resource_id,rm.title,rm.material_type,rm.source_url,rm.image_url,rm.ai_material_id,rm.sort_order,
              m.full_text,m.index_state,m.index_error,m.revision AS ai_revision,m.deleted
       FROM resource_materials rm
       LEFT JOIN ai_materials m ON m.id=rm.ai_material_id
       WHERE rm.resource_id=? ORDER BY rm.sort_order,rm.id`,
    )
    .bind(resourceId)
    .all();
  return results.map((row) => ({
    id: row.id,
    title: row.title,
    materialType: row.material_type,
    sourceUrl: row.source_url,
    imageUrl: row.image_url || "",
    aiMaterialId: row.ai_material_id || "",
    fullText: row.full_text || "",
    sortOrder: Number(row.sort_order || 0),
    indexState: row.deleted ? "deleted" : row.index_state || "pending",
    indexError: row.index_error || "",
    aiRevision: Number(row.ai_revision || 0),
  }));
}

async function decode(db, kind, row) {
  const common = { id: row.id, status: row.status, revision: Number(row.revision), updatedAt: row.updated_at };
  if (kind === "experiments") {
    return {
      ...common,
      title: row.title,
      description: row.description,
      driveFileId: row.drive_file_id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      sourceFolderId: row.source_folder_id,
      sortOrder: Number(row.sort_order),
      coverPath: row.cover_path,
      coverUrl: row.cover_path || `/assets/images/experiments/${encodeURIComponent(row.drive_file_id)}.jpg`,
      viewUrl: `https://drive.google.com/file/d/${encodeURIComponent(row.drive_file_id)}/view`,
    };
  }
  if (kind === "resources") {
    return {
      ...common,
      title: row.title,
      folderUrl: row.folder_url,
      description: row.description,
      sections: parse(row.sections_json, []),
      sortOrder: Number(row.sort_order),
      aiMaterialId: row.ai_material_id || "",
      materials: await materialRows(db, row.id),
    };
  }
  if (kind === "updates") {
    return { ...common, title: row.title, description: row.description, eventDate: row.event_date, linkUrl: row.link_url, sortOrder: Number(row.sort_order) };
  }
  return { ...common, type: row.type, topic: row.topic, difficulty: row.difficulty, question: row.question, options: parse(row.options_json, {}), answer: row.answer, answerText: row.answer_text, explanation: row.explanation, basis: row.basis, sources: parse(row.sources_json, []) };
}

export async function adminList(db, kind) {
  const table = tables[kind];
  if (!table) return null;
  const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY ${kind === "questions" ? "id" : "sort_order, id"}`).all();
  return Promise.all(results.map((row) => decode(db, kind, row)));
}

const fields = {
  experiments: ["title", "description", "drive_file_id", "filename", "mime_type", "size_bytes", "source_folder_id", "sort_order", "cover_path", "status"],
  resources: ["title", "folder_url", "description", "sections_json", "sort_order", "status"],
  questions: ["type", "topic", "difficulty", "question", "options_json", "answer", "answer_text", "explanation", "basis", "sources_json", "status"],
  updates: ["title", "description", "event_date", "link_url", "sort_order", "status"],
};

function state(value) {
  if (!["published", "draft"].includes(value)) throw new Error("請選擇發布或下架狀態。");
  return value;
}

function value(kind, input) {
  const status = state(input?.status);
  if (kind === "experiments") return { title: cleanText(input.title, "影片標題", 200), description: cleanText(input.description || "", "影片簡介", 3000, false), drive_file_id: cleanText(input.driveFileId, "Google Drive 影片", 1000), filename: cleanText(input.filename || input.title, "檔名", 255), mime_type: input.mimeType === "video/quicktime" ? "video/quicktime" : "video/mp4", size_bytes: Math.max(0, Number(input.sizeBytes) || 0), source_folder_id: String(input.sourceFolderId || ""), sort_order: Math.max(0, Number(input.sortOrder) || 0), cover_path: String(input.coverPath || ""), status };
  if (kind === "resources") return { title: cleanText(input.title, "章節標題", 200), folder_url: validGoogleUrl(input.folderUrl, "教材資料夾連結"), description: cleanText(input.description || "", "教材簡介", 3000, false), sections_json: JSON.stringify(Array.isArray(input.sections) ? input.sections.map((entry) => String(entry).trim()).filter(Boolean) : []), sort_order: Math.max(0, Number(input.sortOrder) || 0), status };
  if (kind === "questions") return { type: ["選擇題", "是非題"].includes(input.type) ? input.type : "選擇題", topic: cleanText(input.topic, "主題", 100), difficulty: ["易", "中", "難"].includes(input.difficulty) ? input.difficulty : "中", question: cleanText(input.question, "題目", 5000), options_json: JSON.stringify(input.options || {}), answer: cleanText(input.answer, "答案", 20), answer_text: String(input.answerText || ""), explanation: cleanText(input.explanation, "解析", 10000), basis: String(input.basis || ""), sources_json: JSON.stringify(Array.isArray(input.sources) ? input.sources : []), status };
  return { title: cleanText(input.title, "活動標題", 200), description: cleanText(input.description || "", "活動簡介", 5000, false), event_date: String(input.eventDate || ""), link_url: String(input.linkUrl || ""), sort_order: Math.max(0, Number(input.sortOrder) || 0), status };
}

export async function adminSave(db, kind, id, input) {
  const table = tables[kind];
  const columns = fields[kind];
  if (!table) return null;
  const data = value(kind, input);
  const recordId = id || (kind === "experiments" ? null : `${kind.slice(0, -1)}-${crypto.randomUUID()}`);
  if (!id) {
    const names = recordId ? ["id", ...columns] : columns;
    const values = recordId ? [recordId, ...columns.map((key) => data[key])] : columns.map((key) => data[key]);
    const result = await db.prepare(`INSERT INTO ${table} (${names.join(",")},updated_at) VALUES (${names.map(() => "?").join(",")},CURRENT_TIMESTAMP)`).bind(...values).run();
    return adminFind(db, kind, recordId || result.meta.last_row_id);
  }
  if (!Number.isInteger(input?.revision)) throw new Error("內容已被更新，請重新開啟後再儲存。");
  const result = await db.prepare(`UPDATE ${table} SET ${columns.map((key) => `${key}=?`).join(",")},revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?`).bind(...columns.map((key) => data[key]), id, input.revision).run();
  if (!result.meta.changes) throw new Error("內容已被更新，請重新開啟後再儲存。");
  return adminFind(db, kind, id);
}

export async function adminFind(db, kind, id) {
  const table = tables[kind];
  if (!table) return null;
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
  return row ? decode(db, kind, row) : null;
}

export async function adminDelete(db, kind, id) {
  const table = tables[kind];
  if (!table) return null;
  await db.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
  return { success: true };
}
