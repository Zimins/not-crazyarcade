// effects.mjs — 이펙트 모음: 소프트블록 물보라 / 버블 팝 / 아이템 스파클 / 그림자 / 파비콘
// 광원: 좌상단 고정. 물 계열은 PAL.water 램프, 스파클은 PAL.yellow 램프.
import { PAL, ramp, shade, parseColor } from "../lib.mjs";

const W = ramp(PAL.water); // [진그림자, 그림자, 기본, 하이라이트]
const Y = ramp(PAL.yellow);
const FOAM = PAL.foam;
const LIGHT = PAL.waterLight;
const DEEP = PAL.waterDeep;
const OUT = PAL.outline;

const fade = (c, a) => {
  const [r, g, b] = parseColor(c);
  return [r, g, b, a];
};

// ── 공유 헬퍼 ──────────────────────────────────────────────
/// 물방울: size 1=점, 2=2x2, 3=3x3 둥근 방울. 좌상단 하이라이트 유지.
function droplet(s, x, y, size = 2, a = 255) {
  if (size <= 1) {
    s.px(x, y, fade(LIGHT, a));
    return;
  }
  if (size === 2) {
    s.px(x, y, fade(FOAM, a));
    s.px(x + 1, y, fade(W[2], a));
    s.px(x, y + 1, fade(W[2], a));
    s.px(x + 1, y + 1, fade(W[1], a));
    return;
  }
  // size 3: 모서리 빠진 3x3 (둥근 느낌)
  s.px(x, y, fade(FOAM, a));
  s.px(x + 1, y, fade(LIGHT, a));
  s.px(x, y + 1, fade(LIGHT, a));
  s.px(x + 1, y + 1, fade(W[2], a));
  s.px(x + 2, y + 1, fade(W[1], a));
  s.px(x + 1, y + 2, fade(W[1], a));
}

/// 중심에서 반지름 r 위치에 방울들을 원형 배치 (squash: 수직 납작 비율)
function radialDrops(s, cx, cy, r, count, size, opts = {}) {
  const { phase = 0, squash = 0.85, a = 255, trail = false } = opts;
  for (let i = 0; i < count; i++) {
    const ang = phase + (i * Math.PI * 2) / count;
    const x = Math.round(cx + Math.cos(ang) * r - size / 2);
    const y = Math.round(cy + Math.sin(ang) * r * squash - size / 2);
    droplet(s, x, y, size, a);
    if (trail) {
      s.px(
        Math.round(cx + Math.cos(ang) * (r - 2.5)),
        Math.round(cy + Math.sin(ang) * (r - 2.5) * squash),
        fade(LIGHT, 110)
      );
    }
  }
}

/// 광원 방향 셰이딩이 들어간 물 링 (좌상단 거품빛 → 우하단 그림자)
function waterRing(s, cx, cy, rx, ry, t = 2, opts = {}) {
  const { a = 255, broken = false } = opts;
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++)
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = Math.hypot(nx, ny);
      if (d > 1.02 || d < 1.02 - t / Math.min(rx, ry)) continue;
      const ang = Math.atan2(y - cy, x - cx);
      if (broken && Math.sin(ang * 3 + 0.8) < -0.35) continue; // 3군데 끊김
      const facing = Math.cos(ang + Math.PI * 0.75); // 1 = 좌상단
      const c = facing > 0.55 ? FOAM : facing > -0.2 ? LIGHT : facing > -0.75 ? W[2] : W[1];
      s.px(x, y, fade(c, a));
    }
}

/// 링 바깥으로 뻗는 방사형 물줄기 스파이크
function burstSpikes(s, cx, cy, rx, ry, len, count, opts = {}) {
  const { phase = 0, a = 255 } = opts;
  for (let i = 0; i < count; i++) {
    const ang = phase + (i * Math.PI * 2) / count;
    for (let d = 0; d <= len; d++) {
      const c = d === len ? FOAM : d > len / 2 ? LIGHT : W[2];
      s.px(
        Math.round(cx + Math.cos(ang) * (rx + d)),
        Math.round(cy + Math.sin(ang) * (ry + d)),
        fade(c, a)
      );
    }
  }
}

