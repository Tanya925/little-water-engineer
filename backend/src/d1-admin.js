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
  honors: "honor_showcases",
  activities: "activity_records",
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

function validateStoredImages(input, label, maximum = 3) {
  if (!Array.isArray(input) || input.length > maximum) throw new Error(`${label}最多可上傳 ${maximum} 張。`);
  return input.map((image, index) => {
    if (typeof image !== "string" || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(image) || image.length > 1_500_000) {
      throw new Error(`第 ${index + 1} 張${label}格式不正確或檔案過大。`);
    }
    return image;
  });
}

function validExternalUrl(value, label) {
  const text = cleanText(value || "", label, 1500, false);
  if (!text) return "";
  let url;
  try { url = new URL(text); } catch { throw new Error(`${label}格式不正確。`); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error(`${label}需為安全的網站連結。`);
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
  if (kind === "honors") return { ...common, title: row.title, studentName: row.student_name, description: row.description, designIdea: row.design_idea, images: parse(row.images_json, []), sortOrder: Number(row.sort_order) };
  if (kind === "activities") return { ...common, title: row.title, description: row.description, eventDate: row.event_date, location: row.location, images: parse(row.images_json, []), albumUrl: row.album_url, sortOrder: Number(row.sort_order) };
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
  honors: ["title", "student_name", "description", "design_idea", "images_json", "sort_order", "status"],
  activities: ["title", "description", "event_date", "location", "images_json", "album_url", "sort_order", "status"],
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
  if (kind === "honors") return { title: cleanText(input.title, "作品名稱", 200), student_name: cleanText(input.studentName || "", "學生／團隊", 200, false), description: cleanText(input.description || "", "作品介紹", 5000, false), design_idea: cleanText(input.designIdea || "", "設計理念", 5000, false), images_json: JSON.stringify(validateStoredImages(input.images || [], "作品照片")), sort_order: Math.max(0, Number(input.sortOrder) || 0), status };
  if (kind === "activities") return { title: cleanText(input.title, "活動名稱", 200), description: cleanText(input.description || "", "活動介紹", 5000, false), event_date: cleanText(input.eventDate || "", "活動日期", 20, false), location: cleanText(input.location || "", "活動地點", 200, false), images_json: JSON.stringify(validateStoredImages(input.images || [], "精選照片")), album_url: validExternalUrl(input.albumUrl, "完整相簿連結"), sort_order: Math.max(0, Number(input.sortOrder) || 0), status };
  return { title: cleanText(input.title, "活動標題", 200), description: cleanText(input.description || "", "活動簡介", 5000, false), event_date: String(input.eventDate || ""), link_url: String(input.linkUrl || ""), sort_order: Math.max(0, Number(input.sortOrder) || 0), status };
}

export async function adminSave(db, kind, id, input) {
  const table = tables[kind];
  const columns = fields[kind];
  if (!table) return null;
  const data = value(kind, input);
  const prefixes = { resources: "resource", questions: "question", updates: "update", honors: "honor", activities: "activity" };
  const recordId = id || (kind === "experiments" ? null : `${prefixes[kind]}-${crypto.randomUUID()}`);
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

// 關於我們只管理可能變動的介紹文字、名單與照片網址；前台仍以安全文字節點呈現。
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
  let imageBytes = 0;
  const checkedSections = input.sections.map((section) => ({
    ...section,
    items: Array.isArray(section?.items)
      ? section.items.map((item) => {
          const imageUrl = typeof item?.imageUrl === "string" ? item.imageUrl : "";
          if (imageUrl && (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(imageUrl) || imageUrl.length > 1_500_000)) {
            throw new Error("人物或學校照片格式不正確，請重新上傳 JPG、PNG 或 WebP 圖片。");
          }
          imageBytes += imageUrl.length;
          return { ...item, imageUrl };
        })
      : [],
  }));
  if (imageBytes > 4_500_000) throw new Error("關於我們的照片總量過大，請改用較小的照片後再儲存。");
  const sections = JSON.stringify(checkedSections);
  if (sections.length > 5_000_000) throw new Error("頁面內容過長。");
  const status = state(input.status);
  const result = await db.prepare("UPDATE site_pages SET title=?,sections_json=?,status=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?").bind(title, sections, status, id, input.revision).run();
  if (!result.meta.changes) throw new Error("頁面已被更新，請重新載入後再儲存。");
  return adminPage(db, id);
}

/** 在同一個 D1 batch 中讀取各應用程式資料表；排除無權讀取的 Cloudflare 內部表。 */
export async function databaseBackup(db) {
  const schema = await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND substr(name,1,7) != 'sqlite_' AND substr(name,1,4) != '_cf_' ORDER BY type,name").all();
  const tables = schema.results.filter((entry) => entry.type === "table");
  const statements = tables.map((entry) => db.prepare(`SELECT * FROM "${entry.name.replaceAll('"', '""')}"`));
  const rows = statements.length ? await db.batch(statements) : [];
  const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
  const literal = (value) => {
    if (value === null) return "NULL";
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string") {
      if (value.includes("\0")) return `CAST(X'${Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("")}' AS TEXT)`;
      return `'${value.replaceAll("'", "''")}'`;
    }
    throw new Error("資料庫包含無法匯出的欄位類型，備份已中止。");
  };
  const sql = [`-- little-water-engineer backup ${new Date().toISOString()}`, "-- Restore only into a new empty database."];
  for (const table of tables) sql.push(`${table.sql};`);
  tables.forEach((table, index) => {
    for (const row of rows[index].results) {
      const columns = Object.keys(row);
      sql.push(`INSERT INTO ${identifier(table.name)} (${columns.map(identifier).join(",")}) VALUES (${columns.map((column) => literal(row[column])).join(",")});`);
    }
  });
  for (const entry of schema.results.filter((entry) => entry.type !== "table")) sql.push(`${entry.sql};`);
  return `${sql.join("\n")}\n`;
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
