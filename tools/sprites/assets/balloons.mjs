// 물풍선 + 물줄기 + 갇힘 버블 — 오리지널 디자인.
// 광원: 좌상단 고정. 가로 줄기는 윗변이 밝고, 세로 줄기는 왼쪽이 밝다.
import { PAL, shade, parseColor, Sprite, makeRng } from "../lib.mjs";

const O = PAL.outline;
const DEEP = PAL.waterDeep;
const WAT = PAL.water;
const LIT = PAL.waterLight;
const FOAM = PAL.foam;

// 색 + 알파 오버라이드
const A = (c, a) => {
  const [r, g, b] = parseColor(c);
  return [r, g, b, a];
};

// 현재 픽셀이 WAT(기본 물색)일 때만 칠한다 — 아웃라인 보호용
const WATC = parseColor(WAT);
function overWater(s, x, y, c) {
  const p = s.get(Math.round(x), Math.round(y));
  if (p[3] === 255 && p[0] === WATC[0] && p[1] === WATC[1] && p[2] === WATC[2])
    s.px(x, y, c);
}

function erase(s, x, y) {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
  const i = (y * s.w + x) * 4;
  s.data[i] = s.data[i + 1] = s.data[i + 2] = s.data[i + 3] = 0;
}

// 작은 물방울 (r<=0.7 → 2px 미니 방울, 그 이상은 아웃라인 있는 방울)
function droplet(s, x, y, r) {
  if (r <= 0.7) {
    s.px(x, y, LIT);
    s.px(x, y - 1, A(FOAM, 200));
    return;
  }
  s.disc(x, y, r + 0.9, O);
  s.disc(x, y, r, WAT);
  s.px(x - 1, y - 1, FOAM);
  if (r >= 1.4) {
    s.px(x, y - 1, LIT);
    s.px(x - 1, y, LIT);
  }
}

// lib.ellipse(톨러런스 1.08)는 적도에 1px 돌출이 생기므로, 몸통은 빡빡한 라스터 사용
function fillEllipse(s, cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) s.px(x, y, c);
    }
}

function sparkle(s, x, y) {
  s.px(x, y, PAL.white);
  s.px(x - 1, y, A(PAL.white, 150));
  s.px(x + 1, y, A(PAL.white, 150));
  s.px(x, y - 1, A(PAL.white, 150));
  s.px(x, y + 1, A(PAL.white, 150));
}

// 그리기 변환 헬퍼: 좌우반전 / 전치(가로↔세로, 좌상단 광원 보존)
function flippedX(draw) {
  return (s) => {
    const t = new Sprite(s.w, s.h);
    draw(t);
    s.blit(t, 0, 0, { flipX: true });
  };
}
function transposed(draw) {
  return (s) => {
    const t = new Sprite(s.h, s.w);
    draw(t);
    for (let y = 0; y < t.h; y++)
      for (let x = 0; x < t.w; x++) {
        const c = t.get(x, y);
        if (c[3] > 0) s.px(y, x, c);
      }
  };
}

