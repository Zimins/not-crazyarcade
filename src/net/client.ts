// 멀티플레이 클라이언트: 방 목록 API + 방 WebSocket 연결.
//
// 넷코드(클라 측): 서버가 보내는 입력 프레임 배치를 큐에 쌓고,
// 결정적 WASM 시뮬레이션을 프레임 단위로 재생한다 (락스텝).

export interface RoomListing {
  code: string;
  name: string;
  count: number;
  max: number;
  status: "waiting" | "playing";
}

export interface RoomPlayer {
  slot: number;
  nickname: string;
  charType: number;
}

export interface RoomState {
  code: string;
  name: string;
  you: number;
  host: number;
  status: "waiting" | "playing";
  mapId: number;
  players: RoomPlayer[];
}

export interface StartInfo {
  seed: string;
  mapId: number;
  players: RoomPlayer[];
  /** 이 클라이언트의 슬롯 — start 메시지가 직접 싣고 와 room 수신 여부와 무관하게 진입 가능 */
  you: number;
}

export interface FrameBatch {
  start: number;
  count: number;
  inputs: number[];
}

export async function fetchRooms(): Promise<RoomListing[]> {
  const res = await fetch("/api/rooms", { credentials: "include" });
  if (!res.ok) throw new Error(`방 목록 조회 실패 (${res.status})`);
  const data = (await res.json()) as { rooms: RoomListing[] };
  return data.rooms;
}

export async function createRoom(name: string): Promise<string> {
  const res = await fetch("/api/rooms", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`방 만들기 실패 (${res.status})`);
  const data = (await res.json()) as { code: string };
  return data.code;
}

export interface RoomCallbacks {
  onRoom?: (room: RoomState) => void;
  onStart?: (info: StartInfo) => void;
  onFrames?: (batch: FrameBatch) => void;
  onEnd?: (winnerTeam: number) => void;
  onClose?: (reason: string) => void;
}

/** heartbeat 주기(ms). 배포(Cloudflare 엣지/NAT/프록시)에서 idle WebSocket이
 *  조용히 끊기는 것을 막는다 — 대기실은 입력이 없어 완전 idle이므로 필수. */
const HEARTBEAT_MS = 20000;

export class RoomConnection {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  callbacks: RoomCallbacks = {};

  connect(code: string, nickname: string, charType: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const url =
        `${proto}://${location.host}/ws/room/${encodeURIComponent(code)}` +
        `?nick=${encodeURIComponent(nickname)}&char=${charType}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        this.startHeartbeat();
        resolve();
      };
      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        switch (msg.t) {
          case "room":
            this.callbacks.onRoom?.(msg as unknown as RoomState);
            break;
          case "start":
            this.callbacks.onStart?.(msg as unknown as StartInfo);
            break;
          case "frames":
            this.callbacks.onFrames?.(msg as unknown as FrameBatch);
            break;
          case "end":
            this.callbacks.onEnd?.(Number(msg.winnerTeam));
            break;
          default:
            break;
        }
      };
      ws.onclose = () => {
        this.stopHeartbeat();
        if (!opened) reject(new Error("방 접속 실패 (정원 초과 또는 게임 진행 중)"));
        else if (!this.closedByUs) this.callbacks.onClose?.("연결이 끊어졌습니다");
      };
      ws.onerror = () => {
        if (!opened) reject(new Error("방 접속 실패"));
      };
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.send({ t: "ping" }), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendChar(v: number): void {
    this.send({ t: "char", v });
  }
  sendMap(v: number): void {
    this.send({ t: "map", v });
  }
  sendStart(): void {
    this.send({ t: "start" });
  }
  sendInput(v: number): void {
    this.send({ t: "input", v });
  }
  sendResult(winnerTeam: number): void {
    this.send({ t: "result", v: winnerTeam });
  }

  close(): void {
    this.closedByUs = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }
}
