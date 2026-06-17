// RoomDO — 방 1개 = Durable Object 1개. 최대 6인, 락스텝 입력 릴레이 서버.
//
// 넷코드: 서버는 시뮬레이션을 돌리지 않는다. 60Hz 틱 클록의 소유자로서
// 모든 플레이어의 현재 입력을 20Hz 배치(배치당 3틱)로 브로드캐스트하면,
// 결정적 WASM 코어를 가진 각 클라이언트가 동일한 시뮬레이션을 재생한다.
//
// WebSocket은 Hibernation API(state.acceptWebSocket)로 받는다 — 연결을 요청
// 컨텍스트가 아니라 DO 인스턴스에 영구 소속시켜 다른 요청/이벤트에서 send해도
// 안전하다. non-hibernation server.accept()는 배포 환경(실제 Cloudflare)에서
// WS를 accept한 요청이 끝난 뒤 다른 연결의 broadcast가 그 WS에 send하면
// "Network connection lost"로 깨진다(두 번째 입장자부터 연결 실패). 로컬
// wrangler dev는 단일 프로세스라 이를 관대하게 처리해 재현되지 않았다.

import type { Env } from "./session";

export const MAX_PLAYERS = 6;
/** 캐릭터 타입 상한 (src/ui/screens.ts CHAR_INFO 길이 - 1과 동기화) */
const MAX_CHAR_TYPE = 7;
/** 배치 주기(ms)와 배치당 틱 수 — 60Hz 시뮬레이션 기준 */
const BATCH_MS = 50;
const TICKS_PER_BATCH = 3;

/** WebSocket attachment에 저장하는 연결 메타데이터 — hibernation 후에도 보존된다 */
interface ConnMeta {
  slot: number; // 0..5 (스폰/팀 슬롯)
  nickname: string;
  charType: number;
  /** 시작 시점의 게임 플레이어 인덱스(입력 프레임 배열 순서), 게임 미참여 시 -1 */
  gameIdx: number;
}

interface RoomMeta {
  name: string;
  code: string;
}

