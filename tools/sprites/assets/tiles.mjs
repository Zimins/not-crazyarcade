// tiles.mjs — 3개 테마(forest/factory/ice) 32x32 타일 12프레임.
// 바닥(저대비·저채도 2변형) + soft(파괴 가능, 고대비 입체) + hard(파괴 불가, 어둡고 단단).
// 광원: 좌상단 고정. 블록 하단에는 2px 드롭 섀도.

import { PAL, ramp, shade, makeRng } from "../lib.mjs";

const T = 32;
const SHADOW = [22, 18, 46, 115];
const SHADOW_SOFT = [22, 18, 46, 60];

/* ── 공용 헬퍼 ──────────────────────────────────────────── */

// 블록 하단 드롭 섀도 (y30~31)
function dropShadow(s) {
  s.hLine(2, 30, 28, SHADOW);
  s.hLine(4, 31, 24, SHADOW_SOFT);
}

// 저대비 노이즈 바닥: 베이스 + 점 노이즈
function noisyFloor(s, base, specks, seed) {
  s.fillRect(0, 0, T, T, base);
  const rng = makeRng(seed);
  for (const [color, n] of specks)
    for (let i = 0; i < n; i++)
      s.px(Math.floor(rng() * T), Math.floor(rng() * T), color);
}

// 큐브형 블록 골격: 본체 y0..29(모서리 1px 컷), 상단면 y1..7, 정면 y9..26, 하단 띠 y27..28
function cubeBlock(s, { top, topHi, front, side, bottom }) {
  s.fillRect(1, 1, 30, 28, front);
  s.fillRect(1, 1, 30, 7, top);
  s.hLine(2, 1, 28, topHi); // 최상단 캐치라이트
  s.vLine(1, 2, 6, topHi);
  s.vLine(30, 1, 7, shade(top, -0.15)); // 상단면 우측 가장자리
  s.hLine(1, 8, 30, shade(front, -0.34)); // 상단면/정면 경계
  s.fillRect(28, 9, 3, 18, side); // 우측 음영 (광원 반대편)
  s.fillRect(1, 27, 30, 2, bottom); // 하단 어두운 띠
  s.fillRect(28, 27, 3, 2, shade(bottom, -0.12));
  // 외곽선
  s.hLine(1, 0, 30, PAL.outline);
  s.hLine(1, 29, 30, PAL.outline);
  s.vLine(0, 1, 28, PAL.outline);
  s.vLine(31, 1, 28, PAL.outline);
}

// 유기적 바위 실루엣 행 스팬 (y1..28). 큰 챔퍼로 각진 단단함 + 좌우 비대칭.
function boulderSpan(y) {
  if (y === 1) return [8, 21];
  if (y === 2) return [4, 25];
  if (y === 3) return [2, 28];
  if (y === 4) return [1, 29];
  if (y === 26) return [2, 29];
  if (y === 27) return [2, 28];
  if (y === 28) return [4, 26];
  return [1, 30];
}

// 바위 채움: colorAt(x,y)로 픽셀별 셰이딩 후 실루엣 외곽선
function boulder(s, colorAt) {
  for (let y = 1; y <= 28; y++) {
    const [x0, x1] = boulderSpan(y);
    for (let x = x0; x <= x1; x++) s.px(x, y, colorAt(x, y));
  }
  s.outlineSilhouette(PAL.outline);
}

// 2x2 리벳/볼트: 좌상단 밝고 우하단 어두움
function rivet(s, x, y, light, dark, mid) {
  s.px(x, y, light);
  s.px(x + 1, y, mid);
  s.px(x, y + 1, mid);
  s.px(x + 1, y + 1, dark);
}

/* ── FOREST ─────────────────────────────────────────────── */

const F_BASE = "#7f9e66";
const F_DK = "#74935c";
const F_LT = "#89a871";
const F_BLADE = "#638651";
const F_BLADE_LT = "#92b079";

