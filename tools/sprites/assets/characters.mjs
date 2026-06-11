// 오리지널 캐릭터 4종 (32x40, SD 2.5등신) — 물풍선 아케이드용
//   char0 코코: 노란 병아리 (밸런스) / char1 피코: 하늘색 아기 고양이 (스피드)
//   char2 부리: 초록 아기 개구리 (탱크) / char3 테라: 보라 아기 여우 (사거리)
// 광원: 좌상단 고정. 4단 램프 + 우하단 코어섀도, 필로우 셰이딩 금지.
import { Sprite, PAL, ramp, shade } from "../lib.mjs";

const W = 32;
const H = 40;
const CX = 15.5; // 캔버스 좌우 중심
const OUT = PAL.outline;
const SOFT = PAL.outlineSoft;
const PINK = "#ff9ec4"; // 볼터치
const MOUTH = "#8e3050"; // 벌린 입속
const HILITE2 = "#8f88b5"; // 눈 보조 하이라이트
const yelR = ramp(PAL.yellow);

// hr/br: 머리/몸 반지름, body/belly/limb: 램프
const CHARS = [
  { hr: [10, 10], br: [7, 6.5], body: ramp(PAL.yellow), belly: ramp("#ffeca0"), limb: ramp(PAL.orange), comb: ramp(PAL.red) },
  { hr: [9.4, 9.8], br: [6.6, 6.3], body: ramp("#54b8f0"), belly: ramp("#e9f7ff"), limb: ramp("#54b8f0"), nose: shade(PAL.pink, -0.25) },
  { hr: [10.4, 9.2], br: [8.4, 6.8], body: ramp(PAL.grass), belly: ramp("#d9f0a4"), limb: ramp("#49a341") },
  { hr: [9.7, 9.9], br: [6.8, 6.4], body: ramp(PAL.purple), belly: ramp("#f3ecff"), limb: ramp("#7a45c2") },
];

// ── 공용 형태 헬퍼 ─────────────────────────────────────────
/// 좌상단 광원 셰이딩 볼: 우하단 가장자리 그림자 + 좌상단 하이라이트
function ball(s, cx, cy, rx, ry, R) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1.08) continue;
      const t = nx * 0.55 + ny * 0.8; // 광원 반대 방향성
      let col = R[2];
      if (d > 0.52 && t > 0.66) col = R[0];
      else if (d > 0.38 && t > 0.3) col = R[1];
      else if (d > 0.34 && t < -0.5) col = R[3];
      s.px(x, y, col);
    }
}

/// 3x4 큰 눈 (skip: 0/2 → 해당 위쪽 모서리 깎아 치켜뜬 인상)
function bigEye(s, x, y, skip = -1) {
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 3; c++) {
      if (r === 0 && c === skip) continue;
      if (r === 3 && (c === 0 || c === 2)) continue; // 바닥 둥글림
      s.px(x + c, y + r, OUT);
    }
  s.px(x, y + 1, PAL.white);
  s.px(x + 1, y, HILITE2);
}

function dotEye(s, x, y) {
  s.fillRect(x, y, 2, 2, OUT);
}

function xEye(s, x, y) {
  s.px(x, y, OUT);
  s.px(x + 2, y, OUT);
  s.px(x + 1, y + 1, OUT);
  s.px(x, y + 2, OUT);
  s.px(x + 2, y + 2, OUT);
}

function oMouth(s, cx, y, small = false) {
  if (small) {
    s.fillRect(cx - 1.5, y, 3, 3, OUT);
    s.px(cx - 0.5, y + 1, MOUTH);
  } else {
    s.fillRect(cx - 2, y, 4, 4, OUT);
    s.fillRect(cx - 1, y + 1, 2, 2, MOUTH);
  }
}

function foot(s, x, y, R, tone = 2, w = 4) {
  s.fillRect(x, y, w, 3, R[tone]);
  s.hLine(x, y + 2, w, R[tone - 1]);
  s.px(x, y, R[Math.min(3, tone + 1)]);
}

function armNub(s, x, y, R) {
  s.fillRect(x, y, 2, 4, R[2]);
  s.px(x, y, R[3]);
  s.px(x + 1, y + 3, R[1]);
}

