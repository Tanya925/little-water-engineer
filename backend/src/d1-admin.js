/*
 * Cloudflare 後台資料層：集中處理可管理資料的白名單、輸入清理、D1 參數繫結、頁面
 * 結構化內容與章節／小教材組裝。前端不得指定 SQL 表名、任意欄位、教材關聯或索引
 * revision；本檔僅接受明確映射的資料類型，所有外來字串都要在此再次驗證。
 */
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

/**
 * 驗證小教材及其附圖清單。API 同時接受新版 images 陣列與舊版 imageUrl，
 * 讓尚未重新儲存的舊教材、已快取的後台頁面都可安全使用；輸出一律統一為
 * { url, caption }[]。圖說可以空白，但只填圖說而沒有圖片連結沒有可顯示的資源，
 * 因此會明確拒絕，而不把不完整資料寫進 D1。
 */
export function validateResourceMaterial(input) {
  const rawImages = Array.isArray(input?.images)
    ? input.images
    : input?.imageUrl
      ? [{ url: input.imageUrl, caption: "" }]
      : [];
  if (rawImages.length > 30) throw new Error("教材圖片最多可設定 30 張。");
  const images = rawImages
    .map((image, index) => {
      const url = validGoogleUrl(image?.url || "", `第 ${index + 1} 張教材圖片連結`, true);
      const caption = cleanText(image?.caption || "", `第 ${index + 1} 張圖片圖說`, 300, false);
      if (!url && !caption) return null;
      if (!url) throw new Error(`第 ${index + 1} 張圖片請填寫 Google Drive 連結。`);
      return { url, caption };
    })
    .filter(Boolean);
  return {
    title: cleanText(input?.title, "教材名稱", 200),
    materialType: cleanText(input?.materialType, "教材類型", 50),
    sourceUrl: validGoogleUrl(input?.sourceUrl, "教材連結"),
    images,
    fullText: cleanText(input?.fullText, "教材文字", 100000),
  };
}

/**
 * 讀取一個章節內的所有小教材，並將 D1 的 images_json 還原為前端/API 使用的
 * images 陣列。解析失敗、不是陣列或沒有有效 URL 時，會退回舊的 image_url；
 * 這個讀取時相容層能避免資料庫升級期間或早期教材遺失附圖。
 */
export async function materialRows(db, resourceId) {
  const { results } = await db
    .prepare(
      `SELECT rm.id,rm.resource_id,rm.title,rm.material_type,rm.source_url,rm.image_url,rm.images_json,rm.ai_material_id,rm.sort_order,
              m.full_text,m.index_state,m.index_error,m.revision AS ai_revision,m.deleted
       FROM resource_materials rm
       LEFT JOIN ai_materials m ON m.id=rm.ai_material_id
       WHERE rm.resource_id=? ORDER BY rm.sort_order,rm.id`,
    )
    .bind(resourceId)
    .all();
  return results.map((row) => {
    const savedImages = parse(row.images_json, []);
    const images = Array.isArray(savedImages) && savedImages.length
      ? savedImages
          .filter((image) => typeof image?.url === "string" && image.url)
          .map((image) => ({ url: image.url, caption: typeof image.caption === "string" ? image.caption : "" }))
      : row.image_url
        ? [{ url: row.image_url, caption: "" }]
        : [];
    return {
      id: row.id,
      title: row.title,
      materialType: row.material_type,
      sourceUrl: row.source_url,
      imageUrl: images[0]?.url || "",
      images,
      aiMaterialId: row.ai_material_id || "",
      fullText: row.full_text || "",
      sortOrder: Number(row.sort_order || 0),
      indexState: row.deleted ? "deleted" : row.index_state || "pending",
      indexError: row.index_error || "",
      aiRevision: Number(row.ai_revision || 0),
    };
  });
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

// 關於我們頁保留結構化 JSON；瀏覽器端以 textContent 呈現，不能把老師輸入當成 HTML。
export async function adminPage(db, id) {
  if (id !== "about") return null;
  const row = await db.prepare("SELECT * FROM site_pages WHERE id=?").bind(id).first();
  return row ? { id: row.id, title: row.title, sections: parse(row.sections_json, []), status: row.status, revision: Number(row.revision), updatedAt: row.updated_at } : null;
}

export async function savePage(db, id, input) {
  const current = await adminPage(db, id);
  if (!current) throw new Error("找不到此頁面。");
  if (!Number.isInteger(input?.revision)) throw new Error("頁面已被更新，請重新載入後再儲存。");
  const title = cleanText(input.title, "頁面標題", 200);
  if (!Array.isArray(input.sections) || input.sections.length > 40) throw new Error("頁面區塊格式不正確。");
  const sections = JSON.stringify(input.sections);
  if (sections.length > 500000) throw new Error("頁面內容過長。");
  const status = state(input.status);
  const result = await db.prepare("UPDATE site_pages SET title=?,sections_json=?,status=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?").bind(title, sections, status, id, input.revision).run();
  if (!result.meta.changes) throw new Error("頁面已被更新，請重新載入後再儲存。");
  return adminPage(db, id);
}

export async function adminExport(db) {
  return {
    format: "little-water-engineer-content",
    version: 2,
    exportedAt: new Date().toISOString(),
    experiments: await adminList(db, "experiments"),
    resources: await adminList(db, "resources"),
    questions: await adminList(db, "questions"),
    updates: await adminList(db, "updates"),
    pages: [await adminPage(db, "about")],
  };
}

export async function importQuestions(db, input, commit = false) {
  if (!Array.isArray(input) || !input.length || input.length > 1000) throw new Error("請匯入 1–1000 題的 JSON 陣列。");
  const ids = new Set();
  const rows = [];
  for (const row of input) {
    const id = cleanText(row?.id, "匯入題號", 64);
    if (ids.has(id)) throw new Error(`匯入檔有重複題號：${id}`);
    ids.add(id);
    if (await db.prepare("SELECT 1 FROM quiz_questions WHERE id=?").bind(id).first()) throw new Error(`題號 ${id} 已存在；請修改原題或使用新的題號。`);
    rows.push({ id, ...value("questions", { ...row, status: "draft" }) });
  }
  if (commit) {
    await db.batch(rows.map((row) => db.prepare(
      `INSERT INTO quiz_questions (id,type,topic,difficulty,question,options_json,answer,answer_text,explanation,basis,sources_json,status,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    ).bind(row.id, row.type, row.topic, row.difficulty, row.question, row.options_json, row.answer, row.answer_text, row.explanation, row.basis, row.sources_json, row.status)));
  }
  return { count: rows.length, topics: [...new Set(rows.map((row) => row.topic))], imported: commit };
}
