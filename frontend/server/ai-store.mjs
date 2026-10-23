// 主要功能：保存 AI 教材全文與分段，管理版本、發布資格、索引狀態和可引用片段，提供助教公開活動情境。
/*
 * SQLite 保存教材全文與片段；Cloudflare Vectorize 只負責向量搜尋。
 * 每次改稿都增加 revision，片段 ID 包含版本，舊片段保留到遠端刪除成功才清理。
 * 搜尋結果必須重新核對本機發布狀態、最新版本及 ready 狀態，才可以作為回答證據。
 */
import { randomBytes } from "node:crypto";
import { ContentError } from "./management.mjs";

// 用 Unicode 字元分段，盡量在句尾切開；預設每段 700 字、重疊 100 字，保留跨段語意。
export function splitMaterial(text, size = 700, overlap = 100) {
  const chars = Array.from(text.replace(/\r\n?/g, "\n").trim());
  const chunks = [];
  for (let start = 0; start < chars.length; ) {
    let end = Math.min(start + size, chars.length);
    if (end < chars.length) {
      const tail = chars.slice(start + Math.floor(size * 0.65), end);
      const boundary = Math.max(
        tail.lastIndexOf("\n"),
        tail.lastIndexOf("。"),
        tail.lastIndexOf("！"),
        tail.lastIndexOf("？"),
      );
      if (boundary >= 0) {
        end = start + Math.floor(size * 0.65) + boundary + 1;
      }
    }
    const content = chars.slice(start, end).join("").trim();
    if (content) {
      chunks.push(content);
    }
    if (end === chars.length) {
      break;
    }
    start = end - overlap;
  }

  return chunks;
}