/// 위로 번쩍 든 사선 팔 — 머리보다 먼저 그려 머리 옆 위로 손이 빼꼼 나온다
function armRaised(s, R, dy, right) {
  const pts = [
    [7, 18],
    [6, 16],
    [5, 14],
    [4, 12],
  ];
  for (const [bx, by] of pts) {
    s.fillRect(right ? 30 - bx : bx, by + dy, 2, 3, R[2]);
    if (right) s.px(31 - bx, by + dy + 2, R[1]);
  }
  s.fillRect(right ? 27 : 3, 10 + dy, 2, 2, R[3]); // 손끝
}

/// 삼각 귀 (apex ax,ay에서 h행 아래로 퍼짐), edge: 우측 그림자, inner: 귓속
function earTri(s, ax, ay, h, half, fill, edge, inner) {
  for (let i = 0; i < h; i++) {
    const hw = Math.max(0, Math.round((half * (i + 0.6)) / h));
    s.hLine(ax - hw, ay + i, hw * 2 + 1, fill);
    if (i > 0) s.px(ax + hw, ay + i, edge);
  }
  if (inner)
    for (let i = 3; i < h - 1; i++) {
      const hw = Math.max(0, Math.round((half * (i + 0.6)) / h) - 2);
      s.hLine(ax - hw, ay + i, hw * 2 + 1, inner);
    }
}

function halo(s, hx, yTop) {
  s.hLine(hx - 3.5, yTop, 8, yelR[3]);
  s.hLine(hx - 3.5, yTop + 2, 8, yelR[1]);
  s.px(hx - 4.5, yTop + 1, yelR[2]);
  s.px(hx + 4.5, yTop + 1, yelR[2]);
}

function sweatDrop(s, x, y) {
  s.px(x, y, PAL.waterLight);
  s.fillRect(x - 0.5, y + 1, 2, 2, PAL.water);
  s.px(x - 0.5, y + 1, PAL.foam);
}

/// 유령(사망) 반투명 처리 — 알파 약 200
function fade(s) {
  for (let i = 3; i < s.data.length; i += 4) s.data[i] = ((s.data[i] * 200) / 255) | 0;
}

// ── 캐릭터별 파츠 ──────────────────────────────────────────
function catTailDown(s, c, dy, mirror) {
  const R = c.body;
  const rects = [
    [23, 32, 2, 4, R[1]],
    [25, 29, 2, 4, R[1]],
    [25, 28, 2, 1, R[2]],
  ];
  for (const [x, y, w, h, col] of rects) s.fillRect(mirror ? 32 - x - w : x, y + dy, w, h, col);
}

function foxTailDown(s, c, dy, mirror) {
  const cx = mirror ? 31 - 26 : 26;
  ball(s, cx, 31.5 + dy, 3.1, 4.6, c.body);
  s.ellipse(cx + (mirror ? -0.5 : 0.5), 28 + dy, 2.2, 1.7, c.belly[2]);
  s.px(cx + (mirror ? -1 : 1), 27 + dy, c.belly[3]);
}

function catTailSide(s, c, dy) {
  const R = c.body;
  s.fillRect(23, 30 + dy, 2, 3, R[2]);
  s.fillRect(25, 28 + dy, 2, 3, R[2]);
  s.fillRect(27, 26 + dy, 2, 3, R[2]);
  s.fillRect(27, 25 + dy, 2, 1, R[3]);
  s.px(24, 32 + dy, R[1]);
  s.px(26, 30 + dy, R[1]);
  s.px(28, 28 + dy, R[1]);
}

function foxTailSide(s, c, dy) {
  ball(s, 26.5, 30 + dy, 3.2, 5, c.body);
  s.ellipse(27, 26.5 + dy, 2.3, 2, c.belly[2]);
  s.px(26, 25 + dy, c.belly[3]);
}

