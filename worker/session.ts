// HMAC-SHA256 서명 세션 쿠키 유틸 (Web Crypto, 의존성 없음)

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  SESSION_SECRET?: string;
}

const COOKIE_NAME = "sa_session";
const SESSION_DAYS = 30;

function secret(env: Env): string {
  // fail-closed: 시크릿 미설정 시 동작 거부 (로컬은 .dev.vars, 배포는
  // `wrangler secret put SESSION_SECRET` 로 주입)
  if (!env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET 미설정 — 세션 기능을 사용할 수 없습니다");
  }
  return env.SESSION_SECRET;
}

/** 브라우저발 교차 출처 POST 차단 (Origin 헤더가 있으면 same-origin 강제) */
export function sameOriginOk(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // 비브라우저 클라이언트(curl 등)
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createSessionCookie(env: Env, userId: string): Promise<string> {
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  const payload = `${userId}.${expires}`;
  const sig = await hmac(secret(env), payload);
  const value = `${payload}.${sig}`;
  return (
    `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; ` +
    `Max-Age=${SESSION_DAYS * 86400}`
  );
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** 쿠키 검증 → userId 또는 null */
export async function verifySession(env: Env, request: Request): Promise<string | null> {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const parts = match[1].split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresStr, sig] = parts;
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  const expected = await hmac(secret(env), `${userId}.${expiresStr}`);
  if (sig !== expected) return null;
  return userId;
}

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}
