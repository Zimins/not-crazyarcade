// REST API 핸들러 (인증·전적·방 목록) — Pages Functions에서 Worker로 이식

import {
  clearSessionCookie,
  createSessionCookie,
  json,
  sameOriginOk,
  verifySession,
  type Env,
} from "./session";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 혼동 문자 제외

function genRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => ROOM_CODE_CHARS[b % ROOM_CODE_CHARS.length]).join("");
}

function clampInt(v: unknown, min: number, max: number): number {
  return Number.isInteger(v) ? Math.max(min, Math.min(max, v as number)) : min;
}

async function authGuest(request: Request, env: Env): Promise<Response> {
  if (!sameOriginOk(request)) return json({ error: "forbidden" }, { status: 403 });

  let nickname = "물풍선";
  try {
    const body = (await request.json()) as { nickname?: string };
    if (typeof body.nickname === "string" && body.nickname.trim()) {
      nickname = body.nickname.trim().slice(0, 12);
    }
  } catch {
    // body 없으면 기본 닉네임
  }

  // 기존 세션 재사용: 같은 브라우저의 반복 로그인은 닉네임 변경으로 처리
  const existingId = await verifySession(env, request);
  if (existingId) {
    const existing = await env.DB.prepare(
      "UPDATE users SET nickname = ? WHERE id = ? RETURNING id, nickname, provider"
    )
      .bind(nickname, existingId)
      .first<{ id: string; nickname: string; provider: string }>();
    if (existing) return json(existing);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, nickname, provider) VALUES (?, ?, 'guest')")
    .bind(id, nickname)
    .run();
  const cookie = await createSessionCookie(env, id);
  return json(
    { id, nickname, provider: "guest" },
    { headers: { "Content-Type": "application/json", "Set-Cookie": cookie } }
  );
}

async function me(request: Request, env: Env): Promise<Response> {
  const userId = await verifySession(env, request);
  if (!userId) return json({ error: "unauthorized" }, { status: 401 });
  const user = await env.DB.prepare("SELECT id, nickname, provider FROM users WHERE id = ?")
    .bind(userId)
    .first<{ id: string; nickname: string; provider: string }>();
  if (!user) return json({ error: "unauthorized" }, { status: 401 });
  return json(user);
}

async function logout(request: Request): Promise<Response> {
  if (!sameOriginOk(request)) return json({ error: "forbidden" }, { status: 403 });
  return json(
    { ok: true },
    { headers: { "Content-Type": "application/json", "Set-Cookie": clearSessionCookie() } }
  );
}

async function recordMatch(request: Request, env: Env): Promise<Response> {
  if (!sameOriginOk(request)) return json({ error: "forbidden" }, { status: 403 });
  const userId = await verifySession(env, request);
  if (!userId) return json({ error: "unauthorized" }, { status: 401 });

  let body: { mapId?: number; charType?: number; won?: boolean; draw?: boolean; kills?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "bad request" }, { status: 400 });
  }
  if (body.won === true && body.draw === true) {
    return json({ error: "bad request" }, { status: 400 });
  }
  await env.DB.prepare(
    "INSERT INTO match_results (user_id, map_id, char_type, won, draw, kills) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      userId,
      clampInt(body.mapId, 0, 2),
      clampInt(body.charType, 0, 7),
      body.won ? 1 : 0,
      body.draw ? 1 : 0,
      clampInt(body.kills, 0, 99)
    )
    .run();
  return json({ ok: true });
}

async function stats(request: Request, env: Env): Promise<Response> {
  const userId = await verifySession(env, request);
  if (!userId) return json({ error: "unauthorized" }, { status: 401 });
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) AS wins,
       SUM(CASE WHEN won = 0 AND draw = 0 THEN 1 ELSE 0 END) AS losses,
       SUM(CASE WHEN draw = 1 THEN 1 ELSE 0 END) AS draws,
       SUM(kills) AS kills
     FROM match_results WHERE user_id = ?`
  )
    .bind(userId)
    .first<{ wins: number; losses: number; draws: number; kills: number }>();
  return json({
    wins: row?.wins ?? 0,
    losses: row?.losses ?? 0,
    draws: row?.draws ?? 0,
    kills: row?.kills ?? 0,
  });
}

function lobbyStub(env: Env): DurableObjectStub {
  return env.LOBBY.get(env.LOBBY.idFromName("global"));
}

async function listRooms(env: Env): Promise<Response> {
  return lobbyStub(env).fetch("https://lobby/list");
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  if (!sameOriginOk(request)) return json({ error: "forbidden" }, { status: 403 });
  const userId = await verifySession(env, request);
  if (!userId) return json({ error: "unauthorized" }, { status: 401 });

  let name = "물풍선 방";
  try {
    const body = (await request.json()) as { name?: string };
    if (typeof body.name === "string" && body.name.trim()) {
      name = body.name.trim().slice(0, 20);
    }
  } catch {
    // 기본 이름
  }
  const code = genRoomCode();
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  const res = await stub.fetch("https://room/create", {
    method: "POST",
    body: JSON.stringify({ name, code }),
  });
  if (!res.ok) return json({ error: "room create failed" }, { status: 500 });
  return json({ code, name });
}

/** /api/* 라우팅 */
export async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const m = request.method;
  try {
    if (pathname === "/api/auth/guest" && m === "POST") return await authGuest(request, env);
    if (pathname === "/api/me" && m === "GET") return await me(request, env);
    if (pathname === "/api/auth/logout" && m === "POST") return await logout(request);
    if (pathname === "/api/match" && m === "POST") return await recordMatch(request, env);
    if (pathname === "/api/stats" && m === "GET") return await stats(request, env);
    if (pathname === "/api/rooms" && m === "GET") return await listRooms(env);
    if (pathname === "/api/rooms" && m === "POST") return await createRoom(request, env);
    return json({ error: "not found" }, { status: 404 });
  } catch (err) {
    console.error("API error:", err);
    return json({ error: "internal" }, { status: 500 });
  }
}

/** /ws/room/:code → RoomDO 로 WebSocket 업그레이드 전달 */
export async function handleWs(request: Request, env: Env, url: URL): Promise<Response> {
  const m = url.pathname.match(/^\/ws\/room\/([A-Z0-9]{4,8})$/i);
  if (!m) return json({ error: "not found" }, { status: 404 });
  const code = m[1].toUpperCase();
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  const forwardUrl = new URL(request.url);
  forwardUrl.pathname = "/join";
  forwardUrl.searchParams.set("code", code);
  return stub.fetch(new Request(forwardUrl.toString(), request));
}