/// 머리 장식 (볏/귀/눈혹) — 머리 볼 위에 그림
function headDecor(s, id, c, hx, hy, view) {
  if (id === 0) {
    const R = c.comb;
    s.fillRect(hx - 0.5, hy - 14, 2, 3, R[2]);
    s.px(hx + 0.5, hy - 15, R[2]);
    s.px(hx + 1.5, hy - 16, R[2]);
    s.px(hx - 0.5, hy - 14, R[3]);
  } else if (id === 1) {
    if (view === "side") {
      earTri(s, 20, hy - 13, 7, 3, c.body[1], c.body[0], null);
      earTri(s, 9, hy - 13, 7, 3, c.body[2], c.body[1], null);
    } else {
      const inner = view === "down" ? PINK : null;
      earTri(s, hx - 6.5, hy - 13, 7, 3, c.body[2], c.body[1], inner);
      earTri(s, hx + 6.5, hy - 13, 7, 3, c.body[2], c.body[1], inner);
      if (view === "up") {
        // 뒤통수 줄무늬
        s.fillRect(hx - 4, hy - 7, 2, 1, c.body[1]);
        s.fillRect(hx - 1, hy - 9, 2, 1, c.body[1]);
        s.fillRect(hx + 2, hy - 7, 2, 1, c.body[1]);
      }
    }
  } else if (id === 2) {
    if (view === "side") {
      ball(s, 19, hy - 8.5, 3.1, 3.1, c.body);
      ball(s, 11, hy - 9, 3.5, 3.4, c.body);
      s.fillRect(8, hy - 10, 2, 3, OUT);
      s.px(8, hy - 10, PAL.white);
    } else {
      ball(s, hx - 5.5, hy - 9, 3.5, 3.4, c.body);
      ball(s, hx + 5.5, hy - 9, 3.5, 3.4, c.body);
    }
  } else {
    if (view === "side") {
      earTri(s, 20, hy - 14, 8, 4, c.body[1], c.body[0], null);
      earTri(s, 8, hy - 14, 8, 4, c.body[2], c.body[1], c.body[0]);
    } else {
      const inner = view === "down" ? c.body[0] : null;
      earTri(s, hx - 6.5, hy - 14, 8, 4, c.body[2], c.body[1], inner);
      earTri(s, hx + 6.5, hy - 14, 8, 4, c.body[2], c.body[1], inner);
    }
  }
}

function beak(s, c, hx, hy, open) {
  const R = c.limb;
  s.fillRect(hx - 0.5, hy + 1, 2, 1, R[3]);
  s.fillRect(hx - 1.5, hy + 2, 4, 1, R[2]);
  if (open) {
    s.fillRect(hx - 1.5, hy + 3, 4, 1, MOUTH);
    s.fillRect(hx - 0.5, hy + 4, 2, 1, R[1]);
  } else {
    s.fillRect(hx - 0.5, hy + 3, 2, 1, R[1]);
  }
}

function frogFace(s, c, hx, hy, face) {
  const bL = hx - 5.5;
  const bR = hx + 5.5;
  const by = hy - 9;
  s.fillRect(hx - 7.5, hy, 2, 1, PINK);
  s.fillRect(hx + 5.5, hy, 2, 1, PINK);
  s.px(hx - 2.5, hy - 1, SOFT);
  s.px(hx + 1.5, hy - 1, SOFT);
  if (face === "trapped") {
    s.fillRect(bL - 0.5, by - 1, 2, 2, OUT);
    s.fillRect(bR - 0.5, by - 1, 2, 2, OUT);
    oMouth(s, hx, hy + 1);
    return;
  }
  if (face === "dead") {
    xEye(s, bL - 1.5, by - 2);
    xEye(s, bR - 1.5, by - 2);
    s.hLine(hx - 3.5, hy + 2, 8, c.body[0]);
    return;
  }
  // 혹 위 동공
  s.fillRect(bL - 1.5, by - 2, 3, 4, OUT);
  s.px(bL - 1.5, by - 1, PAL.white);
  s.fillRect(bR - 1.5, by - 2, 3, 4, OUT);
  s.px(bR - 1.5, by - 1, PAL.white);
  // 넓적 입
  s.px(hx - 6.5, hy + 1, c.body[0]);
  s.px(hx + 6.5, hy + 1, c.body[0]);
  s.hLine(hx - 5.5, hy + 2, 12, c.body[0]);
  if (face === "win") s.fillRect(hx - 3.5, hy + 3, 8, 2, MOUTH);
}

