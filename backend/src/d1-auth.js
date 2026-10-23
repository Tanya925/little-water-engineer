// 老師登入：延續舊站既有的 scrypt 雜湊格式，session 僅保存雜湊後的 token。
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const sessionDuration = 8 * 60 * 60 * 1000;

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function cookie(request, name) {
  return new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(request.headers.get("cookie") || "")?.[1] || "";
}

export async function sessionFor(request, db) {
  const token = cookie(request, "teacher_session");
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await db
    .prepare("SELECT username, expires_at AS expiresAt FROM teacher_sessions WHERE token_hash = ?")
    .bind(tokenHash(token))
    .first();
  if (!row || row.expiresAt <= Date.now()) {
    if (row) void db.prepare("DELETE FROM teacher_sessions WHERE token_hash = ?").bind(tokenHash(token)).run();
    return null;
  }
  return { username: row.username, token };
}

export async function authenticate(db, username, password) {
  if (typeof username !== "string" || typeof password !== "string") return null;
  const account = await db
    .prepare("SELECT username, password_hash AS hash, salt FROM teacher_accounts WHERE username = ?")
    .bind(username)
    .first();
  if (!account) return null;
  const candidate = scryptSync(password, account.salt, 64).toString("hex");
  const expected = Buffer.from(account.hash, "hex");
  const received = Buffer.from(candidate, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received) ? account : null;
}

export async function signIn(db, username, secure) {
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + sessionDuration;
  await db
    .prepare("INSERT INTO teacher_sessions (token_hash, username, expires_at) VALUES (?, ?, ?)")
    .bind(tokenHash(token), username, expires)
    .run();
  return `teacher_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? "; Secure" : ""}`;
}

export async function signOut(db, request, secure) {
  const token = cookie(request, "teacher_session");
  if (/^[a-f0-9]{64}$/.test(token)) {
    await db.prepare("DELETE FROM teacher_sessions WHERE token_hash = ?").bind(tokenHash(token)).run();
  }
  return `teacher_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}
