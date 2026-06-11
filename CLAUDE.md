# Splash Arena (not-crazy-arcade)

물풍선 액션 아케이드(크레이지 아케이드 장르) 웹 게임. 오리지널 IP — 넥슨 등 상용 게임의
캐릭터/스프라이트/사운드/명칭을 절대 사용하지 않는다 (메커니즘만 참고).

## 빌드/테스트 명령

```bash
pnpm run build:wasm      # Rust → src/wasm/pkg (wasm-pack --target web, PATH에 ~/.cargo/bin 필요)
pnpm run build:sprites   # tools/sprites → public/assets/generated (PNG 아틀라스 + JSON)
pnpm run test:core       # cargo test (코어 규칙 단위 테스트)
pnpm dev                 # vite dev (백엔드 없이 localStorage 폴백, 솔로만)
pnpm build               # wasm + sprites + tsc(앱/워커) + vite build → dist/
pnpm run dev:full        # wrangler dev — 풀스택 로컬 (워커+DO+D1, dist/ 필요)
pnpm run deploy          # 빌드 후 wrangler deploy (Workers + Static Assets)
```

## 아키텍처 요점 (자세히: docs/ARCHITECTURE.md)

- **core/**: Rust WASM이 시뮬레이션 전체 소유. 60Hz 고정 타임스텝, 시드 RNG로 결정적.
  JS는 `set_input(bitmask)` → `tick()` → `snapshot_ptr()/len()` zero-copy 읽기만 한다.
- **스냅샷 버퍼 레이아웃**은 `core/src/game.rs::build_snapshot`과 `src/game/snapshot.ts`가
  1:1 대응 — 한쪽을 바꾸면 반드시 둘 다 갱신.
- **이벤트**(사운드/이펙트 트리거)는 스냅샷에 실려 나오고 읽으면 드레인됨.
- **tools/sprites/**: 의존성 0 절차 생성 픽셀아트. 프레임 이름이 렌더러와 계약
  (`char{N}_{dir}_{frame}`, `stream_*`, `item_*` 등) — 이름 변경 시 renderer.ts 동기화.
- **worker/**: Cloudflare Worker — API(익명 로그인 HMAC 쿠키 + D1 전적) +
  **RoomDO**(방 1개=DO 1개, 최대 6인, 입력 릴레이 락스텝) + **LobbyDO**(방 목록 싱글톤).
  서버는 시뮬레이션을 돌리지 않고 60Hz 입력 프레임만 릴레이 — 코어가 결정적이어야
  멀티가 동작하므로 **코어에 비결정 요소(시간/난수/초월함수) 추가 금지**.
- 프론트는 백엔드 부재 시 자동 localStorage 폴백 — 솔로 게임은 항상 단독 동작해야 한다.
- 밸런스 수치는 전부 `core/src/constants.rs` (원작 통용치 기반, docs/GAME_DESIGN.md 참고).
- WS 프로토콜(클라 `src/net/client.ts` ↔ 서버 `worker/room.ts`)은 양쪽 동시 갱신 필수.

## v2 예정 (구조만 잡혀 있음)

- Google/GitHub OAuth: `src/auth/client.ts`의 Provider 타입 + users.provider 컬럼에 연동
- 멀티 고도화: 재접속, 관전, 팀전 방, 게임 중 입장 차단 완화, 방 비밀번호
