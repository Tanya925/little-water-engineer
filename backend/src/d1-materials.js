// D1 小教材與 AI 索引管理：每筆章節內教材各自保有全文、版本與 Vectorize 片段。
// 寫入 D1 後才非同步同步向量；模型服務失敗不會遺失教材，而是留下 failed 狀態供老師重試。
import { materialRows, validateResourceMaterial } from "./d1-admin.js";

const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const VECTOR_BATCH = 8;

function splitMaterial(text, size = 700, overlap = 100) {
  const chars = Array.from(text.replace(/\r\n?/g, "\n").trim());
  const chunks = [];
  for (let start = 0; start < chars.length; ) {
    let end = Math.min(start + size, chars.length);
    if (end < chars.length) {
      const tail = chars.slice(start + Math.floor(size * 0.65), end);
      const boundary = Math.max(tail.lastIndexOf("\n"), tail.lastIndexOf("。"), tail.lastIndexOf("！"), tail.lastIndexOf("？"));
      if (boundary >= 0) end = start + Math.floor(size * 0.65) + boundary + 1;
    }
    const content = chars.slice(start, end).join("").trim();
    if (content) chunks.push(content);
    if (end === chars.length) break;
    start = end - overlap;
  }
  return chunks;
}

const namespace = (env) => env.VECTOR_NAMESPACE || "water-materials-v1";
const now = () => new Date().toISOString();

async function setIndexState(db, id, revision, state, error = "") {
  await db.prepare("UPDATE ai_materials SET index_state=?,index_error=?,updated_at=? WHERE id=? AND revision=?").bind(state, error.slice(0, 800), now(), id, revision).run();
}

async function deleteVectors(env, ids) {
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    if (batch.length) await env.VECTORIZE.deleteByIds(batch);
  }
}

async function materialRecord(db, id) {
  return db.prepare("SELECT * FROM ai_materials WHERE id=?").bind(id).first();
}

export async function syncMaterial(db, env, materialId) {
  const material = await materialRecord(db, materialId);
  if (!material) throw new Error("找不到 AI 教材。");
  const revision = Number(material.revision);
  try {
    await setIndexState(db, materialId, revision, "syncing");
    const { results: existing } = await db.prepare("SELECT id FROM ai_chunks WHERE material_id=?").bind(materialId).all();
    await deleteVectors(env, existing.map((row) => row.id));
    await db.prepare("DELETE FROM ai_chunks WHERE material_id=?").bind(materialId).run();
    if (Number(material.deleted) || material.status !== "published") {
      await setIndexState(db, materialId, revision, "ready");
      return materialRecord(db, materialId);
    }
    const chunks = splitMaterial(material.full_text);
    const records = chunks.map((content, index) => ({
      id: `${materialId}-${revision}-${index}`,
      content,
      // 標題與章節一併嵌入向量，使「習題 1-5」等明確教材名稱較容易命中。
      searchable: `${material.title}\n${material.topic}\n${content}`,
    }));
    for (let index = 0; index < records.length; index += VECTOR_BATCH) {
      const batch = records.slice(index, index + VECTOR_BATCH);
      const embeddings = await env.AI.run(EMBEDDING_MODEL, { text: batch.map((item) => item.searchable) });
      if (!Array.isArray(embeddings?.data) || embeddings.data.length !== batch.length) throw new Error("無法建立教材向量。");
      await env.VECTORIZE.upsert(batch.map((item, itemIndex) => ({ id: item.id, values: embeddings.data[itemIndex], namespace: namespace(env) })));
    }
    await db.batch(records.map((item) => db.prepare("INSERT INTO ai_chunks (id,material_id,revision,content) VALUES (?,?,?,?)").bind(item.id, materialId, revision, item.content)));
    await db.prepare("UPDATE ai_materials SET index_state='ready',index_error='',index_format=2,updated_at=? WHERE id=? AND revision=?").bind(now(), materialId, revision).run();
  } catch (error) {
    await setIndexState(db, materialId, revision, "failed", error instanceof Error ? error.message : "AI 索引服務暫時無法使用。");
  }
  return materialRecord(db, materialId);
}