// 建表並回傳教材／片段存取方法；index_state 表示遠端同步狀態，並不等同於發布狀態。
export function aiStore(db, games = []) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_materials (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL, source_url TEXT NOT NULL,
    full_text TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
    index_state TEXT NOT NULL DEFAULT 'pending', index_error TEXT NOT NULL DEFAULT '',
    index_format INTEGER NOT NULL DEFAULT 2,
    deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS ai_chunks (
    id TEXT PRIMARY KEY, material_id TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ai_chunks_material ON ai_chunks(material_id);`);
  // v2 的向量內容加入章節與教材名稱。舊版服務不知道此欄位，因此即使它把
  // index_state 寫回 ready，新版重啟後仍會再同步一次，確保舊向量不會漏掉名稱。
  if (!db.prepare("PRAGMA table_info(ai_materials)").all().some((row) => row.name === "index_format")) {
    db.exec("ALTER TABLE ai_materials ADD COLUMN index_format INTEGER NOT NULL DEFAULT 1");
  }
  // 把 SQLite 的 snake_case 欄位轉成 API 使用的 camelCase，並計算目前版本的片段數。
  // 這個數量只供後台顯示，不代表遠端索引已完成；真正狀態應讀 indexState。
  const decode = (r) => ({
    id: r.id,
    title: r.title,
    topic: r.topic,
    sourceUrl: r.source_url,
    fullText: r.full_text,
    status: r.status,
    revision: r.revision,
    indexState: r.index_state,
    indexError: r.index_error,
    deleted: Boolean(r.deleted),
    updatedAt: r.updated_at,
    chunkCount: db
      .prepare("SELECT count(*) AS n FROM ai_chunks WHERE material_id=? AND revision=?")
      .get(r.id, r.revision).n,
  });

  // 一般查詢隱藏軟刪除紀錄；同步流程可傳入 includeDeleted=true，
  // 取得刪除後仍需清理的舊向量與版本資訊。
  function find(id, includeDeleted = false) {
    const row = db.prepare("SELECT * FROM ai_materials WHERE id=?").get(id);
    if (!row || (row.deleted && !includeDeleted)) {
      throw new ContentError("找不到這份 AI 教材。", 404);
    }

    return decode(row);
  }

  // 更新全文與片段要一起成功；有錯便 ROLLBACK，避免全文和片段屬於不同版本。
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      db.exec("COMMIT");

      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  // 全文上限 100,000 字元，來源只接受 Drive／Docs HTTPS 網址；此處不會下載或轉錄音檔。
  function validate(input) {
    const text = (value, label, max, required = true) => {
      if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
        throw new ContentError(`${label}需填寫，且不可超過 ${max} 個字元。`);
      }

      return value.trim();
    };
    const title = text(input?.title, "教材名稱", 200);
    const topic = text(input?.topic ?? "", "主題", 100, false);
    const fullText = text(input?.fullText, "教材全文", 100000);
    const sourceUrl = text(input?.sourceUrl, "Google Drive 教材連結", 1500);
    let url;
    try {
      url = new URL(sourceUrl);
    } catch {
      throw new ContentError("請填寫有效的 Google Drive 教材連結。");
    }
    if (
      url.protocol !== "https:" ||
      !["drive.google.com", "docs.google.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw new ContentError("教材連結需為 Google Drive 或 Google 文件的 HTTPS 網址。");
    }
    if (!["published", "draft"].includes(input.status)) {
      throw new ContentError("請選擇發布或下架。");
    }

    return { title, topic, fullText, sourceUrl: url.href, status: input.status };
  }

  return {
    // 後台清單只顯示未刪除教材，並讓最近修改的教材排在最前面。
    aiList() {
      return db
        .prepare("SELECT * FROM ai_materials WHERE deleted=0 ORDER BY updated_at DESC, id")
        .all()
        .map(decode);
    },
    aiFind: find,
    // 同一教材每次儲存產生新版片段；舊片段先保留，讓同步程序能找到需要刪除的遠端 ID。
    aiSave(id, input) {
      const v = validate(input);
      const current = id ? find(id) : null;
      if (current && current.revision !== input.revision) {
        throw new ContentError("教材已更新，請重新開啟編輯。", 409);
      }
      id ||= randomBytes(16).toString("hex");
      const revision = (current?.revision || 0) + 1;
      transaction(() => {
        db.prepare(
          `INSERT INTO ai_materials (id,title,topic,source_url,full_text,status,revision)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,topic=excluded.topic,
          source_url=excluded.source_url,full_text=excluded.full_text,status=excluded.status,revision=excluded.revision,
          index_state='pending',index_error='',updated_at=CURRENT_TIMESTAMP`,
        ).run(id, v.title, v.topic, v.sourceUrl, v.fullText, v.status, revision);
        if (v.status === "published") {
          splitMaterial(v.fullText).forEach((content, i) =>
            db
              .prepare("INSERT INTO ai_chunks (id,material_id,revision,content) VALUES (?,?,?,?)")
              .run(`${id}-${revision}-${i}`, id, revision, content),
          );
        }
      });

      return find(id);
    },
    // 軟刪除：立刻移除引用資格並清空全文，保留紀錄直到遠端舊向量也完成清理。
    aiDelete(id, revision) {
      const item = find(id);
      if (item.revision !== revision) {
        throw new ContentError("教材已更新，請重新載入後刪除。", 409);
      }
      db.prepare(
        `UPDATE ai_materials
         SET deleted = 1, full_text = '', revision = revision + 1,
             index_state = 'pending', index_error = '', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(id);
    },

    // 回傳所有尚未成功同步的教材 ID，包括下架及已軟刪除的資料，
    // 因為這兩種狀態仍可能需要從 Vectorize 清除舊片段。
    aiPending() {
      return db
        .prepare("SELECT id FROM ai_materials WHERE index_state != 'ready' OR index_format != 2")
        .all()
        .map((r) => r.id);
    },

    // 同步程序需要同時取得新舊版本片段，才能先刪除失效 ID 再上傳最新版。
    aiChunks(id) {
      return db.prepare("SELECT * FROM ai_chunks WHERE material_id=? ORDER BY id").all(id);
    },

    // 只有遠端刪除已成功後才能移除本機舊片段；保留它們才能在網路失敗時重試。
    aiRemoveChunks(ids) {
      transaction(() =>
        ids.forEach((id) => db.prepare("DELETE FROM ai_chunks WHERE id=?").run(id)),
      );
    },

    // revision 條件防止較慢的舊同步工作覆蓋較新版本的同步狀態。
    aiIndexState(id, revision, state, error = "") {
      db.prepare(
        `UPDATE ai_materials
         SET index_state=?, index_error=?,
             index_format=CASE WHEN ?='ready' THEN 2 ELSE index_format END
         WHERE id=? AND revision=?`,
      ).run(state, error, state, id, revision);
    },
    // 向量服務只回傳 ID 與分數；真正能引用的文字必須回到本機逐筆驗證版本與發布資格。
    aiResolveMatches(matches, threshold, topK) {
      const rows = [];
      const seen = new Set();
      for (const match of matches) {
        if (!Number.isFinite(match.score) || match.score < threshold || seen.has(match.id)) {
          continue;
        }
        seen.add(match.id);
        const row = db
          .prepare(
            `SELECT c.id,c.content,c.revision,c.material_id AS materialId,m.title,m.topic,m.source_url AS sourceUrl,
            COALESCE(rm.image_url,'') AS imageUrl
          FROM ai_chunks c JOIN ai_materials m ON m.id=c.material_id
          LEFT JOIN resource_materials rm ON rm.ai_material_id=m.id
          WHERE c.id=? AND m.deleted=0 AND m.status='published' AND m.index_state='ready' AND c.revision=m.revision`,
          )
          .get(match.id);
        if (row) {
          rows.push({ ...row, score: match.score });
        }
      }

      return rows.sort((a, b) => b.score - a.score).slice(0, topK);
    },

    // 中文短問句有時與向量片段的相似度不足，卻明確包含教材關鍵詞。
    // 此備援只在本機的「已發布、已完成索引、目前版本」片段中比對，不引入外部知識。
    aiKeywordMatches(question, topK) {
      const rawQuestion = String(question || "");
      const compact = rawQuestion.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
      const terms = new Set();
      // 「所以」、「然後」等語氣或連接詞不代表學生要找的概念；保留它們會把
      // 不相關的教材片段一起選進來，反而干擾後續模型判斷。
      const stopTerms = new Set([
        "所以",
        "但是",
        "然後",
        "就是",
        "什麼",
        "怎麼",
        "可以",
        "到底",
        "請問",
        "一下",
        "這個",
        "那個",
        "為何",
        "為甚",
      ]);
      const chars = Array.from(compact);
      for (let size = 2; size <= 4; size += 1) {
        for (let start = 0; start + size <= chars.length; start += 1) {
          const term = chars.slice(start, start + size).join("");
          if (!stopTerms.has(term)) terms.add(term);
        }
      }
      String(question || "")
        .toLowerCase()
        .match(/[a-z][a-z0-9-]{1,}/g)
        ?.forEach((term) => terms.add(term));
      if (!terms.size) return [];
      const rows = db
        .prepare(
          `SELECT c.id,c.content,c.revision,c.material_id AS materialId,m.title,m.topic,m.source_url AS sourceUrl,
            COALESCE(rm.image_url,'') AS imageUrl
           FROM ai_chunks c JOIN ai_materials m ON m.id=c.material_id
           LEFT JOIN resource_materials rm ON rm.ai_material_id=m.id
           WHERE m.deleted=0 AND m.status='published' AND m.index_state='ready' AND c.revision=m.revision`,
        )
        .all();
      const compactTitle = (row) => String(row.title || "").replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
      // 題號是學生最明確的教材指定，例如「習題 1-5」。若已說出題號，不能
      // 被前一題或同樣出現「質量」等詞的其他教材搶走，直接限定到該教材。
      const exercise = /習題\s*(\d+)\s*[-－—_.]\s*(\d+)/u.exec(rawQuestion);
      if (exercise) {
        const requested = `習題${exercise[1]}${exercise[2]}`;
        const exactExercise = rows.filter((row) => compactTitle(row).includes(requested));
        if (exactExercise.length) {
          return exactExercise
            .slice(0, topK)
            .map((row) => ({ ...row, score: 1, exactTarget: true }));
        }
      }
      // 同一個詞出現在越少教材片段，越可能是學生真正想問的概念。例如「質量」
      // 應比常見的語氣詞或一般動詞更優先。
      const searchable = (row) => {
        const value = `${row.title}\n${row.topic}\n${row.content}`;
        // 題號常被輸入成「2-1」、「2.1」或「21」；保留原文與去除分隔符的版本，
        // 讓名稱關鍵字不會因輸入格式不同而失效。
        return `${value}\n${value.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "")}`;
      };
      const frequencies = new Map(
        [...terms].map((term) => [
          term,
          rows.reduce((count, row) => count + Number(searchable(row).includes(term)), 0),
        ]),
      );
      const matches = rows
        .map((row) => ({
          ...row,
          score: [...terms].reduce((count, term) => {
            if (!searchable(row).includes(term)) return count;
            const frequency = frequencies.get(term) || 0;
            return count + term.length * Math.log((rows.length + 1) / (frequency + 1));
          }, 0),
        }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      const highest = matches[0]?.score || 0;
      return matches
        // 只留下與最佳命中足夠接近的片段，避免把弱關聯內容塞進同一次回答。
        .filter((row) => row.score >= highest * 0.6)
        .slice(0, topK)
        .map((row) => ({ ...row, score: 1 }));
    },

    // 只有已發布且索引完成的教材才能啟用一般問答；草稿及同步失敗不計入。
    aiHasReady() {
      return Boolean(
        db
          .prepare(
            "SELECT 1 FROM ai_materials WHERE deleted=0 AND status='published' AND index_state='ready'",
          )
          .get(),
      );
    },

    // 助教只取得學生目前看得到的題目與選項，不讀正確答案或解析欄位，
    // 以資料選取邊界防止模型在提示中洩露答案。
    aiTutorQuestion(id) {
      const row = db
        .prepare(
          "SELECT id,question,options_json FROM quiz_questions WHERE id=? AND status='published'",
        )
        .get(id);
      if (!row) {
        throw new ContentError("目前題目不存在，請重新開始練習。", 404);
      }

      return {
        kind: "quiz",
        id: row.id,
        question: row.question,
        options: JSON.parse(row.options_json),
      };
    },

    // 遊戲資料來自伺服器啟動時載入的公開定義。只複製任務情境與目標，
    // 即使未來原始物件加入評分資料，也不會自動傳給模型。
    aiTutorGame(id, taskId) {
      const game = games.find((g) => g.id === id);
      const task = game?.tasks?.find((t) => t.id === taskId);
      if (!game || !task) {
        throw new ContentError("目前還沒有進行中的遊戲任務，請先到知識小學堂開始挑戰。", 409);
      }

      return {
        kind: "game",
        id: game.id,
        taskId: task.id,
        title: String(game.title).slice(0, 200),
        mission: String(task.mission || "").slice(0, 2000),
        situation: String(task.situation || "").slice(0, 2000),
      };
    },
  };
}