/// 4방향 십자성 (중심 흰색 → 노랑 → 끝 짙은 노랑) + 옵션 대각 잔가지
function star4(s, cx, cy, len, opts = {}) {
  const { diag = 0, a = 255 } = opts;
  for (let d = 1; d <= len; d++) {
    const c = d <= Math.max(1, Math.round(len * 0.4)) ? PAL.white : d < len ? PAL.yellow : Y[1];
    s.px(cx + d, cy, fade(c, a));
    s.px(cx - d, cy, fade(c, a));
    s.px(cx, cy + d, fade(c, a));
    s.px(cx, cy - d, fade(c, a));
  }
  s.px(cx, cy, fade(PAL.white, a));
  for (let d = 1; d <= diag; d++) {
    const c = d === diag ? Y[1] : PAL.yellow;
    s.px(cx + d, cy + d, fade(c, a));
    s.px(cx - d, cy - d, fade(c, a));
    s.px(cx + d, cy - d, fade(c, a));
    s.px(cx - d, cy + d, fade(c, a));
  }
}

// ── splash: 소프트 블록 파괴 물보라 (32x32, 중심 16,17) ────
function splash0(s) {
  // 응축된 물 덩어리 + 위로 솟는 왕관 스파이크
  s.ellipse(16, 18, 6, 4.5, W[1]);
  s.ellipse(15, 17, 5, 3.8, W[2]);
  s.ellipse(14, 16, 3, 2.2, LIGHT);
  s.fillRect(13, 15, 2, 1, FOAM);
  s.px(12, 16, FOAM);
  // 바닥 짙은 물색 (우하단 그림자 방향)
  s.hLine(14, 22, 6, DEEP);
  s.px(20, 21, DEEP);
  // 왕관 스파이크 (중앙이 가장 높게)
  s.vLine(11, 12, 3, LIGHT);
  s.px(11, 11, FOAM);
  s.vLine(16, 10, 4, W[2]);
  s.px(16, 9, LIGHT);
  s.px(16, 8, FOAM);
  s.vLine(21, 12, 3, W[2]);
  s.px(21, 11, LIGHT);
  // 막 튀기 시작한 점방울
  droplet(s, 7, 17, 1);
  droplet(s, 25, 16, 1);
}

function splash1(s) {
  // 확산 링 + 링 가장자리 파편
  waterRing(s, 16, 17, 8, 6, 2.4);
  burstSpikes(s, 16, 17, 8, 6, 2, 4, { phase: Math.PI / 4 });
  // 중앙 잔심 (꺼져가는 거품)
  s.px(16, 16, FOAM);
  s.px(15, 16, LIGHT);
  s.px(17, 16, LIGHT);
  s.px(16, 15, LIGHT);
  s.px(16, 17, W[2]);
  radialDrops(s, 16, 17, 11.5, 6, 2, { phase: 0.4 });
}

function splash2(s) {
  // 끊어진 링 + 멀리 흩어진 파편
  waterRing(s, 16, 17, 11, 8.5, 1.6, { broken: true, a: 235 });
  radialDrops(s, 16, 17, 13, 7, 2, { phase: 0.15, trail: true });
  radialDrops(s, 16, 17, 9, 5, 1, { phase: 0.8 });
}

function splash3(s) {
  // 잔물방울 — 흩어진 채 낙하 + 바닥 잔물
  droplet(s, 6, 12, 2, 220);
  droplet(s, 24, 9, 2, 220);
  droplet(s, 14, 6, 1, 210);
  droplet(s, 27, 18, 1, 200);
  droplet(s, 4, 20, 1, 200);
  droplet(s, 19, 13, 1, 190);
  // 낙하 모션 트레일 (방울 위쪽 잔상)
  s.px(7, 10, fade(LIGHT, 110));
  s.px(25, 7, fade(LIGHT, 110));
  s.px(14, 4, fade(LIGHT, 90));
  // 바닥에 남은 얇은 잔물
  s.hLine(11, 24, 4, fade(LIGHT, 170));
  s.px(10, 25, fade(W[2], 150));
  s.hLine(18, 25, 3, fade(W[2], 150));
  s.px(15, 26, fade(LIGHT, 120));
}

