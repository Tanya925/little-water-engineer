/*
 * 向量搜尋的 D1 驗證關卡。Vectorize 僅提供近似的片段 ID 與分數，不能當成授權或
 * 最新資料來源；本檔必須回查 D1，排除刪除、草稿、索引未完成和 revision 過期資料，
 * 再把可信原文及其展示用附圖回傳給 site-worker 的回答流程。
 */
/**
 * 將查詢列中的圖片 JSON 轉成可回傳給瀏覽器的附圖資料。圖片不影響向量檢索：
 * 它們只在已選中的教材片段所屬小教材被引用時一併顯示。JSON 無法解析時不能讓
 * 一筆舊資料中斷整個回答，因此安全退回 image_url 的單張圖片格式。
 */
/**
 * Google Drive 的 /view 是 HTML 檢視頁而非圖片檔，不能直接指定給 img.src。資料庫仍
 * 保存老師填入的原始連結作為點擊來源；API 額外回傳 thumbnail 端點供前端顯示圖片。
 * 若連結不是可辨識的 Drive 檔案連結，安全地回傳原網址，前端載入失敗時會隱藏該圖。
 */
function imagePreviewUrl(url) {
  try {
    const parsed = new URL(url);
    const fileId = /\/file\/d\/([^/?]+)/.exec(parsed.pathname)?.[1] || parsed.searchParams.get("id");
    return fileId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600` : url;
  } catch {
    return url;
  }
}

function materialImages(row) {
  const withPreview = (images) => images.map((image) => ({
    url: image.url,
    caption: typeof image.caption === "string" ? image.caption : "",
    previewUrl: imagePreviewUrl(image.url),
  }));
  try {
    const images = JSON.parse(row.imagesJSON || "[]");
    if (Array.isArray(images) && images.length) return withPreview(images.filter((image) => typeof image?.url === "string" && image.url));
  } catch { /* 舊資料或損壞 JSON 安全地退回既有單張圖片。 */ }
  return row.imageUrl ? withPreview([{ url: row.imageUrl, caption: "" }]) : [];
}

/** 將全形數字與連字號統一，讓學生自然輸入的「week2－7」也能比對教材標題。 */
function normalizeReference(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[０-９]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
    .replace(/[\s\-－–—、，,．.]/g, "");
}

/**
 * 從學生問句取出所有可唯一識別的小教材代號。學生可以一次問「week2-8 以及
 * 102地特-4」；兩筆都必須保留，不能只採用字串中第一個代號。單獨的「2-7」仍
 * 故意不在此回傳，因為它可能同時指 week2-7 與習題2-7，必須由 site-worker
 * 依最近對話決定，不能隨便猜其中一筆。
 */
export function materialReferences(value) {
  const text = String(value || "");
  const found = [];
  // 資料庫中的 week 標題有「week2-week2-7」的匯入格式，學生則通常輸入 week2-7。
  // 兩者都直接萃取成 week + 週次 + 單元號，而不是以原字串做模糊包含比對。
  const weekPattern = /week\s*([0-9０-９]+)(?:\s*[-－–—．.]\s*week\s*[0-9０-９]+)?\s*[-－–—．.]\s*([0-9０-９]+)/gi;
  for (const match of text.matchAll(weekPattern)) {
    found.push({ index: match.index, reference: `week${normalizeReference(match[1])}${normalizeReference(match[2])}` });
  }
  const namedPattern = /習題\s*[0-9０-９]+\s*[-－–—．.]\s*[0-9０-９]+|[0-9０-９]{3}\s*(?:地特|技師)\s*[-－–—．.]\s*[0-9０-９]+/gi;
  for (const match of text.matchAll(namedPattern)) {
    found.push({ index: match.index, reference: normalizeReference(match[0]) });
  }
  return [...new Set(found.sort((a, b) => a.index - b.index).map((item) => item.reference))];
}

/** 相容單一教材呼叫端；需要完整範圍時應使用 materialReferences。 */
export function materialReference(value) {
  return materialReferences(value)[0] || "";
}

/**
 * 讀取追問中的簡短題號（例如「再詳細說明一下 2-7」）。題號可出現在句中任意位置；
 * 它本身無法分辨 week2-7 與習題2-7，因此只能供 site-worker 與最近對話中的
 * 完整教材代號交叉比對，絕不能單獨作為資料庫搜尋條件。
 */
export function shortMaterialReferences(value) {
  const text = String(value || "");
  const references = [];
  const pattern = /([0-9０-９]+)\s*[-－–—．.]\s*([0-9０-９]+)/g;
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(Math.max(0, (match.index || 0) - 4), match.index || 0);
    // week2-7、習題2-7、108地特-1 已由完整代號解析器處理，不能同時誤列為裸露短碼。
    if (/week\s*$/i.test(before) || /習題\s*$/.test(before) || /(?:地特|技師)\s*$/.test(before)) continue;
    references.push(normalizeReference(`${match[1]}-${match[2]}`));
  }
  return [...new Set(references)];
}

/**
 * 以目前 D1 中已發布的小教材標題找出「使用者明確寫出的名稱」。這不是固定名稱清單：
 * 每次都讀取資料庫，因此老師日後新增任何命名方式的小教材都會自動納入。只採用章節
 * 分隔符號（｜）後的實際小教材名稱，並要求至少四個正規化字元完全出現在問題中，避免
 * 「流體力學」這類共同章節字眼把多份教材錯誤鎖在一起。
 */
export async function findNamedMaterialIds(db, question) {
  const normalizedQuestion = normalizeReference(question);
  if (normalizedQuestion.length < 4) return [];
  const { results } = await db
    .prepare("SELECT id,title FROM ai_materials WHERE deleted=0 AND status='published' AND index_state='ready'")
    .all();
  return results
    .filter((row) => {
      const title = String(row.title || "");
      const leafTitle = title.split("｜").at(-1) || title;
      const alias = normalizeReference(leafTitle);
      return alias.length >= 4 && normalizedQuestion.includes(alias);
    })
    .map((row) => row.id);
}

/** 從明確教材代號直接取得同一筆小教材，避免語意相近的其他題目混入回答和附圖。 */
export async function resolveMaterialReferenceChunks(db, reference, topK) {
  if (!reference) return [];
  const { results } = await db
    .prepare(
      `SELECT c.id,c.content,c.revision,c.material_id AS materialId,m.title,m.topic,m.source_url AS sourceUrl,
        COALESCE(rm.image_url,'') AS imageUrl,COALESCE(rm.images_json,'[]') AS imagesJSON
       FROM ai_chunks c JOIN ai_materials m ON m.id=c.material_id
       LEFT JOIN resource_materials rm ON rm.ai_material_id=m.id
       WHERE m.deleted=0 AND m.status='published' AND m.index_state='ready' AND c.revision=m.revision
         AND replace(replace(replace(replace(m.title,'-',''),'－',''),'–',''),' ','') LIKE ?
       ORDER BY c.id LIMIT ?`,
    )
    .bind(`%${reference}%`, topK)
    .all();
  // 代號搜尋寧可保守地不回答，也不能把兩筆恰好都含相同字串的教材湊在一起。這條
  // 規則尤其保護題圖：明確代號只允許對應到唯一一份小教材，否則來源與圖片一律不回傳。
  if (new Set(results.map((row) => row.materialId)).size !== 1) return [];
  return results.map((row) => ({ ...row, images: materialImages(row), score: 1 }));
}

/**
 * 依已確認的教材 ID 讀取片段。與標題 LIKE 查詢不同，ID 是資料庫主鍵，適合用在任意
 * 命名的小教材；仍保留發布、索引完成與 revision 檢查，避免老師更新期間回傳舊版本。
 */
export async function resolveMaterialIdChunks(db, materialIds, topK) {
  const ids = [...new Set(materialIds)].filter(Boolean);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT c.id,c.content,c.revision,c.material_id AS materialId,m.title,m.topic,m.source_url AS sourceUrl,
        COALESCE(rm.image_url,'') AS imageUrl,COALESCE(rm.images_json,'[]') AS imagesJSON
       FROM ai_chunks c JOIN ai_materials m ON m.id=c.material_id
       LEFT JOIN resource_materials rm ON rm.ai_material_id=m.id
       WHERE c.material_id IN (${placeholders}) AND m.deleted=0 AND m.status='published'
         AND m.index_state='ready' AND c.revision=m.revision
       ORDER BY c.material_id,c.id`,
    )
    .bind(...ids)
    .all();
  const counts = new Map();
  return results.filter((row) => {
    const count = counts.get(row.materialId) || 0;
    counts.set(row.materialId, count + 1);
    return count < topK;
  }).map((row) => ({ ...row, images: materialImages(row), score: 1 }));
}