// ── 물풍선 ─────────────────────────────────────────────────
function drawBalloon(s, { rx, ry, phase = 0, flash = false }) {
  const cx = 15.5;
  const cy = Math.floor(29 - ry) + 0.5; // 바닥 고정 펄스 (반정수 중심 → 적도 돌출 방지)
  const top = cy - ry - 1; // 몸통 아웃라인 최상단

  // 실루엣(매듭+몸통)을 한 번에 채우고 outlineSilhouette로 깔끔한 1px 외곽선
  const knotC = flash ? "#ffb3b8" : WAT;
  const knotD = flash ? shade(PAL.red, -0.3) : DEEP;
  const baseC = flash ? PAL.red : DEEP;
  const t = new Sprite(32, 32);
  t.ellipse(cx, top - 1.5, 2.6, 1.4, knotC); // 매듭 꼭지
  t.fillRect(14, top - 1, 4, 3, knotD); // 매듭 목(조임)
  fillEllipse(t, cx, cy, rx, ry, baseC); // 몸통 베이스(가장 어두운 톤)
  t.outlineSilhouette(O);
  s.blit(t, 0, 0);
  s.px(cx - 1.5, top - 2, flash ? "#ffe2e4" : LIT);

  if (flash) {
    s.ellipse(cx - 0.4, cy - 0.4, rx - 1.1, ry - 1.1, "#ff9aa0");
    s.ellipse(cx - 0.7, cy - 0.8, rx - 2.6, ry - 2.4, "#ffe9ea");
    s.ellipse(cx - 1.6, cy - 2.2, rx - 6, ry - 6.5, PAL.white);
  } else {
    s.ellipse(cx - 0.6, cy - 0.7, rx - 0.7, ry - 0.7, WAT);
    // 찰랑이는 수면 — 위 공기층(밝음) + 또렷한 거품 수면선, phase로 파동/기울기 변화
    const wl = cy - ry + 4.5;
    const wave = (x) =>
      Math.sin(x * 0.55 + phase * 2.1) * 1.3 + (phase - 1) * (x - cx) * 0.12;
    const inner = (x, y, m) => {
      const nx = (x - (cx - 0.6)) / (rx - m);
      const ny = (y - (cy - 0.7)) / (ry - m);
      return nx * nx + ny * ny <= 1;
    };
    for (let y = Math.floor(cy - ry); y < cy; y++)
      for (let x = 0; x < 32; x++)
        if (inner(x, y, 0.9) && y < wl + wave(x)) s.px(x, y, LIT);
    for (let x = 2; x < 30; x++) {
      const yy = Math.round(wl + wave(x));
      if (inner(x, yy, 1.1)) s.px(x, yy, FOAM); // 수면선
    }
    // 물속 잔물결
    s.hLine(9 + phase, cy + 2, 3, LIT);
    s.hLine(17 - phase, cy + 4, 4, A(LIT, 160));
  }
  // 좌상단 스킨 하이라이트
  s.ellipse(cx - rx * 0.5, cy - ry * 0.55, 2.2, 1.3, flash ? PAL.white : FOAM);
  s.px(cx - rx * 0.5 + 3, cy - ry * 0.55 + 2, flash ? PAL.white : FOAM);

  // 얼굴 — 점 눈 + 오므린 입
  const ey = Math.round(cy);
  const eyeY = flash ? ey - 1 : ey;
  s.fillRect(10, eyeY, 2, 2, O);
  s.fillRect(19, eyeY, 2, 2, O);
  s.px(10, eyeY, PAL.white);
  s.px(19, eyeY, PAL.white);
  if (flash) {
    s.fillRect(14, ey + 3, 3, 3, O);
    s.px(15, ey + 4, "#8f2630");
    sparkle(s, 5, 7);
    sparkle(s, 27, 10);
    s.px(3, 18, PAL.white);
    s.px(29, 20, PAL.white);
  } else {
    s.fillRect(15, ey + 3, 2, 2, O);
    s.hLine(7, ey + 2, 2, A(PAL.pink, 150));
    s.hLine(23, ey + 2, 2, A(PAL.pink, 150));
  }
}

// ── 물줄기 공통 ────────────────────────────────────────────
const HALF = [6, 8, 7, 0]; // age별 코어 절반 두께 (age1 = 16px 풀 코어)

// 가로 몸통: age3는 잔흔
function drawBodyH3(s) {
  for (let x = 0; x < 32; x++)
    if (x % 8 < 5) {
      s.px(x, 15, A(LIT, 210));
      s.px(x, 16, A(WAT, 210));
    }
  droplet(s, 2, 12, 0.6);
  droplet(s, 6, 19, 1.1);
  droplet(s, 13, 11, 1);
  droplet(s, 19, 18, 1.4);
  droplet(s, 25, 13, 1);
  droplet(s, 29, 20, 0.6);
  s.px(9, 14, A(FOAM, 190));
  s.px(16, 20, A(FOAM, 190));
  s.px(22, 10, A(FOAM, 190));
  s.px(30, 15, A(FOAM, 190));
}

function drawBodyH(s, age) {
  if (age === 3) return drawBodyH3(s);
  const half = HALF[age];
  const topE = 16 - half;
  const botE = 15 + half;
  for (let x = 0; x < 32; x++) {
    s.px(x, topE, O);
    s.px(x, botE, O);
    for (let y = topE + 1; y <= botE - 1; y++) {
      let c = WAT;
      if (y <= topE + (half >= 7 ? 2 : 1)) c = LIT;
      else if (y >= botE - (half >= 8 ? 2 : 1)) c = DEEP;
      else if (age === 1 && (y === 15 || y === 16))
        c = (x + 2) % 9 < 7 ? FOAM : LIT;
      else if (age === 1 && (y === 14 || y === 17)) c = LIT;
      else if ((y === 15 || y === 16) && (x + age * 3) % 7 < 5) c = LIT;
      s.px(x, y, c);
    }
  }
  // 가장자리 거품 (프레임별 결정적 → 타일 이음새 일관)
  const rng = makeRng(101 + age * 977);
  for (let x = 0; x < 32; x++) {
    if (rng() < 0.35) s.px(x, topE + 1, FOAM);
    if (rng() < 0.2) s.px(x, botE - 1, FOAM);
    if (age === 1) {
      if (rng() < 0.22) s.px(x, topE - 1, A(FOAM, 230));
      if (rng() < 0.22) s.px(x, botE + 1, A(FOAM, 230));
    }
  }
}

