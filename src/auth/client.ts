// 인증/전적 클라이언트 — 익명(게스트) 로그인 우선.
// 백엔드(Cloudflare Pages Functions) 부재 시 localStorage 폴백으로 항상 동작.
// Google/GitHub OAuth는 Provider 타입으로 확장 포인트만 잡아둠.

export type Provider = "guest" | "google" | "github";

export interface UserProfile {
  id: string;
  nickname: string;
  provider: Provider;
}

export interface MatchRecord {
  mapId: number;
  charType: number;
  won: boolean;
  draw: boolean;
  kills: number;
}

export interface UserStats {
  wins: number;
  losses: number;
  draws: number;
  kills: number;
}

const LS_PROFILE = "splash-arena:profile";
const LS_STATS = "splash-arena:stats";

let cachedUser: UserProfile | null = null;
let backendAvailable: boolean | null = null;

class ApiError extends Error {
  constructor(readonly status: number, path: string) {
    super(`API ${path} → ${status}`);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new ApiError(res.status, path);
  return res.json() as Promise<T>;
}

function localProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(LS_PROFILE);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    localStorage.removeItem(LS_PROFILE);
    return null;
  }
}

function localStats(): UserStats {
  try {
    const raw = localStorage.getItem(LS_STATS);
    return raw ? (JSON.parse(raw) as UserStats) : { wins: 0, losses: 0, draws: 0, kills: 0 };
  } catch {
    return { wins: 0, losses: 0, draws: 0, kills: 0 };
  }
}

/** 세션 복구: 백엔드 쿠키 세션 → 로컬 폴백 순 */
export async function restoreSession(): Promise<UserProfile | null> {
  try {
    const me = await api<UserProfile>("/me");
    backendAvailable = true;
    cachedUser = me;
    return me;
  } catch (err) {
    // 401 = 백엔드는 살아 있고 단지 미로그인 (네트워크 실패와 구분)
    backendAvailable = err instanceof ApiError && err.status === 401;
    cachedUser = localProfile();
    return cachedUser;
  }
}

/** 익명 로그인 — 닉네임으로 시작. 백엔드 있으면 D1 유저+세션 쿠키, 없으면 로컬 전용. */
export async function guestLogin(nickname: string): Promise<UserProfile> {
  const clean = nickname.trim().slice(0, 12) || "물풍선";
  try {
    const user = await api<UserProfile>("/auth/guest", {
      method: "POST",
      body: JSON.stringify({ nickname: clean }),
    });
    backendAvailable = true;
    cachedUser = user;
    localStorage.setItem(LS_PROFILE, JSON.stringify(user));
    return user;
  } catch {
    backendAvailable = false;
    const user: UserProfile = {
      id: `local-${crypto.randomUUID().slice(0, 8)}`,
      nickname: clean,
      provider: "guest",
    };
    cachedUser = user;
    localStorage.setItem(LS_PROFILE, JSON.stringify(user));
    return user;
  }
}

export function currentUser(): UserProfile | null {
  return cachedUser;
}

export async function logout(): Promise<void> {
  cachedUser = null;
  localStorage.removeItem(LS_PROFILE);
  if (backendAvailable) {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* 무시 */
    }
  }
}

/** 전적 기록 — 백엔드 실패 시 로컬 누적 */
export async function recordMatch(rec: MatchRecord): Promise<void> {
  const stats = localStats();
  if (rec.draw) stats.draws++;
  else if (rec.won) stats.wins++;
  else stats.losses++;
  stats.kills += rec.kills;
  localStorage.setItem(LS_STATS, JSON.stringify(stats));

  if (backendAvailable && cachedUser && !cachedUser.id.startsWith("local-")) {
    try {
      await api("/match", { method: "POST", body: JSON.stringify(rec) });
    } catch {
      /* 로컬에는 이미 저장됨 */
    }
  }
}

export async function getStats(): Promise<UserStats> {
  if (backendAvailable && cachedUser && !cachedUser.id.startsWith("local-")) {
    try {
      return await api<UserStats>("/stats");
    } catch {
      /* 폴백 */
    }
  }
  return localStats();
}