function faceDown(s, id, c, hx, hy, face) {
  if (id === 2) return frogFace(s, c, hx, hy, face);
  const exL = hx - 5.5;
  const exR = hx + 2.5;
  const ey = hy - 3;
  s.fillRect(hx - 7.5, hy + 2, 2, 1, PINK);
  s.fillRect(hx + 5.5, hy + 2, 2, 1, PINK);
  if (id === 3) {
    s.ellipse(hx, hy + 3.3, 4, 2.6, c.belly[2]);
    s.hLine(hx - 2.5, hy + 1, 3, c.belly[3]);
  }
  // 눈
  if (face === "trapped") {
    dotEye(s, exL + 0.5, ey + 1);
    dotEye(s, exR + 0.5, ey + 1);
  } else if (face === "dead") {
    xEye(s, exL, ey);
    xEye(s, exR, ey);
  } else {
    const sk = id === 1;
    bigEye(s, exL, ey, sk ? 2 : -1);
    bigEye(s, exR, ey, sk ? 0 : -1);
  }
  // 입/코
  if (id === 0) {
    beak(s, c, hx, hy, face === "trapped" || face === "win");
  } else if (id === 1) {
    s.fillRect(hx - 1, hy + 1, 2, 1, c.nose);
    if (face === "trapped") oMouth(s, hx, hy + 3, true);
    else if (face === "win") {
      s.fillRect(hx - 1.5, hy + 2, 4, 2, OUT);
      s.fillRect(hx - 0.5, hy + 3, 2, 1, MOUTH);
    } else {
      s.px(hx - 1.5, hy + 2, SOFT);
      s.px(hx + 1.5, hy + 2, SOFT);
      s.px(hx - 0.5, hy + 3, SOFT);
      s.px(hx + 0.5, hy + 3, SOFT);
    }
  } else {
    s.fillRect(hx - 1, hy + 2, 2, 2, OUT); // 코
    if (face === "trapped") oMouth(s, hx, hy + 4, true);
    else if (face === "win") {
      s.px(hx - 2.5, hy + 4, SOFT);
      s.hLine(hx - 1.5, hy + 5, 4, SOFT);
      s.px(hx + 1.5, hy + 4, SOFT);
    } else {
      s.hLine(hx - 0.5, hy + 4, 2, SOFT);
    }
  }
}

function faceSide(s, id, c, hy) {
  if (id !== 2) bigEye(s, 8, hy - 3, id === 1 ? 2 : -1);
  if (id === 0) {
    s.hLine(3, hy - 1, 3, c.limb[3]);
    s.hLine(1, hy, 5, c.limb[2]);
    s.hLine(3, hy + 1, 3, c.limb[1]);
    s.fillRect(6, hy + 2, 2, 1, PINK);
  } else if (id === 1) {
    s.disc(6.5, hy + 3, 2.4, c.belly[2]);
    s.fillRect(4, hy + 1, 2, 2, c.nose);
    s.px(6, hy + 4, SOFT);
    s.fillRect(10, hy + 3, 2, 1, PINK);
  } else if (id === 2) {
    s.fillRect(7, hy, 2, 1, PINK);
    s.hLine(4, hy + 2, 11, c.body[0]);
    s.px(15, hy + 1, c.body[0]);
  } else {
    s.hLine(5, hy - 1, 4, c.belly[3]);
    s.hLine(2, hy, 7, c.belly[2]);
    s.hLine(2, hy + 1, 7, c.belly[2]);
    s.hLine(4, hy + 2, 5, c.belly[1]);
    s.fillRect(1, hy, 2, 2, OUT);
    s.fillRect(10, hy + 3, 2, 1, PINK);
  }
}