// ── pop: 버블 팝 (40x40, 중심 20,20) ───────────────────────
function pop0(s) {
  // 터지기 직전 — 가로로 일그러진 버블
  s.ellipse(20, 21, 15.5, 10.5, W[1]);
  s.ellipse(19, 20, 14.5, 9.8, W[2]);
  // 실루엣을 비집고 나오는 불룩 혹 (찌그러짐 표현)
  s.ellipse(14, 12.5, 4, 2.5, W[2]);
  s.ellipse(31, 14, 3, 2.5, W[2]);
  s.ellipse(8, 28, 2.5, 2, W[1]);
  // 아래 그림자 밴드
  s.ellipse(21, 26, 12, 5, W[1]);
  s.ellipse(22, 28, 8.5, 2.8, fade(DEEP, 220));
  // 좌상단 하이라이트
  s.ellipse(13, 15.5, 5.5, 4, LIGHT);
  s.fillRect(11, 13, 3, 2, FOAM);
  s.px(14, 14, FOAM);
  s.px(9, 16, FOAM);
  // 팽창 스트레스 글린트 (좌우 끝)
  s.px(5, 20, FOAM);
  s.px(35, 19, FOAM);
  s.outlineSilhouette(OUT);
}

function pop1(s) {
  // 파열 림 — 두꺼운 링 + 방사 물줄기
  waterRing(s, 20, 20, 14, 12, 3);
  burstSpikes(s, 20, 20, 14, 12, 3, 8, { phase: Math.PI / 8 });
  // 중앙 잔거품 (십자 글린트) + 안쪽 잔방울 둘
  s.px(20, 20, FOAM);
  s.px(19, 20, LIGHT);
  s.px(21, 20, LIGHT);
  s.px(20, 19, LIGHT);
  s.px(20, 21, fade(W[2], 200));
  droplet(s, 14, 15, 1);
  droplet(s, 25, 24, 1, 220);
}

function pop2(s) {
  // 물방울 비산 — 흐릿한 링 잔상 + 큰/작은 방울들
  waterRing(s, 20, 20, 16, 13.5, 1.4, { broken: true, a: 150 });
  radialDrops(s, 20, 20, 15, 6, 3, { phase: 0.3, trail: true });
  radialDrops(s, 20, 20, 17.5, 8, 2, { phase: 0.05 });
  radialDrops(s, 20, 20, 11, 5, 1, { phase: 0.9 });
}

function pop3(s) {
  // 잔흔 — 옅어진 잔방울과 글린트만 남음
  radialDrops(s, 20, 20, 18, 7, 1, { phase: 0.5, a: 180 });
  droplet(s, 8, 10, 2, 160);
  droplet(s, 30, 9, 2, 160);
  droplet(s, 32, 27, 2, 150);
  droplet(s, 7, 26, 1, 150);
  // 작은 거품 글린트 (십자)
  s.px(14, 31, fade(FOAM, 170));
  s.px(13, 31, fade(LIGHT, 120));
  s.px(15, 31, fade(LIGHT, 120));
  s.px(14, 30, fade(LIGHT, 120));
  s.px(14, 32, fade(LIGHT, 120));
  s.px(26, 6, fade(FOAM, 150));
  s.px(25, 6, fade(LIGHT, 100));
  s.px(27, 6, fade(LIGHT, 100));
  // 중앙 옅은 안개
  s.px(19, 19, fade(LIGHT, 90));
  s.px(22, 21, fade(LIGHT, 80));
}

// ── spark: 아이템 획득 반짝 (24x24, 중심 12,12) ────────────
function spark0(s) {
  star4(s, 12, 12, 2);
  s.px(7, 8, fade(PAL.yellow, 220));
  s.px(17, 15, fade(PAL.yellow, 220));
}

function spark1(s) {
  star4(s, 12, 12, 5, { diag: 2 });
  // 주변 위성 점들
  s.px(5, 6, PAL.white);
  s.px(4, 6, fade(PAL.yellow, 220));
  s.px(19, 5, fade(PAL.yellow, 230));
  s.px(20, 16, PAL.white);
  s.px(20, 17, fade(PAL.yellow, 220));
  s.px(6, 18, fade(PAL.yellow, 230));
  s.px(13, 3, fade(Y[3], 200));
  s.px(11, 21, fade(Y[3], 200));
}

function spark2(s) {
  // 소멸 — 속이 빈 다이아 + 흩어지는 점
  s.px(12, 8, fade(PAL.yellow, 210));
  s.px(8, 12, fade(PAL.yellow, 210));
  s.px(16, 12, fade(PAL.yellow, 210));
  s.px(12, 16, fade(PAL.yellow, 210));
  s.px(12, 12, fade(PAL.white, 150));
  // 바깥으로 밀려난 잔점
  s.px(4, 4, fade(PAL.yellow, 170));
  s.px(20, 3, fade(Y[3], 160));
  s.px(21, 18, fade(PAL.yellow, 170));
  s.px(3, 19, fade(Y[3], 150));
  s.px(17, 21, fade(PAL.yellow, 140));
}

