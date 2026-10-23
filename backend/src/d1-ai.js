// D1 側的教材片段驗證：Vectorize 只提供 ID/分數，全文與發布狀態一律由 D1 再確認。
export async function resolveAIChunks(db, matches, threshold, topK) {
  const ids = [...new Set(matches.filter((item) => item?.score >= threshold).map((item) => item.id))].slice(0, 50);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT c.id,c.content,c.revision,c.material_id AS materialId,m.title,m.topic,m.source_url AS sourceUrl,
        COALESCE(rm.image_url,'') AS imageUrl
       FROM ai_chunks c JOIN ai_materials m ON m.id=c.material_id
       LEFT JOIN resource_materials rm ON rm.ai_material_id=m.id
       WHERE c.id IN (${placeholders}) AND m.deleted=0 AND m.status='published' AND m.index_state='ready' AND c.revision=m.revision`,
    )
    .bind(...ids)
    .all();
  const score = new Map(matches.map((item) => [item.id, item.score]));
  return results
    .map((row) => ({ ...row, score: score.get(row.id) || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
