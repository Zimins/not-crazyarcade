// LobbyDO — 방 목록 싱글톤. RoomDO가 상태 변화 시 보고하고, 클라이언트는 /api/rooms 로 조회.

export interface RoomListing {
  code: string;
  name: string;
  count: number;
  max: number;
  status: "waiting" | "playing";
  updatedAt: number;
}

/** 이 시간 동안 갱신 없는 방은 죽은 것으로 간주하고 숨김 */
const STALE_MS = 5 * 60_000;

export class LobbyDO {
  private rooms: Record<string, RoomListing> | null = null;

  constructor(private state: DurableObjectState) {}

  private async load(): Promise<Record<string, RoomListing>> {
    if (!this.rooms) {
      this.rooms = (await this.state.storage.get<Record<string, RoomListing>>("rooms")) ?? {};
    }
    return this.rooms;
  }

  private async save(): Promise<void> {
    await this.state.storage.put("rooms", this.rooms ?? {});
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const rooms = await this.load();

    if (url.pathname === "/update" && request.method === "POST") {
      const info = (await request.json()) as Omit<RoomListing, "updatedAt">;
      if (info.count <= 0) {
        delete rooms[info.code];
      } else {
        rooms[info.code] = { ...info, updatedAt: Date.now() };
      }
      await this.save();
      return new Response("ok");
    }

    if (url.pathname === "/list") {
      const now = Date.now();
      let dirty = false;
      const list = Object.values(rooms)
        .filter((r) => {
          if (now - r.updatedAt > STALE_MS) {
            delete rooms[r.code];
            dirty = true;
            return false;
          }
          return true;
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
      if (dirty) await this.save();
      return new Response(JSON.stringify({ rooms: list }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  }
}