async function saveAiMaterial(db, resource, existingAiId, material) {
  const current = existingAiId ? await materialRecord(db, existingAiId) : null;
  const id = current?.id || crypto.randomUUID().replaceAll("-", "");
  const revision = Number(current?.revision || 0) + 1;
  await db.prepare(
    `INSERT INTO ai_materials (id,title,topic,source_url,full_text,status,revision,index_state,index_error,deleted,updated_at,index_format)
     VALUES (?,?,?,?,?,?,?,'pending','',0,?,1)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title,topic=excluded.topic,source_url=excluded.source_url,
       full_text=excluded.full_text,status=excluded.status,revision=excluded.revision,index_state='pending',index_error='',deleted=0,updated_at=excluded.updated_at`,
  ).bind(id, `${resource.title}｜${material.title}`, resource.title, material.sourceUrl, material.fullText, resource.status, revision, now()).run();
  return id;
}

export async function saveResourceMaterial(db, env, resource, materialId, input, context) {
  const material = validateResourceMaterial(input);
  const rows = await materialRows(db, resource.id);
  const existing = materialId ? rows.find((row) => row.id === materialId) : null;
  if (materialId && !existing) throw new Error("找不到這筆小教材，請重新整理後再試。");
  const id = existing?.id || `resource-material-${crypto.randomUUID()}`;
  const aiMaterialId = await saveAiMaterial(db, resource, existing?.aiMaterialId, material);
  await db.prepare(
    `INSERT INTO resource_materials (id,resource_id,title,material_type,source_url,image_url,ai_material_id,sort_order,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title,material_type=excluded.material_type,source_url=excluded.source_url,
       image_url=excluded.image_url,ai_material_id=excluded.ai_material_id,updated_at=excluded.updated_at`,
  ).bind(id, resource.id, material.title, material.materialType, material.sourceUrl, material.imageUrl, aiMaterialId, existing?.sortOrder || rows.length + 1, now()).run();
  context.waitUntil(syncMaterial(db, env, aiMaterialId));
  return (await materialRows(db, resource.id)).find((row) => row.id === id);
}

export async function deleteResourceMaterial(db, env, resourceId, materialId, context) {
  const rows = await materialRows(db, resourceId);
  const existing = rows.find((row) => row.id === materialId);
  if (!existing) throw new Error("找不到這筆小教材，請重新整理後再試。");
  if (existing.aiMaterialId) {
    const current = await materialRecord(db, existing.aiMaterialId);
    if (current) {
      const revision = Number(current.revision) + 1;
      await db.prepare("UPDATE ai_materials SET deleted=1,status='draft',full_text='',revision=?,index_state='pending',index_error='',updated_at=? WHERE id=?").bind(revision, now(), existing.aiMaterialId).run();
      context.waitUntil(syncMaterial(db, env, existing.aiMaterialId));
    }
  }
  await db.prepare("DELETE FROM resource_materials WHERE id=? AND resource_id=?").bind(materialId, resourceId).run();
}

export async function resyncResourceMaterial(db, env, resourceId, materialId) {
  const rows = await materialRows(db, resourceId);
  const existing = rows.find((row) => row.id === materialId);
  if (!existing?.aiMaterialId) throw new Error("找不到可同步的 AI 教材。");
  await syncMaterial(db, env, existing.aiMaterialId);
  return (await materialRows(db, resourceId)).find((row) => row.id === materialId);
}

export async function syncResourceMetadata(db, env, resource, context) {
  const rows = await materialRows(db, resource.id);
  for (const row of rows) {
    if (!row.aiMaterialId) continue;
    const current = await materialRecord(db, row.aiMaterialId);
    if (!current || Number(current.deleted)) continue;
    const revision = Number(current.revision) + 1;
    await db.prepare("UPDATE ai_materials SET title=?,topic=?,status=?,revision=?,index_state='pending',index_error='',updated_at=? WHERE id=?").bind(`${resource.title}｜${row.title}`, resource.title, resource.status, revision, now(), row.aiMaterialId).run();
    context.waitUntil(syncMaterial(db, env, row.aiMaterialId));
  }
}

export async function deleteResourceMaterials(db, env, resourceId, context) {
  const rows = await materialRows(db, resourceId);
  for (const row of rows) {
    await deleteResourceMaterial(db, env, resourceId, row.id, context);
  }
}