/**
 * 以 Vectorize 初步命中的片段 ID 回查 D1，排除刪除、未發布、未完成索引或版本
 * 過期的教材。回傳內容另帶所屬小教材的附圖，供回答完成後的來源區顯示；附圖
 * 不參與分數計算，也不會被送入模型作為教材文字。
 */
export async function resolveAIChunks(db, matches, threshold, topK) {
  const ids = [...new Set(matches.filter((item) => item?.score >= threshold).map((item) => item.id))].slice(0, 50);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT c.id,c.content,c.revision,c.material_id AS materialId,m.title,m.topic,m.source_url AS sourceUrl,
        COALESCE(rm.image_url,'') AS imageUrl,COALESCE(rm.images_json,'[]') AS imagesJSON
       FROM ai_chunks c JOIN ai_materials m ON m.id=c.material_id
       LEFT JOIN resource_materials rm ON rm.ai_material_id=m.id
       WHERE c.id IN (${placeholders}) AND m.deleted=0 AND m.status='published' AND m.index_state='ready' AND c.revision=m.revision`,
    )
    .bind(...ids)
    .all();
  const score = new Map(matches.map((item) => [item.id, item.score]));
  return results
    .map((row) => ({ ...row, images: materialImages(row), score: score.get(row.id) || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
