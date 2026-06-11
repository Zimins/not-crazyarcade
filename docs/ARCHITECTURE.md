# Splash Arena — 아키텍처

## 전체 구조 (서버리스, 전부 Cloudflare — 워커 하나로 배포)

```
┌─ 브라우저 ───────────────────────────────────────────┐
│  UI (DOM)  ←  렌더러 (Canvas 2D, 픽셀아트 정수 스케일) │
│      ↓ 입력            ↑ 스냅샷 (Float32Array 뷰)     │
│  게임 루프 (rAF + 고정 타임스텝 60Hz accumulator)      │
│      ↓ tick()/set_input()                            │
│  WASM 게임 코어 (Rust) — 시뮬레이션 전체, 결정적       │
└──────────────────────────────────────────────────────┘
    │ fetch /api/*            │ WebSocket /ws/room/:code
┌─ Cloudflare Worker (wrangler deploy 하나) ───────────┐
│  Static Assets (dist/) — SPA fallback                 │
│  API 라우트 — 인증/전적/방 목록                        │
│  RoomDO: 방 1개 = DO 1개 (최대 6인, 입력 릴레이)       │
│  LobbyDO: 방 목록 싱글톤                               │
│  D1 (SQLite) — users, match_results                   │
└──────────────────────────────────────────────────────┘
```

## WASM 코어 (core/)

- Rust + wasm-bindgen, `wasm-pack build --target web` (2026 권장: 플러그인 의존성 0)
- 게임 상태는 전부 WASM 메모리에 상주. JS는 매 프레임:
  1. `game.set_input(id, bitmask)` — 키 입력 전달
  2. `game.tick()` — 고정 1/60초 스텝 (accumulator로 0~N회)
  3. `game.snapshot_ptr()/snapshot_len()` — 패킹된 f32 버퍼를 **zero-copy 뷰**로 읽기
- 뷰는 매 프레임 재생성 (WASM 메모리 grow 시 ArrayBuffer detach 대응)
- 결정적 시뮬: 고정 타임스텝 + xorshift 시드 RNG → 입력 시퀀스만 같으면 동일 결과
  (v2 온라인 lockstep/리플레이의 전제)

### 스냅샷 버퍼 레이아웃 (f32)

```
헤더 16: version, tick, phase, phase_timer, time_remaining, map_w, map_h,
         n_players, n_balloons, n_streams, n_items, n_events, winner_team, map_id, 예약×2
타일   : map_w × map_h (0=빈칸 1=소프트 2=하드)
플레이어: stride 16 — id, char, team, x, y, dir, moving, state, state_timer,
          max_balloons, balloons_used, range, speed_lv, needles, is_bot, kills
물풍선  : stride 6 — x, y, owner, fuse01, range, solid
물줄기  : stride 4 — x, y, part(0=중심 1=가로 2=세로 3~6=끝 좌/우/상/하), age01
아이템  : stride 4 — x, y, type, 예약
이벤트  : stride 4 — kind, x, y, data  (읽으면 드레인 — 사운드/파티클 트리거용)
```

## 프론트엔드 (src/)

- Vite + TypeScript, 프레임워크 없음 (DOM UI + Canvas 게임)
- 캔버스 내부 해상도 = 맵 픽셀(타일 32px × 15×13 + HUD), CSS 정수 배율 확대
- `image-rendering: pixelated` + `imageSmoothingEnabled = false` + 정수 좌표 drawImage
- 스프라이트: 빌드 타임에 Node 스크립트(tools/sprites/)가 절차 생성한 PNG 아틀라스 + JSON
- 사운드: WebAudio 신스 (외부 에셋 0)

## 백엔드 (worker/ — Cloudflare Worker)

- **익명 로그인**: `POST /api/auth/guest` → D1에 익명 유저 생성 + HMAC-SHA256 서명
  세션 쿠키(HttpOnly). 닉네임만으로 시작. 유효 세션 재로그인 시 계정 재사용(닉네임만 갱신).
  Google/GitHub OAuth는 provider 인터페이스만 잡아두고 추후 "계정 연동"으로 추가
- `GET /api/me`, `POST /api/match`(전적 기록), `GET /api/stats`(내 전적 집계),
  `GET/POST /api/rooms`(방 목록/생성), `GET /ws/room/:code`(방 WebSocket)
- D1 스키마: `users(id, nickname, provider, provider_id, created_at)`,
  `match_results(id, user_id, map_id, char_type, won, draw, kills, played_at)`
- 백엔드 미설정/오프라인 시 localStorage 폴백 — 솔로 게임은 항상 동작

## 멀티플레이 (RoomDO + LobbyDO)

- **방 1개 = RoomDO 1개**, 최대 6인 (스폰 6개: 코너 4 + 좌우 중앙 2)
- **넷코드 = 입력 릴레이 락스텝**: 서버는 시뮬레이션을 돌리지 않는다.
  60Hz 틱 클록 소유자로서 전 플레이어의 현재 입력을 20Hz 배치(배치당 3틱)로
  브로드캐스트 → 결정적 WASM 코어(고정 타임스텝 + 시드 RNG + 초월함수 없음)를 가진
  각 클라이언트가 동일 시뮬레이션을 재생. 클라는 틱 큐로 지터 흡수, 밀리면 빠른 재생
- 방 흐름: 대기실(캐릭터 선택, 방장이 맵 선택·시작, 최저 슬롯 = 방장) → 게임 →
  방장이 라운드 결과 보고(`result`) → 대기실 복귀. 게임 중 이탈자는 입력 0 고정
- **LobbyDO 싱글톤** = 방 목록. RoomDO가 인원/상태 변화마다 보고, 5분 무갱신 방은
  목록에서 자동 제거. `GET /api/rooms` 로 조회
- SQLite 백엔드 DO (`new_sqlite_classes`) — 무료 플랜 지원

## 빌드/배포

```
pnpm build      =  wasm-pack(release) → 스프라이트 → tsc(앱+워커) → vite build
pnpm run deploy =  pnpm build && wrangler deploy   (Workers + Static Assets)
로컬            =  pnpm dev (게임만) / pnpm run dev:full = wrangler dev (풀스택)
```