// 오른쪽으로 뻗는 물머리 (l/u/d는 변환으로 파생)
const END_HX = [13, 20, 16]; // age별 캡 중심 x
function drawEndR3(s) {
  for (let x = 0; x < 10; x++)
    if (x % 8 < 5) {
      const a = 220 - x * 12;
      s.px(x, 15, A(LIT, a));
      s.px(x, 16, A(WAT, a));
    }
  droplet(s, 12, 15, 1.6);
  droplet(s, 17, 11, 1);
  droplet(s, 18, 20, 0.9);
  droplet(s, 23, 16, 1.1);
  droplet(s, 27, 12, 0.6);
  droplet(s, 28, 19, 0.5);
  s.px(15, 8, A(FOAM, 190));
  s.px(21, 7, A(FOAM, 180));
  s.px(22, 23, A(FOAM, 180));
  s.px(30, 15, A(FOAM, 170));
}

function drawEndR(s, age) {
  if (age === 3) return drawEndR3(s);
  const half = HALF[age];
  const hx = END_HX[age];
  const capRx = half * 0.85;
  const ins = (x, y) => {
    const py = y - 15.5;
    if (x <= hx) return Math.abs(py) <= half - 0.2;
    const nx = (x - hx) / capRx;
    const ny = py / (half - 0.2);
    return nx * nx + ny * ny <= 1.08;
  };
  for (let x = 0; x < 32; x++) {
    let minY = -1;
    let maxY = -1;
    for (let y = 0; y < 32; y++)
      if (ins(x, y)) {
        if (minY < 0) minY = y;
        maxY = y;
      }
    if (minY < 0) continue;
    for (let y = minY; y <= maxY; y++) {
      const edge =
        !ins(x + 1, y) || (x > 0 && !ins(x - 1, y)) || !ins(x, y + 1) || !ins(x, y - 1);
      let c;
      if (edge) c = O;
      else if (age === 1 && x > hx + capRx - 2.5) c = FOAM; // 물머리 백파
      else if (age === 0 && x > hx + capRx - 1.5) c = LIT;
      else if (y <= minY + (half >= 7 ? 2 : 1)) c = LIT;
      else if (y >= maxY - (half >= 8 ? 2 : 1)) c = DEEP;
      else if (age === 1 && (y === 15 || y === 16)) c = (x + 2) % 9 < 7 ? FOAM : LIT;
      else if (age === 1 && (y === 14 || y === 17)) c = LIT;
      else if ((y === 15 || y === 16) && (x + age * 3) % 7 < 5) c = LIT;
      else c = WAT;
      s.px(x, y, c);
    }
  }
  // 튀는 물방울 + 비말
  const DROPS = [
    [[21, 11, 0.6], [22, 17, 1], [25, 14, 0.5]],
    [[29, 9, 1], [30, 15, 1.2], [29, 22, 1], [26, 5, 0.6], [26, 26, 0.6]],
    [[26, 13, 0.8], [27, 18, 0.6], [24, 8, 0.5]],
  ][age];
  for (const [dx, dy, dr] of DROPS) droplet(s, dx, dy, dr);
  if (age === 1) {
    s.px(25, 6, A(FOAM, 220));
    s.px(28, 25, A(FOAM, 220));
    s.px(31, 12, A(FOAM, 200));
    s.px(31, 19, A(FOAM, 200));
  }
}

// 중심 프레임 밑바탕: 인접 팔과 같은 단면의 십자 물줄기.
// center_0/2 장식이 타일 가장자리까지 닿지 않아 팔과 끊겨 보이는 문제를 막는다.
// 교차부에서는 상대 밴드의 내부(물)가 아웃라인을 덮어 십자가 뚫린 형태가 되게 한다.
function drawCenterBase(s, age) {
  const hb = new Sprite(32, 32);
  drawBodyH(hb, age);
  const vb = new Sprite(32, 32);
  transposed((t) => drawBodyH(t, age))(vb);
  const Oc = parseColor(O);
  const isOutline = (p) => p[0] === Oc[0] && p[1] === Oc[1] && p[2] === Oc[2];
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const hp = hb.get(x, y);
      const vp = vb.get(x, y);
      let p = null;
      if (hp[3] > 0 && vp[3] > 0) p = isOutline(hp) && !isOutline(vp) ? vp : hp;
      else if (hp[3] > 0) p = hp;
      else if (vp[3] > 0) p = vp;
      if (p) s.px(x, y, p);
    }
}

