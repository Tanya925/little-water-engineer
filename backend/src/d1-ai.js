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
function materialImages(row) {
  try {
    const images = JSON.parse(row.imagesJSON || "[]");
    if (Array.isArray(images) && images.length) return images.filter((image) => typeof image?.url === "string" && image.url);
  } catch { /* 舊資料或損壞 JSON 安全地退回既有單張圖片。 */ }
  return row.imageUrl ? [{ url: row.imageUrl, caption: "" }] : [];
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