// ── shadow: 발밑 그림자 (24x10) ────────────────────────────
function shadow(s) {
  // 부드러운 가장자리의 검은 타원 (코어 알파 70)
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 24; x++) {
      const nx = (x - 11.5) / 10.8;
      const ny = (y - 4.5) / 3.9;
      const d = nx * nx + ny * ny;
      if (d <= 0.72) s.px(x, y, [0, 0, 0, 70]);
      else if (d <= 1.05) s.px(x, y, [0, 0, 0, 38]);
    }
}

// ── favicon: 웃는 물풍선 얼굴 (32x32) ──────────────────────
function favicon(s) {
  // 몸통 (좌상단 광원 셰이딩)
  s.disc(16, 17, 12.4, W[1]);
  s.disc(15, 16, 11.4, W[2]);
  s.ellipse(12.5, 13.5, 5.5, 4.5, LIGHT);
  s.fillRect(10, 10, 3, 2, FOAM);
  s.px(13, 11, FOAM);
  s.px(9, 12, FOAM);
  // 우하단 깊은 림
  for (let y = 5; y <= 30; y++)
    for (let x = 3; x <= 29; x++) {
      const dx = x - 16;
      const dy = y - 17;
      const d = Math.hypot(dx, dy);
      if (d <= 12.4 && d >= 10.6 && dx + dy * 1.4 > 6) s.px(x, y, fade(DEEP, 210));
    }
  // 꼭지 매듭
  s.fillRect(15, 1, 2, 1, W[2]);
  s.fillRect(14, 2, 4, 2, W[2]);
  s.fillRect(15, 4, 2, 1, W[1]);
  s.px(14, 2, LIGHT);
  s.px(15, 1, LIGHT);
  s.px(17, 3, W[1]);
  // 눈 (세로 둥근 눈 + 글린트)
  s.fillRect(11, 12, 2, 4, OUT);
  s.fillRect(19, 12, 2, 4, OUT);
  s.px(11, 12, PAL.outlineSoft);
  s.px(19, 12, PAL.outlineSoft);
  s.px(11, 13, PAL.white);
  s.px(19, 13, PAL.white);
  // 입 (활짝 웃는 열린 입 — 테두리 OUT, 안쪽 어두운 붉은색 + 혀)
  const mouthDark = shade(PAL.red, -0.55);
  s.fillRect(12, 18, 9, 2, OUT);
  s.fillRect(13, 20, 7, 1, OUT);
  s.fillRect(14, 21, 5, 1, OUT);
  s.fillRect(15, 22, 3, 1, OUT);
  s.fillRect(13, 19, 7, 1, mouthDark);
  s.fillRect(14, 20, 5, 1, mouthDark);
  s.fillRect(15, 21, 3, 1, PAL.red);
  // 볼터치
  s.fillRect(8, 16, 2, 1, fade(PAL.pink, 210));
  s.fillRect(22, 16, 2, 1, fade(PAL.pink, 210));
  s.outlineSilhouette(OUT);
}

export default {
  name: "effects",
  sprites: [
    { name: "splash_0", w: 32, h: 32, draw: splash0 },
    { name: "splash_1", w: 32, h: 32, draw: splash1 },
    { name: "splash_2", w: 32, h: 32, draw: splash2 },
    { name: "splash_3", w: 32, h: 32, draw: splash3 },
    { name: "pop_0", w: 40, h: 40, draw: pop0 },
    { name: "pop_1", w: 40, h: 40, draw: pop1 },
    { name: "pop_2", w: 40, h: 40, draw: pop2 },
    { name: "pop_3", w: 40, h: 40, draw: pop3 },
    { name: "spark_0", w: 24, h: 24, draw: spark0 },
    { name: "spark_1", w: 24, h: 24, draw: spark1 },
    { name: "spark_2", w: 24, h: 24, draw: spark2 },
    { name: "shadow", w: 24, h: 10, draw: shadow },
    { name: "favicon", w: 32, h: 32, draw: favicon },
  ],
};
