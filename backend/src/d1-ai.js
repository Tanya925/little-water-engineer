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

/** 將「習題 1-5」「習題1－5」等明確題號統一為可與教材標題比較的鍵。 */
export function exerciseReference(value) {
  const found = /習題\s*([0-9０-９]+)\s*[-－–—．.]\s*([0-9０-９]+)/.exec(value || "");
  if (!found) return "";
  const digits = (text) => text.replace(/[０-９]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0));
  return `習題${digits(found[1])}${digits(found[2])}`;
}

/** 從明確題號直接取得同一筆小教材，避免語意相近的其他習題混入回答和附圖。 */
export async function resolveExerciseChunks(db, reference, topK) {
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
  return results.map((row) => ({ ...row, images: materialImages(row), score: 1 }));
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
