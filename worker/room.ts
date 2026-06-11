// RoomDO — 방 1개 = Durable Object 1개. 최대 6인, 락스텝 입력 릴레이 서버.
//
// 넷코드: 서버는 시뮬레이션을 돌리지 않는다. 60Hz 틱 클록의 소유자로서
// 모든 플레이어의 현재 입력을 20Hz 배치(배치당 3틱)로 브로드캐스트하면,
// 결정적 WASM 코어를 가진 각 클라이언트가 동일한 시뮬레이션을 재생한다.

import type { Env } from "./session";

export const MAX_PLAYERS = 6;
/** 배치 주기(ms)와 배치당 틱 수 — 60Hz 시뮬레이션 기준 */
const BATCH_MS = 50;
const TICKS_PER_BATCH = 3;

interface Conn {
  ws: WebSocket;
  slot: number; // 0..5 (스폰/팀 슬롯)
  nickname: string;
  charType: number;
  /** 게임 중 현재 입력 비트마스크 */
  input: number;
  /** 시작 시점의 게임 플레이어 인덱스 (입력 프레임 배열 순서), 게임 미참여 시 -1 */
  gameIdx: number;
}

interface RoomMeta {
  name: string;
  code: string;
}

export class RoomDO {
  private meta: RoomMeta | null = null;
  private conns: Conn[] = [];
  private status: "waiting" | "playing" = "waiting";
  private mapId = 0;
  private tickNo = 0;
  private gameInputs: number[] = []; // 시작 순서 인덱스 → 현재 입력
  private batchTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private state: DurableObjectState,
    private env: Env
  ) {
    void this.state.blockConcurrencyWhile(async () => {
      this.meta = (await this.state.storage.get<RoomMeta>("meta")) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/create" && request.method === "POST") {
      const body = (await request.json()) as { name: string; code: string };
      this.meta = { name: body.name, code: body.code };
      await this.state.storage.put("meta", this.meta);
      await this.reportLobby();
      return new Response("ok");
    }

    if (url.pathname === "/join") {
      if (!this.meta) {
        // 코드로 직접 접속했는데 방이 만들어진 적 없는 경우
        return new Response("존재하지 않는 방", { status: 404 });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("websocket 필요", { status: 426 });
      }
      if (this.status === "playing") {
        return new Response("게임 진행 중", { status: 409 });
      }
      if (this.conns.length >= MAX_PLAYERS) {
        return new Response("정원 초과", { status: 409 });
      }

      const nickname = (url.searchParams.get("nick") ?? "물풍선").slice(0, 12);
      const charType = Math.min(3, Math.max(0, Number(url.searchParams.get("char")) || 0));

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();

      // 비어 있는 가장 낮은 슬롯 배정
      const used = new Set(this.conns.map((c) => c.slot));
      let slot = 0;
      while (used.has(slot)) slot++;

      const conn: Conn = { ws: server, slot, nickname, charType, input: 0, gameIdx: -1 };
      this.conns.push(conn);

      server.addEventListener("message", (ev) => this.onMessage(conn, ev));
      server.addEventListener("close", () => this.onLeave(conn));
      server.addEventListener("error", () => this.onLeave(conn));

      this.broadcastRoom();
      void this.reportLobby();
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  // ── 메시지 처리 ────────────────────────────────────────
  private onMessage(conn: Conn, ev: MessageEvent): void {
    let msg: { t?: string; v?: unknown };
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    } catch {
      return;
    }
    switch (msg.t) {
      case "char":
        if (this.status === "waiting") {
          conn.charType = Math.min(3, Math.max(0, Number(msg.v) || 0));
          this.broadcastRoom();
        }
        break;
      case "map":
        if (this.status === "waiting" && this.isHost(conn)) {
          this.mapId = Math.min(2, Math.max(0, Number(msg.v) || 0));
          this.broadcastRoom();
        }
        break;
      case "start":
        if (this.status === "waiting" && this.isHost(conn) && this.conns.length >= 2) {
          this.startGame();
        }
        break;
      case "input":
        if (this.status === "playing" && conn.gameIdx >= 0) {
          conn.input = Number(msg.v) & 31;
          this.gameInputs[conn.gameIdx] = conn.input;
        }
        break;
      case "result":
        // 호스트가 라운드 종료 보고 (결정적 시뮬이라 모든 클라 동일 결과)
        if (this.status === "playing" && this.isHost(conn)) {
          this.endGame(Number(msg.v));
        }
        break;
      default:
        break;
    }
  }

  private onLeave(conn: Conn): void {
    const idx = this.conns.indexOf(conn);
    if (idx < 0) return;
    this.conns.splice(idx, 1);
    try {
      conn.ws.close();
    } catch {
      /* 이미 닫힘 */
    }
    if (this.status === "playing") {
      // 게임 중 이탈: 해당 슬롯 입력을 0으로 고정 (캐릭터는 제자리에 남음)
      if (conn.gameIdx >= 0) this.gameInputs[conn.gameIdx] = 0;
      if (this.conns.length === 0) {
        this.stopBatchLoop();
        this.status = "waiting";
      } else if (this.conns.every((c) => c.gameIdx < 0)) {
        // 게임 참가자가 전부 나감 (관전자만 남는 경우는 없지만 방어)
        this.stopBatchLoop();
        this.status = "waiting";
        this.broadcastRoom();
      }
    }
    this.broadcastRoom();
    void this.reportLobby();
  }

  // ── 게임 진행 ──────────────────────────────────────────
  private startGame(): void {
    this.status = "playing";
    this.tickNo = 0;
    // u64 시드 (JSON은 BigInt 불가 → 문자열)
    const s = crypto.getRandomValues(new Uint32Array(2));
    const seed = ((BigInt(s[0]) << 32n) | BigInt(s[1])).toString();

    const players = [...this.conns]
      .sort((a, b) => a.slot - b.slot)
      .map((c, i) => {
        c.gameIdx = i;
        c.input = 0;
        return { slot: c.slot, nickname: c.nickname, charType: c.charType };
      });
    this.gameInputs = players.map(() => 0);

    this.broadcast({ t: "start", seed, mapId: this.mapId, players });
    void this.reportLobby();

    this.batchTimer = setInterval(() => {
      const batch = {
        t: "frames",
        start: this.tickNo,
        count: TICKS_PER_BATCH,
        inputs: [...this.gameInputs],
      };
      this.tickNo += TICKS_PER_BATCH;
      this.broadcast(batch);
    }, BATCH_MS);
  }

  private endGame(winnerTeam: number): void {
    this.stopBatchLoop();
    this.status = "waiting";
    for (const c of this.conns) {
      c.gameIdx = -1;
      c.input = 0;
    }
    this.broadcast({ t: "end", winnerTeam });
    this.broadcastRoom();
    void this.reportLobby();
  }

  private stopBatchLoop(): void {
    if (this.batchTimer !== null) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }

  // ── 유틸 ───────────────────────────────────────────────
  private isHost(conn: Conn): boolean {
    // 가장 낮은 슬롯이 호스트
    return this.conns.length > 0 && conn.slot === Math.min(...this.conns.map((c) => c.slot));
  }

  private broadcast(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const c of this.conns) {
      try {
        c.ws.send(data);
      } catch {
        /* 닫힌 소켓은 close 핸들러가 정리 */
      }
    }
  }

  private broadcastRoom(): void {
    if (!this.meta) return;
    const hostSlot = this.conns.length > 0 ? Math.min(...this.conns.map((c) => c.slot)) : -1;
    const players = [...this.conns]
      .sort((a, b) => a.slot - b.slot)
      .map((c) => ({ slot: c.slot, nickname: c.nickname, charType: c.charType }));
    for (const c of this.conns) {
      try {
        c.ws.send(
          JSON.stringify({
            t: "room",
            code: this.meta.code,
            name: this.meta.name,
            you: c.slot,
            host: hostSlot,
            status: this.status,
            mapId: this.mapId,
            players,
          })
        );
      } catch {
        /* 무시 */
      }
    }
  }

  private async reportLobby(): Promise<void> {
    if (!this.meta) return;
    const stub = this.env.LOBBY.get(this.env.LOBBY.idFromName("global"));
    await stub
      .fetch("https://lobby/update", {
        method: "POST",
        body: JSON.stringify({
          code: this.meta.code,
          name: this.meta.name,
          count: this.conns.length,
          max: MAX_PLAYERS,
          status: this.status,
        }),
      })
      .catch(() => {
        /* 로비 보고 실패는 게임에 영향 없음 */
      });
  }
}