export class RoomDO {
  private meta: RoomMeta | null = null;
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
      // 대기실에서 hibernate됐다 깨어나도 맵 선택을 잃지 않도록 storage에 보존
      this.mapId = (await this.state.storage.get<number>("mapId")) ?? 0;
    });
    // heartbeat: 클라 {t:"ping"}에 DO를 깨우지 않고 자동 {t:"pong"} 응답
    // (idle 연결 유지 + hibernation 비용 절감)
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ t: "ping" }), JSON.stringify({ t: "pong" }))
    );
  }

  /** 현재 연결된 WebSocket 목록 (hibernation: DO 인스턴스에 영구 소속) */
  private sockets(): WebSocket[] {
    return this.state.getWebSockets();
  }
  private metaOf(ws: WebSocket): ConnMeta {
    return ws.deserializeAttachment() as ConnMeta;
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

      const existing = this.sockets();
      if (existing.length >= MAX_PLAYERS) {
        return new Response("정원 초과", { status: 409 });
      }

      const nickname = (url.searchParams.get("nick") ?? "물풍선").slice(0, 12);
      const charType = Math.min(MAX_CHAR_TYPE, Math.max(0, Number(url.searchParams.get("char")) || 0));

      // 비어 있는 가장 낮은 슬롯 배정
      const used = new Set(existing.map((ws) => this.metaOf(ws).slot));
      let slot = 0;
      while (used.has(slot)) slot++;

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      const meta: ConnMeta = { slot, nickname, charType, gameIdx: -1 };
      server.serializeAttachment(meta);
      this.state.acceptWebSocket(server);

      this.broadcastRoom();
      void this.reportLobby();
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  // ── Hibernation WebSocket 핸들러 ───────────────────────
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    let msg: { t?: string; v?: unknown };
    try {
      msg = JSON.parse(typeof message === "string" ? message : "");
    } catch {
      return;
    }
    const meta = this.metaOf(ws);
    switch (msg.t) {
      case "char":
        if (this.status === "waiting") {
          meta.charType = Math.min(MAX_CHAR_TYPE, Math.max(0, Number(msg.v) || 0));
          ws.serializeAttachment(meta);
          this.broadcastRoom();
        }
        break;
      case "map":
        if (this.status === "waiting" && this.isHost(meta)) {
          this.mapId = Math.min(2, Math.max(0, Number(msg.v) || 0));
          void this.state.storage.put("mapId", this.mapId);
          this.broadcastRoom();
        }
        break;
      case "start":
        if (this.status === "waiting" && this.isHost(meta) && this.sockets().length >= 2) {
          this.startGame();
        }
        break;
      case "input":
        if (this.status === "playing" && meta.gameIdx >= 0) {
          this.gameInputs[meta.gameIdx] = Number(msg.v) & 31;
        }
        break;
      case "ping":
        // 보통은 setWebSocketAutoResponse가 처리하지만, 형식이 다른 ping도 안전하게 응답
        try {
          ws.send(JSON.stringify({ t: "pong" }));
        } catch {
          /* 닫힌 소켓은 close 핸들러가 정리 */
        }
        break;
      case "result":
        // 호스트가 라운드 종료 보고 (결정적 시뮬이라 모든 클라 동일 결과)
        if (this.status === "playing" && this.isHost(meta)) {
          this.endGame(Number(msg.v));
        }
        break;
      default:
        break;
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.onLeave(ws);
  }
  webSocketError(ws: WebSocket): void {
    this.onLeave(ws);
  }

  private onLeave(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      /* 이미 닫힘 */
    }
    const meta = this.metaOf(ws);
    const remaining = this.sockets().filter((s) => s !== ws);
    if (this.status === "playing") {
      // 게임 중 이탈: 해당 슬롯 입력을 0으로 고정 (캐릭터는 제자리에 남음)
      if (meta.gameIdx >= 0) this.gameInputs[meta.gameIdx] = 0;
      // 모두 나갔거나 게임 참가자가 전부 빠지면 대기 상태로 복귀
      if (remaining.length === 0 || remaining.every((s) => this.metaOf(s).gameIdx < 0)) {
        this.stopBatchLoop();
        this.status = "waiting";
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

    const ordered = [...this.sockets()].sort((a, b) => this.metaOf(a).slot - this.metaOf(b).slot);
    const players = ordered.map((ws, i) => {
      const m = this.metaOf(ws);
      m.gameIdx = i;
      ws.serializeAttachment(m);
      return { slot: m.slot, nickname: m.nickname, charType: m.charType };
    });
    this.gameInputs = players.map(() => 0);

    // start는 각 클라이언트에 자신의 슬롯(you)을 직접 실어 보낸다 — 입장 직후 room을
    // 놓친 클라이언트도 room 재수신 없이 바로 게임에 진입할 수 있도록(대기실 갇힘 방지).
    const mapId = this.mapId;
    for (const ws of ordered) {
      try {
        ws.send(JSON.stringify({ t: "start", seed, mapId, players, you: this.metaOf(ws).slot }));
      } catch {
        /* 닫힌 소켓은 close 핸들러가 정리 */
      }
    }
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
    for (const ws of this.sockets()) {
      const m = this.metaOf(ws);
      m.gameIdx = -1;
      ws.serializeAttachment(m);
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
  private isHost(meta: ConnMeta): boolean {
    // 가장 낮은 슬롯이 호스트
    const slots = this.sockets().map((s) => this.metaOf(s).slot);
    return slots.length > 0 && meta.slot === Math.min(...slots);
  }

  private broadcast(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets()) {
      try {
        ws.send(data);
      } catch {
        /* 닫힌 소켓은 close 핸들러가 정리 */
      }
    }
  }

  private broadcastRoom(): void {
    if (!this.meta) return;
    const sockets = this.sockets();
    const metas = sockets.map((ws) => this.metaOf(ws));
    const hostSlot = metas.length > 0 ? Math.min(...metas.map((m) => m.slot)) : -1;
    const players = [...metas]
      .sort((a, b) => a.slot - b.slot)
      .map((m) => ({ slot: m.slot, nickname: m.nickname, charType: m.charType }));
    for (const ws of sockets) {
      try {
        ws.send(
          JSON.stringify({
            t: "room",
            code: this.meta.code,
            name: this.meta.name,
            you: this.metaOf(ws).slot,
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
          count: this.sockets().length,
          max: MAX_PLAYERS,
          status: this.status,
        }),
      })
      .catch(() => {
        /* 로비 보고 실패는 게임에 영향 없음 */
      });
  }
}