function forestFloor(s, seed, withFlower) {
  noisyFloor(s, F_BASE, [[F_DK, 26], [F_LT, 20]], seed);
  // 풀잎 점: ∨자 2픽셀 잎
  const rng = makeRng(seed + 71);
  for (let i = 0; i < 8; i++) {
    const x = 2 + Math.floor(rng() * 27);
    const y = 2 + Math.floor(rng() * 27);
    s.px(x, y, F_BLADE);
    s.px(x + 1, y + 1, F_BLADE);
    s.px(x + 2, y, F_BLADE_LT);
  }
  if (withFlower) {
    // 들꽃 한 송이 (채도 낮은 노랑) — 변형 구분 포인트
    s.px(24, 8, "#cdbf7c");
    s.px(23, 9, "#cdbf7c");
    s.px(25, 9, "#cdbf7c");
    s.px(24, 10, "#cdbf7c");
    s.px(24, 9, "#a8945c");
    // 작은 돌멩이
    s.px(7, 22, "#8e9379");
    s.px(8, 22, "#9da283");
    s.px(7, 23, "#7d8268");
  }
}

// soft: 잎 덤불 — 둥근 클러스터 실루엣, 좌상단 밝은 잎/우하단 그늘, 빨간 열매 포인트
function forestSoft(s) {
  const G = ramp(PAL.grass);
  const fillC = G[2];
  // 실루엣: 큰 타원 + 위쪽 혹 3개
  s.ellipse(16, 19, 14, 9.5, fillC);
  s.disc(9, 11, 5.5, fillC);
  s.disc(22, 10, 5.5, fillC);
  s.disc(15, 7, 5, fillC);
  // 좌상단→우하단 방향성 셰이딩
  for (let y = 0; y <= 29; y++)
    for (let x = 0; x <= 31; x++) {
      if (s.get(x, y)[3] === 0) continue;
      const d = x * 0.8 + y * 1.2;
      if (d < 17) s.px(x, y, G[3]);
      else if (d > 47) s.px(x, y, G[0]);
      else if (d > 38) s.px(x, y, G[1]);
    }
  // 잎 플렉 (밝은 곳엔 더 밝게, 그늘엔 더 어둡게)
  const rng = makeRng(20240612);
  for (let i = 0; i < 26; i++) {
    const x = 2 + Math.floor(rng() * 28);
    const y = 3 + Math.floor(rng() * 25);
    if (s.get(x, y)[3] === 0) continue;
    const d = x * 0.8 + y * 1.2;
    const c = d < 26 ? PAL.leaf : G[1];
    s.px(x, y, c);
    s.px(x + 1, y, c);
  }
  // 클러스터 경계 아크 (덩어리 구분)
  s.hLine(5, 15, 3, G[1]);
  s.px(8, 16, G[1]);
  s.hLine(9, 17, 4, G[0]);
  s.hLine(17, 14, 4, G[1]);
  s.px(21, 15, G[0]);
  s.hLine(22, 16, 3, G[0]);
  s.px(13, 12, G[1]);
  s.hLine(11, 13, 3, G[1]);
  // 빨간 열매 3개 (글린트 포함)
  for (const [bx, by] of [[7, 18], [20, 21], [25, 13]]) {
    s.fillRect(bx, by, 2, 2, PAL.red);
    s.px(bx + 1, by + 1, shade(PAL.red, -0.3));
    s.px(bx, by, shade(PAL.red, 0.35));
  }
  s.outlineSilhouette(PAL.outline);
  dropShadow(s);
}