/// 등 디테일 (뒷모습 전용, 몸 위에)
function backDetail(s, id, c, dy) {
  if (id === 0) {
    s.px(14, 33 + dy, c.body[1]);
    s.px(16, 33 + dy, c.body[1]);
    s.hLine(13, 34 + dy, 5, c.body[1]);
  } else if (id === 2) {
    s.fillRect(11, 28 + dy, 2, 2, c.body[1]);
    s.fillRect(19, 30 + dy, 2, 2, c.body[1]);
  }
}

// ── 발/팔 배치 ─────────────────────────────────────────────
function feetFront(s, id, mode, f, gdy = 0) {
  const c = CHARS[id];
  const R = c.limb;
  const w = id === 2 ? 5 : 4;
  const g = 36 + gdy;
  if (mode === "spread") {
    foot(s, 6, g - 1, R, 2, w);
    foot(s, 26 - w, g - 1, R, 2, w);
    return;
  }
  if (mode === "dangle") {
    foot(s, 10, g + 1, R, 2, w);
    foot(s, 22 - w, g + 1, R, 2, w);
    return;
  }
  if (f === 1) {
    foot(s, 8, g, R, 2, w); // 왼발 앞(바깥쪽 디딤)
    foot(s, 22 - w, g - 2, R, 2, w); // 오른발 들림
  } else if (f === 3) {
    foot(s, 24 - w, g, R, 2, w);
    foot(s, 10, g - 2, R, 2, w);
  } else {
    foot(s, 9, g, R, 2, w);
    foot(s, 23 - w, g, R, 2, w);
  }
}

function sideFeet(s, id, f) {
  const c = CHARS[id];
  const R = c.limb;
  const w = id === 2 ? 5 : 4;
  const g = 36;
  if (f === 1) {
    foot(s, 19, g, R, 1, w); // 먼 발 뒤로
    foot(s, 8, g, R, 2, w); // 가까운 발 앞으로
  } else if (f === 3) {
    foot(s, 8, g, R, 1, w);
    foot(s, 19, g, R, 2, w);
  } else {
    foot(s, 16, g, R, 1, w);
    foot(s, 11, g, R, 2, w);
  }
}

function sideArm(s, c, f, dy) {
  // 몸 앞쪽 실루엣 밖으로 살짝 내민 팔 — 외곽선이 자동으로 잡아준다
  const ax = f === 1 ? 9 : f === 3 ? 7 : 8;
  const ay = 28 + dy;
  s.fillRect(ax, ay, 3, 5, c.body[2]);
  s.px(ax, ay, c.body[3]);
  s.hLine(ax, ay + 4, 3, c.body[1]);
  s.px(ax + 2, ay + 4, c.body[0]);
}

function armsFront(s, c, mode, flail, dy) {
  const R = c.body;
  if (mode === "up") {
    armRaised(s, R, dy, false);
    armRaised(s, R, dy, true);
  } else if (mode === "flail") {
    if (flail === 0) {
      armRaised(s, R, dy, false);
      armNub(s, 23, 29 + dy, R);
    } else {
      armNub(s, 7, 29 + dy, R);
      armRaised(s, R, dy, true);
    }
  } else {
    armNub(s, 7, 28 + dy, R);
    armNub(s, 23, 28 + dy, R);
  }
}

// ── 방향별 본체 ────────────────────────────────────────────
function drawDown(s, id, o = {}) {
  const {
    f = 0,
    face = "normal",
    arms = "walk",
    flail = 0,
    tilt = 0,
    gdy = 0,
    legs = "walk",
    haloY = -1,
  } = o;
  const c = CHARS[id];
  const dy = (f === 1 || f === 3 ? -1 : 0) + gdy;
  const hx = CX + tilt;
  const hy = 16 + dy;
  const by = 31 + dy;
  const armsLate = arms === "up" || arms === "flail";

  if (id === 1) catTailDown(s, c, dy, false);
  if (id === 3) foxTailDown(s, c, dy, false);

  ball(s, CX, by, c.br[0], c.br[1], c.body);
  s.ellipse(CX, by + 1.5, c.br[0] - 3, c.br[1] - 3, c.belly[2]);
  feetFront(s, id, legs, f, gdy);
  // 든 팔은 머리에 가려지도록 머리보다 먼저 그린다
  armsFront(s, c, armsLate ? arms : "side", flail, dy);

  ball(s, hx, hy, c.hr[0], c.hr[1], c.body);
  s.hLine(hx - 4, hy + c.hr[1] + 1, 8, c.body[1]); // 턱밑 그림자
  headDecor(s, id, c, hx, hy, "down");
  faceDown(s, id, c, hx, hy, face);
  if (face === "trapped") sweatDrop(s, tilt < 0 ? 27 : 4, 7);
  if (haloY >= 0) halo(s, hx, haloY);
  s.outlineSilhouette(OUT);
}