// ── 폭발 중심 ──────────────────────────────────────────────
function drawCenter0(s) {
  drawCenterBase(s, 0);
  const t = new Sprite(32, 32);
  // 왕관형 물보라: 좌/중/우 세 갈래 분출 + 몸통 + 바닥 물판
  t.ellipse(9.5, 12, 2.4, 4.4, WAT);
  t.ellipse(15.5, 9, 3, 5.6, WAT);
  t.ellipse(21.5, 12, 2.4, 4.4, WAT);
  t.ellipse(15.5, 18.5, 7, 5.4, WAT);
  t.ellipse(15.5, 25, 10, 3.4, WAT);
  t.outlineSilhouette(O);
  s.blit(t, 0, 0);
  // 좌측광
  for (let y = 9; y < 23; y++) {
    overWater(s, 9, y, LIT);
    overWater(s, 10, y, LIT);
    if (y % 2 === 0) overWater(s, 11, y, LIT);
  }
  // 우측 그림자
  for (let y = 10; y < 24; y++) {
    overWater(s, 21, y, DEEP);
    overWater(s, 20, y, DEEP);
    if (y % 2 === 1) overWater(s, 19, y, A(DEEP, 180));
  }
  // 분출 끝 거품 크레스트
  s.ellipse(15, 6.5, 2, 2, FOAM);
  s.ellipse(9, 9.5, 1.4, 1.6, FOAM);
  s.ellipse(21, 9.5, 1.4, 1.6, FOAM);
  for (let y = 8; y < 18; y++) overWater(s, 15, y, y % 4 === 3 ? LIT : FOAM);
  for (let y = 11; y < 16; y++) {
    overWater(s, 16, y, FOAM);
    if (y % 2 === 0) overWater(s, 9, y, FOAM);
  }
  // 바닥 물판 명암
  for (let x = 8; x < 15; x++) overWater(s, x, 23, LIT);
  for (let x = 11; x < 22; x++) overWater(s, x, 26.5, DEEP);
  s.px(8, 23, FOAM);
  s.px(12, 22, FOAM);
  s.px(21, 23, FOAM);
  // 위로 튀는 방울
  droplet(s, 5, 6, 0.6);
  droplet(s, 12, 3, 0.5);
  droplet(s, 16, 1, 1);
  droplet(s, 24, 5, 1);
  droplet(s, 27, 11, 0.5);
  droplet(s, 3, 13, 0.5);
}