// hard: 바위 — 어둡고 각진 보울더, 면 분할 + 굵은 균열 + 이끼
function forestHard(s) {
  const BASE = "#646b7e";
  const R = ramp(BASE);
  boulder(s, (x, y) => {
    // 상단면: 우측으로 갈수록 꺾여 내려가는 사면
    const topEdge = x < 14 ? 6 : x < 24 ? 5 : 4;
    if (y <= 2) return R[3];
    if (y <= topEdge) return x > 22 ? R[2] : R[3];
    if (y === topEdge + 1) return R[1]; // 상단면/정면 능선
    const d = x * 0.6 + y;
    if (d > 41) return R[0];
    if (d > 32) return R[1];
    return R[2];
  });
  // 정면 세로 능선 (면 분할 — 각진 인상). 능선 좌측은 주변보다 한 단계만 밝게.
  for (let y = 8; y <= 26; y++) {
    const rx = (19 + (y - 8) / 7) | 0;
    s.px(rx, y, R[0]);
    if (y % 3 !== 0) s.px(rx - 1, y, y < 17 ? shade(BASE, 0.1) : R[1]);
  }
  // 굵은 균열 (상단에서 갈라져 내려옴) + 좌측 칩 하이라이트
  const crack = [[11, 7], [11, 8], [12, 9], [12, 10], [11, 11], [10, 12], [10, 13], [11, 14], [11, 15], [12, 16], [12, 17]];
  for (const [cx, cy] of crack) {
    s.px(cx, cy, R[0]);
    s.px(cx - 1, cy, shade(BASE, 0.12));
  }
  // 짧은 보조 균열 (우하단)
  for (const [cx, cy] of [[25, 18], [24, 19], [24, 20], [25, 21]]) s.px(cx, cy, R[0]);
  // 하단 받침 어둠
  s.hLine(4, 27, 22, R[0]);
  s.hLine(5, 26, 8, R[0]);
  // 이끼 두 무더기 (좌상단 — 광원 쪽은 밝은 잎색)
  for (const [mx, my] of [[4, 4], [5, 4], [6, 4], [4, 5], [5, 5], [13, 2], [14, 2], [13, 3]]) s.px(mx, my, PAL.grassDark);
  s.px(4, 3, PAL.leaf);
  s.px(5, 3, PAL.leaf);
  s.px(13, 1, PAL.leaf);
  s.px(6, 10, PAL.grassDark);
  s.px(7, 10, PAL.grassDark);
  dropShadow(s);
}

/* ── FACTORY ────────────────────────────────────────────── */

const M_BASE = "#7b8290";
const M_DK = "#747b89";
const M_LT = "#828997";
const M_SEAM = "#6b7280";
const M_EDGE = "#868d9b";

function factoryFloor(s, seed, scratched) {
  noisyFloor(s, M_BASE, [[M_DK, 24], [M_LT, 18]], seed);
  // 플레이트 이음새: 상/좌 밝고 하/우 어두움 (광원 좌상단)
  s.hLine(0, 0, 32, M_EDGE);
  s.vLine(0, 0, 32, M_EDGE);
  s.hLine(0, 31, 32, M_SEAM);
  s.vLine(31, 0, 32, M_SEAM);
  // 리벳 4개 (저대비)
  for (const [rx, ry] of [[3, 3], [27, 3], [3, 27], [27, 27]])
    rivet(s, rx, ry, "#8b92a0", "#666d7b", "#717885");
  if (scratched) {
    // 긁힌 자국 2개 + 녹 얼룩
    for (let i = 0; i < 5; i++) s.px(10 + i, 14 - i, "#8d94a2");
    for (let i = 0; i < 4; i++) s.px(11 + i, 15 - i, M_SEAM);
    for (let i = 0; i < 4; i++) s.px(20 + i, 24 - i, "#8a919f");
    s.px(8, 24, "#8a6a52");
    s.px(9, 24, "#7d5c45");
    s.px(8, 25, "#7d5c45");
    s.px(23, 7, "#8a6a52");
    s.px(24, 8, "#7d5c45");
  }
}

// soft: 녹슨 컨테이너 — 주황 골판 + 리벳 레일 + 녹 얼룩
function factorySoft(s) {
  const R = ramp(PAL.rust);
  cubeBlock(s, {
    top: shade(PAL.rust, 0.26),
    topHi: shade(PAL.rust, 0.5),
    front: R[2],
    side: R[1],
    bottom: R[0],
  });
  // 상단면 디테일: 뚜껑 이음 + 손잡이 홈
  s.hLine(4, 4, 24, shade(PAL.rust, 0.1));
  s.hLine(4, 5, 24, R[1]);
  // 상/하 레일 (리벳 줄)
  s.fillRect(1, 9, 30, 2, R[1]);
  s.fillRect(1, 24, 30, 2, R[1]);
  for (const rx of [3, 9, 15, 21, 26]) {
    s.px(rx, 9, shade(PAL.rust, 0.35));
    s.px(rx, 10, R[0]);
    s.px(rx, 24, shade(PAL.rust, 0.2));
    s.px(rx, 25, R[0]);
  }
  // 골판 주름 (정면 y11..23)
  for (let x = 3; x <= 26; x += 4) {
    s.vLine(x, 11, 13, shade(PAL.rust, 0.18));
    s.vLine(x + 2, 11, 13, R[1]);
  }
  // 녹 얼룩 (어두운 갈색 번짐)
  const RUST_D = "#5c2d15";
  s.fillRect(6, 13, 2, 2, RUST_D);
  s.px(8, 14, RUST_D);
  s.px(7, 15, "#7a3f1e");
  s.fillRect(19, 19, 3, 2, RUST_D);
  s.px(18, 20, "#7a3f1e");
  s.px(20, 21, RUST_D);
  s.px(24, 3, RUST_D);
  s.px(25, 4, "#7a3f1e");
  dropShadow(s);
}