function drawUp(s, id, f) {
  const c = CHARS[id];
  const dy = f === 1 || f === 3 ? -1 : 0;
  const hy = 16 + dy;
  const by = 31 + dy;
  ball(s, CX, by, c.br[0], c.br[1], c.body);
  backDetail(s, id, c, dy);
  feetFront(s, id, "walk", f === 1 ? 3 : f === 3 ? 1 : f, 0);
  armsFront(s, c, "side", 0, dy);
  if (id === 1) catTailDown(s, c, dy, true);
  if (id === 3) foxTailDown(s, c, dy, true);
  ball(s, CX, hy, c.hr[0], c.hr[1], c.body);
  headDecor(s, id, c, CX, hy, "up");
  s.outlineSilhouette(OUT);
}

function drawSide(s, id, f) {
  const c = CHARS[id];
  const dy = f === 1 || f === 3 ? -1 : 0;
  const hx = 14.5;
  const hy = 16 + dy;
  const bx = 16.5;
  const by = 31 + dy;
  if (id === 0) {
    // 꽁지깃
    s.px(24, 28 + dy, c.body[1]);
    s.px(25, 27 + dy, c.body[1]);
    s.fillRect(23, 29 + dy, 2, 2, c.body[1]);
  }
  if (id === 1) catTailSide(s, c, dy);
  if (id === 3) foxTailSide(s, c, dy);
  ball(s, bx, by, c.br[0] - 0.5, c.br[1], c.body);
  sideFeet(s, id, f);
  sideArm(s, c, f, dy);
  ball(s, hx, hy, c.hr[0], c.hr[1], c.body);
  headDecor(s, id, c, hx, hy, "side");
  faceSide(s, id, c, hy);
  s.outlineSilhouette(OUT);
}

// ── 프레임 목록 조립 ───────────────────────────────────────
function walkDraw(id, dir, f) {
  return (s) => {
    if (dir === "down") drawDown(s, id, { f });
    else if (dir === "up") drawUp(s, id, f);
    else if (dir === "left") drawSide(s, id, f);
    else {
      const t = new Sprite(W, H);
      drawSide(t, id, f === 1 ? 3 : f === 3 ? 1 : f);
      s.blit(t, 0, 0, { flipX: true });
    }
  };
}

const sprites = [];
for (let id = 0; id < 4; id++) {
  for (const dir of ["down", "up", "left", "right"])
    for (let f = 0; f < 4; f++)
      sprites.push({ name: `char${id}_${dir}_${f}`, w: W, h: H, draw: walkDraw(id, dir, f) });

  for (let i = 0; i < 2; i++) {
    sprites.push({
      name: `char${id}_trapped_${i}`,
      w: W,
      h: H,
      draw: (s) =>
        drawDown(s, id, { face: "trapped", arms: "flail", flail: i, tilt: i ? 1 : -1, legs: "spread" }),
    });
  }
  for (let i = 0; i < 2; i++) {
    sprites.push({
      name: `char${id}_win_${i}`,
      w: W,
      h: H,
      draw: (s) =>
        drawDown(s, id, { face: "win", arms: "up", gdy: i ? -2 : 0, legs: i ? "dangle" : "walk" }),
    });
  }
  for (let i = 0; i < 2; i++) {
    sprites.push({
      name: `char${id}_dead_${i}`,
      w: W,
      h: H,
      draw: (s) => {
        drawDown(s, id, { face: "dead", arms: "side", gdy: i ? -1 : 0, haloY: i ? 0 : 1 });
        fade(s);
      },
    });
  }
}

export default { name: "characters", sprites };