function drawCenter1(s) {
  s.fillRect(0, 0, 32, 32, WAT);
  // 명암 밴드 (좌상광)
  s.fillRect(1, 1, 30, 2, LIT);
  s.fillRect(1, 1, 2, 30, LIT);
  s.fillRect(1, 29, 30, 2, DEEP);
  s.fillRect(29, 1, 2, 30, DEEP);
  // 십자 광선 (인접 팔 코어와 연결)
  s.fillRect(0, 14, 32, 1, LIT);
  s.fillRect(0, 17, 32, 1, LIT);
  s.fillRect(14, 0, 1, 32, LIT);
  s.fillRect(17, 0, 1, 32, LIT);
  s.fillRect(0, 15, 32, 2, FOAM);
  s.fillRect(15, 0, 2, 32, FOAM);
  // 대각 광선
  for (let t = 4; t <= 9; t++) {
    const c = t <= 6 ? FOAM : LIT;
    s.px(15 - t, 15 - t, c);
    s.px(16 + t, 15 - t, c);
    s.px(15 - t, 16 + t, c);
    s.px(16 + t, 16 + t, c);
  }
  // 중앙 버스트 + 기포 링
  s.disc(15.5, 15.5, 6.2, LIT);
  s.disc(15.5, 15.5, 4.6, FOAM);
  for (let k = 0; k < 12; k++) {
    if (k % 3 === 1) continue;
    const a = (k * Math.PI) / 6 + 0.26;
    s.px(15.5 + Math.cos(a) * 9.5, 15.5 + Math.sin(a) * 9, FOAM);
  }
  // 가장자리: 팔 단면 프로필로 이음새 연결 (8..23), 모서리 구간만 아웃라인
  const prof = (i) =>
    i === 8 || i === 23
      ? O
      : i === 9 || i === 10
        ? LIT
        : i === 15 || i === 16
          ? FOAM
          : i === 14 || i === 17
            ? LIT
            : i === 21 || i === 22
              ? DEEP
              : WAT;
  for (let i = 8; i <= 23; i++) {
    const c = prof(i);
    s.px(i, 0, c);
    s.px(i, 31, c);
    s.px(0, i, c);
    s.px(31, i, c);
  }
  for (let i = 0; i < 32; i++) {
    if (i >= 8 && i <= 23) continue;
    s.px(i, 0, O);
    s.px(i, 31, O);
    s.px(0, i, O);
    s.px(31, i, O);
  }
  // 둥근 모서리 컷 + 대각 아웃라인
  const cuts = [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [0, 2],
  ];
  for (const [dx, dy] of cuts) {
    erase(s, dx, dy);
    erase(s, 31 - dx, dy);
    erase(s, dx, 31 - dy);
    erase(s, 31 - dx, 31 - dy);
  }
  for (const [px1, py1] of [
    [2, 1],
    [1, 2],
  ]) {
    s.px(px1, py1, O);
    s.px(31 - px1, py1, O);
    s.px(px1, 31 - py1, O);
    s.px(31 - px1, 31 - py1, O);
  }
}

function drawCenter2(s) {
  drawCenterBase(s, 2);
  const t = new Sprite(32, 32);
  t.ellipse(15.5, 15.5, 12.4, 11.8, WAT);
  t.outlineSilhouette(O);
  s.blit(t, 0, 0);
  // 좌상 밝음 / 우하 그림자 아크
  for (let a = 0; a < Math.PI * 2; a += 0.04) {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    if (a > Math.PI * 0.85 && a < Math.PI * 1.65) {
      overWater(s, 15.5 + ca * 10.6, 15.5 + sa * 10, LIT);
      overWater(s, 15.5 + ca * 9.6, 15.5 + sa * 9.1, LIT);
    }
    if (a < Math.PI * 0.65 || a > Math.PI * 1.97) {
      overWater(s, 15.5 + ca * 10.6, 15.5 + sa * 10, DEEP);
      overWater(s, 15.5 + ca * 9.7, 15.5 + sa * 9.2, A(DEEP, 200));
    }
  }
  // 거품 링 + 중심
  s.circle(15.5, 15.5, 7.2, FOAM);
  s.circle(15.5, 15.5, 6.2, A(FOAM, 150));
  s.disc(15.5, 15.5, 3.6, LIT);
  s.disc(14.8, 14.8, 1.8, FOAM);
  // 흩어지는 방울
  droplet(s, 4, 4, 1);
  droplet(s, 27, 4, 1.1);
  droplet(s, 3, 26, 0.8);
  droplet(s, 28, 27, 1);
  s.px(9, 1, A(FOAM, 200));
  s.px(30, 12, A(FOAM, 200));
  s.px(1, 16, A(FOAM, 200));
  s.px(23, 30, A(FOAM, 200));
}

function drawCenter3(s) {
  // 끊긴 거품 링
  for (let k = 0; k < 44; k++) {
    const a = (k / 44) * Math.PI * 2;
    const g = Math.sin(a * 2.5 + 0.7);
    if (g < -0.35) continue;
    s.px(15.5 + Math.cos(a) * 10.4, 15.5 + Math.sin(a) * 9.6, A(FOAM, 215));
    if (g > 0.45)
      s.px(15.5 + Math.cos(a) * 9.2, 15.5 + Math.sin(a) * 8.5, A(LIT, 170));
  }
  // 중앙 물웅덩이 잔해
  s.ellipse(15.5, 16.5, 5.6, 3.2, A(WAT, 150));
  s.ellipse(14.8, 15.8, 4.2, 2.2, A(LIT, 170));
  s.ellipse(14, 15, 2, 1.1, A(FOAM, 200));
  // 마지막 방울들
  droplet(s, 8, 5, 0.5);
  droplet(s, 23, 4, 1);
  droplet(s, 28, 17, 0.5);
  droplet(s, 6, 24, 1);
  droplet(s, 20, 28, 0.5);
  droplet(s, 3, 13, 0.5);
}