// hard: 강철 기둥 블록 — 어두운 스틸, 함몰 패널 + X 보강재 + 볼트
function factoryHard(s) {
  const B = PAL.steelDark;
  const S = ramp(B);
  cubeBlock(s, {
    top: shade(B, 0.18),
    topHi: shade(B, 0.4),
    front: S[2],
    side: S[1],
    bottom: S[0],
  });
  // 상단면 통풍 슬릿
  s.hLine(6, 4, 8, S[0]);
  s.hLine(18, 4, 8, S[0]);
  s.hLine(6, 5, 8, shade(B, 0.28));
  s.hLine(18, 5, 8, shade(B, 0.28));
  // 함몰 패널 (테두리: 위 어둡고 아래 밝음 = 패인 느낌)
  s.fillRect(6, 12, 20, 12, shade(B, -0.3));
  s.hLine(6, 12, 20, S[0]);
  s.vLine(6, 12, 12, S[0]);
  s.hLine(6, 23, 20, shade(B, 0.05));
  s.vLine(25, 12, 12, shade(B, 0.05));
  // X 보강재
  for (let t = 0; t <= 9; t++) {
    s.px(8 + t, 13 + t, S[2]);
    s.px(9 + t, 13 + t, S[2]);
    s.px(23 - t, 13 + t, S[2]);
    s.px(22 - t, 13 + t, S[2]);
  }
  s.px(15, 17, shade(B, 0.22));
  s.px(16, 17, shade(B, 0.22));
  s.px(15, 18, S[0]);
  s.px(16, 18, S[0]);
  // 볼트 4개 (패널 바깥 모서리)
  rivet(s, 3, 10, shade(B, 0.4), S[0], S[1]);
  rivet(s, 26, 10, shade(B, 0.4), S[0], S[1]);
  rivet(s, 3, 24, shade(B, 0.4), S[0], S[1]);
  rivet(s, 26, 24, shade(B, 0.4), S[0], S[1]);
  dropShadow(s);
}

/* ── ICE ────────────────────────────────────────────────── */

const I_BASE = "#c6d8e2";
const I_DK = "#bccfdb";
const I_LT = "#cfdfe8";

function iceFloor(s, seed, withDrift) {
  noisyFloor(s, I_BASE, [[I_DK, 26], [I_LT, 22]], seed);
  // 반짝이 십자 (저대비)
  const rng = makeRng(seed + 13);
  for (let i = 0; i < 4; i++) {
    const x = 3 + Math.floor(rng() * 26);
    const y = 3 + Math.floor(rng() * 26);
    s.px(x, y, "#f2fafd");
    s.px(x - 1, y, "#dcebf2");
    s.px(x + 1, y, "#dcebf2");
    s.px(x, y - 1, "#dcebf2");
    s.px(x, y + 1, "#dcebf2");
  }
  if (withDrift) {
    // 눈 드리프트 둔덕 (밝은 띠 + 아주 옅은 그늘 — 저대비 유지)
    for (let x = 1; x < 31; x++) {
      const y = 21 + Math.round(Math.sin(x * 0.32) * 1.3);
      s.px(x, y - 1, "#dde9f0");
      s.px(x, y, "#d4e2ea");
      s.px(x, y + 1, "#bed1dc");
    }
    // 작은 얼음 조각
    s.px(8, 9, "#b2c6d3");
    s.px(9, 9, "#d8e6ee");
    s.px(9, 8, "#dde9f0");
  }
}

