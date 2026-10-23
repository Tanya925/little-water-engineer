// 後台清單讀取層：欄位白名單避免把 SQL 表名交給請求端控制。
const tables = { experiments: "experiment_videos", resources: "teaching_resources", questions: "quiz_questions", updates: "latest_updates" };
const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };

function decode(kind, row) {
  const common = { id: row.id, status: row.status, revision: row.revision, updatedAt: row.updated_at };
  if (kind === "experiments") return { ...common, title: row.title, description: row.description, driveFileId: row.drive_file_id, filename: row.filename, mimeType: row.mime_type, sizeBytes: row.size_bytes, sourceFolderId: row.source_folder_id, sortOrder: row.sort_order, coverPath: row.cover_path, coverUrl: row.cover_path || `/assets/images/experiments/${encodeURIComponent(row.drive_file_id)}.jpg`, viewUrl: `https://drive.google.com/file/d/${encodeURIComponent(row.drive_file_id)}/view` };
  if (kind === "resources") return { ...common, title: row.title, folderUrl: row.folder_url, description: row.description, sections: parse(row.sections_json, []), sortOrder: row.sort_order, aiMaterialId: row.ai_material_id || "" };
  if (kind === "updates") return { ...common, title: row.title, description: row.description, eventDate: row.event_date, linkUrl: row.link_url, sortOrder: row.sort_order };
  return { ...common, type: row.type, topic: row.topic, difficulty: row.difficulty, question: row.question, options: parse(row.options_json, {}), answer: row.answer, answerText: row.answer_text, explanation: row.explanation, basis: row.basis, sources: parse(row.sources_json, []) };
}

export async function adminList(db, kind) {
  const table = tables[kind];
  if (!table) return null;
  const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY ${kind === "questions" ? "id" : "sort_order, id"}`).all();
  return results.map((row) => decode(kind, row));
}

const fields = {
  experiments: ["title", "description", "drive_file_id", "filename", "mime_type", "size_bytes", "source_folder_id", "sort_order", "cover_path", "status"],
  resources: ["title", "folder_url", "description", "sections_json", "sort_order", "status"],
  questions: ["type", "topic", "difficulty", "question", "options_json", "answer", "answer_text", "explanation", "basis", "sources_json", "status"],
  updates: ["title", "description", "event_date", "link_url", "sort_order", "status"],
};
function value(kind, input) {
  const status = input?.status === "draft" ? "draft" : "published";
  if (kind === "experiments") return { title: String(input.title || "").trim(), description: String(input.description || "").trim(), drive_file_id: String(input.driveFileId || "").trim(), filename: String(input.filename || input.title || "").trim(), mime_type: input.mimeType === "video/quicktime" ? "video/quicktime" : "video/mp4", size_bytes: Number(input.sizeBytes) || 0, source_folder_id: String(input.sourceFolderId || "").trim(), sort_order: Number(input.sortOrder) || 0, cover_path: String(input.coverPath || ""), status };
  if (kind === "resources") return { title: String(input.title || "").trim(), folder_url: String(input.folderUrl || "").trim(), description: String(input.description || "").trim(), sections_json: JSON.stringify(Array.isArray(input.sections) ? input.sections : []), sort_order: Number(input.sortOrder) || 0, status };
  if (kind === "questions") return { type: String(input.type || ""), topic: String(input.topic || ""), difficulty: String(input.difficulty || ""), question: String(input.question || "").trim(), options_json: JSON.stringify(input.options || {}), answer: String(input.answer || ""), answer_text: String(input.answerText || ""), explanation: String(input.explanation || ""), basis: String(input.basis || ""), sources_json: JSON.stringify(Array.isArray(input.sources) ? input.sources : []), status };
  return { title: String(input.title || "").trim(), description: String(input.description || "").trim(), event_date: String(input.eventDate || ""), link_url: String(input.linkUrl || ""), sort_order: Number(input.sortOrder) || 0, status };
}
export async function adminSave(db, kind, id, input) {
  const table = tables[kind]; const columns = fields[kind]; if (!table) return null;
  const data = value(kind, input);
  if (Object.values(data).some((item) => typeof item === "string" && item.length > 100000)) throw new Error("Invalid content");
  const recordId = id || (kind === "experiments" ? null : `${kind.slice(0, -1)}-${crypto.randomUUID()}`);
  if (!id) {
    const names = recordId ? ["id", ...columns] : columns;
    const values = recordId ? [recordId, ...columns.map((key) => data[key])] : columns.map((key) => data[key]);
    const result = await db.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).bind(...values).run();
    return adminFind(db, kind, recordId || result.meta.last_row_id);
  }
  if (!Number.isInteger(input?.revision)) throw new Error("Conflict");
  const result = await db.prepare(`UPDATE ${table} SET ${columns.map((key) => `${key}=?`).join(",")}, revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?`).bind(...columns.map((key) => data[key]), id, input.revision).run();
  if (!result.meta.changes) throw new Error("Conflict");
  return adminFind(db, kind, id);
}
export async function adminFind(db, kind, id) { const table = tables[kind]; if (!table) return null; const row = await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first(); return row ? decode(kind, row) : null; }
export async function adminDelete(db, kind, id) { const table = tables[kind]; if (!table) return null; await db.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run(); return { success: true }; }
