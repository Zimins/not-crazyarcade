// Splash Arena Worker — 정적 게임 서빙 + API + 방(Durable Objects)을 워커 하나로.
//
// 배포: wrangler deploy  (Workers + Static Assets — Pages 후속 권장 구조)

import { handleApi, handleWs } from "./api";
import type { Env } from "./session";

export { RoomDO } from "./room";
export { LobbyDO } from "./lobby";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    if (url.pathname.startsWith("/ws/")) {
      return handleWs(request, env, url);
    }
    // 그 외 전부 정적 에셋 (SPA fallback은 assets 설정이 처리)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