// soft: 얼음 큐브 — 반투명 하이라이트 대각 글린트 + 기포
function iceSoft(s) {
  cubeBlock(s, {
    top: PAL.iceLight,
    topHi: "#ffffff",
    front: PAL.ice,
    side: PAL.iceDark,
    bottom: shade(PAL.iceDark, -0.22),
  });
  // 상단면 글린트
  s.hLine(4, 3, 6, "#ffffff");
  s.hLine(12, 2, 3, "#ffffff");
  // 대각 반사 줄무늬 (반투명 흰색 — 유리감)
  for (let t = 0; t <= 9; t++) {
    s.px(21 - t, 10 + t, [255, 255, 255, 165]);
    s.px(22 - t, 10 + t, [255, 255, 255, 120]);
  }
  for (let t = 0; t <= 5; t++) s.px(26 - t, 11 + t, [255, 255, 255, 130]);
  // 좌측 내부 라이트 (광원 방향 투과광)
  s.vLine(2, 9, 16, shade(PAL.ice, 0.2));
  // 기포
  s.px(8, 20, "#e6fbff");
  s.px(12, 23, "#dff6fd");
  s.px(15, 19, "#e6fbff");
  s.px(7, 14, "#dff6fd");
  // 우하단 깊은 굴절
  s.fillRect(24, 24, 4, 3, PAL.iceDark);
  s.px(27, 26, shade(PAL.iceDark, -0.18));
  for (let t = 0; t <= 4; t++) s.px(8 + t, 26 - t, PAL.iceDark);
  dropShadow(s);
}

// hard: 빙하 바위 — 짙은 청색 암체 + 부드러운 눈 갓 + 얼음 결 균열
function iceHard(s) {
  const BASE = "#49678f";
  const C = ramp(BASE);
  // 부드러운 눈 갓 깊이 (완만한 굴곡, x0..31)
  const SNOW = [6, 6, 5, 5, 5, 5, 5, 6, 6, 7, 7, 7, 6, 6, 5, 5, 5, 5, 6, 6, 7, 7, 7, 7, 6, 6, 5, 5, 5, 6, 6, 7];
  boulder(s, (x, y) => {
    const sd = SNOW[x];
    if (y < sd - 3) return "#f6fbfd"; // 눈: 윗부분 가장 밝음
    if (y < sd) return "#e9f2f8";
    if (y === sd) return "#c8d9e5"; // 눈 가장자리
    if (y === sd + 1) return shade(BASE, -0.38); // 눈 밑 접지 그림자
    const d = x * 0.6 + y;
    if (d > 42) return C[0];
    if (d > 33) return C[1];
    if (y <= sd + 3) return C[3]; // 눈 바로 아래 받는 빛
    return C[2];
  });
  // 얼음 결 균열 2개 (일관된 밝은 청록 — 눈 밑에서 갈라져 내려옴)
  const VEIN = "#9fcfe6";
  const vein1 = [[10, 9], [10, 10], [11, 11], [11, 12], [10, 13], [10, 14], [11, 15], [11, 16], [12, 17], [12, 18], [12, 19]];
  for (const [vx, vy] of vein1) s.px(vx, vy, VEIN);
  const vein2 = [[21, 11], [20, 12], [20, 13], [19, 14], [19, 15], [20, 16], [20, 17]];
  for (const [vx, vy] of vein2) s.px(vx, vy, "#8ec2dc");
  // 몸체 잔반짝임 (희미하게 2점)
  s.px(7, 21, "#7fa8c6");
  s.px(24, 23, "#6f98ba");
  // 하단 받침 어둠
  s.hLine(4, 27, 22, C[0]);
  s.hLine(6, 26, 6, C[0]);
  dropShadow(s);
}

/* ── 모듈 정의 ──────────────────────────────────────────── */

const sprite = (name, draw) => ({ name, w: T, h: T, draw });

export default {
  name: "tiles",
  sprites: [
    sprite("forest_floor_0", (s) => forestFloor(s, 0xf0_01, false)),
    sprite("forest_floor_1", (s) => forestFloor(s, 0xf0_22, true)),
    sprite("forest_soft", forestSoft),
    sprite("forest_hard", forestHard),
    sprite("factory_floor_0", (s) => factoryFloor(s, 0xfa_01, false)),
    sprite("factory_floor_1", (s) => factoryFloor(s, 0xfa_22, true)),
    sprite("factory_soft", factorySoft),
    sprite("factory_hard", factoryHard),
    sprite("ice_floor_0", (s) => iceFloor(s, 0x1c_01, false)),
    sprite("ice_floor_1", (s) => iceFloor(s, 0x1c_22, true)),
    sprite("ice_soft", iceSoft),
    sprite("ice_hard", iceHard),
  ],
};
