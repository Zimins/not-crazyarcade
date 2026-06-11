# Splash Arena (not-crazy-arcade)

물풍선 액션 아케이드 장르의 메커니즘을 오리지널 IP로 재해석한 웹 게임.
Rust → WASM 게임 코어 + Canvas 2D 픽셀아트 렌더링 + Cloudflare 서버리스.

> 서비스 종료를 앞둔 추억의 장르를 브라우저에서. 캐릭터·그래픽·사운드·명칭은
> 전부 자체 제작(절차 생성)이며 특정 상용 게임의 에셋을 사용하지 않습니다.

## 스택

| 영역 | 기술 |
|------|------|
| 게임 시뮬레이션 | Rust → WebAssembly (wasm-bindgen, 60Hz 고정 타임스텝, 결정적) |
| 렌더링 | Canvas 2D, 절차 생성 픽셀아트 아틀라스, 정수 배율 스케일 |
| 사운드 | WebAudio 신스 (외부 에셋 0) |
| UI | Vanilla TS + DOM (Vite) |
| 인증 | 익명 로그인 (HMAC 세션 쿠키) — Google/GitHub OAuth 확장 예정 |
| 백엔드 | Cloudflare Workers + D1 (전적) + Durable Objects (방/로비) |
| 멀티플레이 | 방 1개 = Durable Object 1개 (최대 6인), 결정적 시뮬 + 입력 릴레이 락스텝 |

## 개발

```bash
# 요구사항: Node 20+, pnpm, Rust(wasm32-unknown-unknown), wasm-pack

pnpm install
pnpm run build:wasm      # Rust → src/wasm/pkg
pnpm run build:sprites   # 픽셀아트 생성 → public/assets/generated
pnpm dev                 # 게임만 (백엔드 없이 localStorage 폴백, 솔로 봇전만)

# 풀스택 로컬 실행 (인증·전적·멀티플레이 방 포함)
cp .env.example .dev.vars            # SESSION_SECRET 채우기 (openssl rand -hex 32)
npx wrangler d1 migrations apply splash-arena --local
pnpm build
pnpm run dev:full                    # = wrangler dev (워커 + DO + D1 로컬)

# 코어 단위 테스트
pnpm run test:core
```

## 배포 (Cloudflare Workers + Static Assets)

Durable Objects(방 시스템)를 쓰므로 Pages가 아닌 **Workers 단일 배포**를 사용한다.
SQLite 백엔드 DO라 무료 플랜에서도 동작.

```bash
npx wrangler d1 create splash-arena        # 출력된 database_id 를 wrangler.toml 에 기입
npx wrangler d1 migrations apply splash-arena --remote
npx wrangler secret put SESSION_SECRET     # openssl rand -hex 32
pnpm run deploy                            # = pnpm build && wrangler deploy
```

## 구조

```
core/            Rust WASM 게임 코어 (시뮬레이션 전체, 결정적)
src/             프론트엔드 (렌더러·UI·오디오·인증·넷코드 클라이언트)
worker/          Cloudflare Worker (API + RoomDO/LobbyDO 방 시스템)
tools/sprites/   픽셀아트 절차 생성 파이프라인 (Node, 의존성 0)
migrations/      D1 스키마
docs/            게임 디자인 / 아키텍처 문서
```

자세한 규칙은 [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md),
구조는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 참고.