// ── 갇힘 비눗방울 (40x40, 반투명) ──────────────────────────
const RAINBOW = ["#ffc2dd", "#ffe9a3", "#c8f5b0", "#aef0ff", "#cdbdff", "#ffd6f2"];
function drawBubble(s, f) {
  const cx = 19.5;
  const cy = 19.5;
  const [rx, ry] = [
    [17, 17],
    [18, 16],
    [16.5, 17.5],
  ][f];
  for (let y = 0; y < 40; y++)
    for (let x = 0; x < 40; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const n = nx * nx + ny * ny;
      if (n > 1.04) continue;
      const ang = Math.atan2(ny, nx);
      const seg = ((ang + Math.PI) / (Math.PI * 2)) * 6 + f * 1.4;
      const idx = ((Math.floor(seg) % 6) + 6) % 6;
      if (n > 0.97) {
        s.px(x, y, A(RAINBOW[idx], 235)); // 무지개 림
      } else if (n > 0.86) {
        s.px(x, y, A(RAINBOW[idx], 100)); // 림 안쪽 번짐
      } else {
        s.px(x, y, A(LIT, 95)); // 반투명 본체
        const dir = (nx + ny) / Math.SQRT2; // 광원축 방향성 (-1 좌상 ~ +1 우하)
        if (n > 0.42 && dir > 0.25)
          s.px(x, y, A(DEEP, 22 + dir * 38)); // 우하단 깊이 (림 곡률 따라 초승달)
        if (n > 0.5 && dir < -0.55) s.px(x, y, A(FOAM, 50)); // 좌상단 들림
      }
    }
  // 좌상단 대형 하이라이트 (프레임별 1px 흔들림)
  const hx = cx - rx * 0.42 + (f === 1 ? 1 : 0);
  const hy = cy - ry * 0.46 + (f === 2 ? 1 : 0);
  s.ellipse(hx, hy, 4.4, 2.6, A(FOAM, 200));
  s.ellipse(hx + 0.5, hy - 0.4, 2.4, 1.2, [255, 255, 255, 245]);
  s.px(hx - 4, hy + 4, A(FOAM, 170));
  s.px(hx - 3, hy + 5.5, A(FOAM, 140));
  // 우하단 보조 글린트 + 상단 스파클
  s.hLine(Math.round(cx + rx * 0.3), Math.round(cy + ry * 0.55), 3, A(FOAM, 130));
  sparkle(s, Math.round(cx + rx * 0.45), Math.round(cy - ry * 0.55));
}

// ── 프레임 테이블 ──────────────────────────────────────────
const F32 = (name, draw) => ({ name, w: 32, h: 32, draw });
const AGES = [0, 1, 2, 3];

export default {
  name: "balloons",
  sprites: [
    F32("balloon_0", (s) => drawBalloon(s, { rx: 13, ry: 11.5, phase: 0 })),
    F32("balloon_1", (s) => drawBalloon(s, { rx: 14, ry: 12.5, phase: 1 })),
    F32("balloon_2", (s) => drawBalloon(s, { rx: 13.5, ry: 12, phase: 2 })),
    F32("balloon_flash", (s) =>
      drawBalloon(s, { rx: 14.5, ry: 13, phase: 1, flash: true })
    ),
    F32("stream_center_0", drawCenter0),
    F32("stream_center_1", drawCenter1),
    F32("stream_center_2", drawCenter2),
    F32("stream_center_3", drawCenter3),
    ...AGES.map((a) => F32(`stream_h_${a}`, (s) => drawBodyH(s, a))),
    ...AGES.map((a) => F32(`stream_v_${a}`, transposed((t) => drawBodyH(t, a)))),
    ...AGES.map((a) => F32(`stream_end_r_${a}`, (s) => drawEndR(s, a))),
    ...AGES.map((a) => F32(`stream_end_l_${a}`, flippedX((t) => drawEndR(t, a)))),
    ...AGES.map((a) =>
      F32(`stream_end_d_${a}`, transposed((t) => drawEndR(t, a)))
    ),
    ...AGES.map((a) =>
      F32(`stream_end_u_${a}`, transposed(flippedX((t) => drawEndR(t, a))))
    ),
    { name: "bubble_0", w: 40, h: 40, draw: (s) => drawBubble(s, 0) },
    { name: "bubble_1", w: 40, h: 40, draw: (s) => drawBubble(s, 1) },
    { name: "bubble_2", w: 40, h: 40, draw: (s) => drawBubble(s, 2) },
  ],
};
