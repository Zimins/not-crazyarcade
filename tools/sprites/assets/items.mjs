// items — 바닥 아이템 아이콘 5종 (24x24).
// 공통: 둥근 흰색 카드(알파 230) + 카드 드롭섀도 + 아이콘 발밑 타원 그림자.
// 광원 좌상단 고정: 하이라이트는 좌상, 음영은 우하.
import { PAL, ramp, parseColor, Sprite } from "../lib.mjs";

const O = PAL.outline;

function withAlpha(c, a) {
  const [r, g, b] = parseColor(c);
  return [r, g, b, a];
}

// ── 공통 헬퍼 ──────────────────────────────────────────────
// 모서리가 둥근 사각형 (상하단 2,1 인셋)
function roundShape(s, x, y, w, h, color) {
  const ins = [2, 1];
  for (let row = 0; row < h; row++) {
    const a = row < ins.length ? ins[row] : 0;
    const b = h - 1 - row < ins.length ? ins[h - 1 - row] : 0;
    const inset = Math.max(a, b);
    s.hLine(x + inset, y + row, w - inset * 2, color);
  }
}

// 카드 배경: 우하단 드롭섀도 + 흰 카드
function card(s) {
  roundShape(s, 2, 2, 22, 22, [20, 16, 40, 70]);
  roundShape(s, 1, 0, 22, 22, [255, 255, 255, 230]);
}

// 아이콘 발밑 그림자 (카드 위, 아이콘보다 먼저)
function groundShadow(s, cx, rx) {
  s.hLine(cx - rx, 19, rx * 2 + 1, [28, 24, 50, 55]);
  s.hLine(cx - rx + 2, 20, rx * 2 - 3, [28, 24, 50, 28]);
}

// 외곽선 있는 + 기호
function plusSign(s, cx, cy, arm, color, oc) {
  for (const [ox, oy] of [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ]) {
    s.hLine(cx - arm + ox, cy + oy, arm * 2 + 1, oc);
    s.vLine(cx + ox, cy - arm + oy, arm * 2 + 1, oc);
  }
  s.hLine(cx - arm, cy, arm * 2 + 1, color);
  s.vLine(cx, cy - arm, arm * 2 + 1, color);
}

// 반짝 십자 (외곽선 없음, 대각 글로우 픽셀)
function sparkle(s, cx, cy, arm, color, core) {
  s.vLine(cx, cy - arm, arm * 2 + 1, color);
  s.hLine(cx - arm, cy, arm * 2 + 1, color);
  s.px(cx, cy, core);
  for (const [ox, oy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
    s.px(cx + ox, cy + oy, withAlpha(color, 110));
}

// 실루엣 주변 글로우 링 (threshold 이상 알파에 인접한 빈 픽셀 칠하기)
function glowRing(t, color, threshold) {
  const mask = [];
  for (let y = 0; y < t.h; y++)
    for (let x = 0; x < t.w; x++) {
      if (t.get(x, y)[3] > 0) continue;
      if (
        t.get(x + 1, y)[3] >= threshold ||
        t.get(x - 1, y)[3] >= threshold ||
        t.get(x, y + 1)[3] >= threshold ||
        t.get(x, y - 1)[3] >= threshold
      )
        mask.push([x, y]);
    }
  for (const [x, y] of mask) t.px(x, y, color);
}

// ── 물약병 (range / maxrange 공유) ─────────────────────────
function bottle(frame, { liquid, glassTint, surface, hiLight, glow }) {
  const t = new Sprite(24, 24);
  const LQ = ramp(liquid);
  // 코르크 마개
  t.fillRect(10, 2, 4, 3, PAL.wood);
  t.hLine(10, 2, 4, PAL.woodLight);
  t.hLine(10, 4, 4, PAL.woodDark);
  t.px(10, 3, PAL.woodLight);
  // 유리 실루엣 행 테이블 [y, x, w]
  const rows = [
    [5, 9, 6],                                  // 입구 림
    [6, 10, 4], [7, 10, 4],                     // 목
    [8, 8, 8], [9, 7, 10],                      // 어깨
    [10, 6, 12],
    [11, 5, 14], [12, 5, 14], [13, 5, 14], [14, 5, 14], [15, 5, 14],
    [16, 6, 12], [17, 7, 10],                   // 바닥
  ];
  const liquidTop = 10;
  for (const [y, x, w] of rows)
    for (let xx = x; xx < x + w; xx++) {
      let c;
      if (y < liquidTop) c = glassTint;
      else if (y === liquidTop) c = surface;
      else {
        c = LQ[2];
        if (xx >= x + w - 2 || y >= 16) c = LQ[1];
        if ((xx >= x + w - 1 && y >= 12) || y === 17) c = LQ[0];
      }
      t.px(xx, y, c);
    }
  // 좌측 유리 반사광 (광원 좌상단)
  t.vLine(7, 11, 4, hiLight);
  t.px(8, 11, hiLight);
  t.px(10, 6, "#ffffff");
  // 기포
  t.px(12, 13, hiLight);
  t.px(10, 15, hiLight);
  t.outlineSilhouette(O);
  if (glow) {
    glowRing(t, withAlpha(glow, 200), 200);
    glowRing(t, withAlpha(glow, 80), 150);
  }
  frame.blit(t, 0, 0);
}

// ── 각 아이콘 ──────────────────────────────────────────────
function drawBalloon(s) {
  card(s);
  groundShadow(s, 10, 6);
  const t = new Sprite(24, 24);
  const R = ramp(PAL.water);
  const cx = 10, cy = 12, r = 5;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r + r * 0.5) continue;
      let c = R[2];
      if (d2 >= (r - 1.7) ** 2 && dx + dy >= 2) c = R[1];
      if (d2 >= (r - 1.2) ** 2 && dx + dy >= 4) c = PAL.waterDeep;
      t.px(cx + dx, cy + dy, c);
    }
  // 꼭지 매듭 + 조임선
  t.fillRect(9, 5, 3, 2, R[2]);
  t.px(9, 5, R[3]);
  t.px(11, 5, R[1]);
  t.px(11, 6, R[1]);
  t.hLine(9, 7, 3, R[1]);
  // 좌상단 하이라이트
  t.disc(8, 10, 1.6, PAL.waterLight);
  t.px(8, 10, PAL.foam);
  t.px(7, 10, PAL.foam);
  t.outlineSilhouette(O);
  s.blit(t, 0, 0);
  // 우상단 + 기호
  plusSign(s, 18, 5, 2, PAL.yellow, O);
  s.px(18, 7, PAL.orange);
  s.px(20, 5, PAL.orange);
}

function drawRange(s) {
  card(s);
  groundShadow(s, 11, 7);
  bottle(s, {
    liquid: PAL.water,
    glassTint: "#dcf3fb",
    surface: PAL.waterLight,
    hiLight: PAL.foam,
    glow: null,
  });
}

function drawSpeed(s) {
  card(s);
  groundShadow(s, 12, 8);
  const t = new Sprite(24, 24);
  const R = ramp(PAL.red);
  // 하이탑 운동화 실루엣 [y, x, w] — 왼쪽 발목 칼라가 높고 오른쪽으로 토 박스
  const rows = [
    [7, 7, 4],
    [8, 7, 5],
    [9, 7, 5],
    [10, 7, 6],
    [11, 7, 7],
    [12, 7, 9],
    [13, 7, 11],
    [14, 6, 13],
    [15, 6, 13],
  ];
  for (const [y, x, w] of rows) t.hLine(x, y, w, R[2]);
  // 발목 칼라: 상단 하이라이트 + 개구부 어둡게
  t.hLine(7, 7, 4, R[3]);
  t.hLine(8, 8, 3, PAL.outlineSoft);
  // 뒤꿈치/하단 음영 (광원 좌상 → 음영 우하)
  t.vLine(7, 12, 4, R[1]);
  t.px(8, 14, R[1]);
  t.px(8, 15, R[1]);
  t.hLine(9, 15, 10, R[1]);
  // 흰 토캡 (앞코)
  t.hLine(15, 13, 3, "#f2f4ff");
  t.hLine(15, 14, 4, "#f2f4ff");
  t.hLine(15, 15, 4, PAL.stoneLight);
  // 신발끈 (사선 스트랩 2줄, 평행하게)
  t.px(11, 11, PAL.white);
  t.px(12, 12, PAL.white);
  t.px(13, 11, PAL.white);
  t.px(14, 12, PAL.white);
  // 밑창 (두툼하게)
  t.hLine(5, 16, 15, "#f4f6ff");
  t.hLine(5, 17, 15, PAL.stoneLight);
  t.px(19, 16, "#f4f6ff");
  t.outlineSilhouette(O);
  s.blit(t, 0, 0);
  // 스피드 라인 2개 (외곽선 없이 카드 위에)
  s.hLine(2, 10, 4, PAL.steelDark);
  s.hLine(1, 13, 5, PAL.steelDark);
}

function drawNeedle(s) {
  card(s);
  groundShadow(s, 10, 7);
  const t = new Sprite(24, 24);
  // 대각선 바늘: (5,17) → (18,4). 뭉툭한 귀쪽 → 길게 테이퍼되는 뾰족한 끝
  for (let i = 0; i <= 13; i++) {
    const x = 5 + i;
    const y = 17 - i;
    t.px(x, y, i >= 12 ? "#eef2ff" : PAL.stoneLight); // 끝 2px 밝은 포인트
    if (i < 9) t.px(x + 1, y, PAL.steel); // i>=9부터 1px 테이퍼
  }
  // 귀쪽 뭉툭한 끝 (살짝 둥글고 두껍게)
  t.px(4, 18, PAL.stoneLight);
  t.px(5, 18, PAL.steel);
  t.px(6, 18, PAL.steelDark);
  t.px(5, 16, PAL.stoneLight);
  t.px(6, 15, PAL.stoneLight);
  // 바늘귀: 축 방향 길쭉한 구멍 2px
  t.px(6, 16, O);
  t.px(7, 15, O);
  t.outlineSilhouette(O);
  s.blit(t, 0, 0);
  // 반짝 십자 1개 — 끝(완드처럼 보임)이 아니라 좌상단 여백에
  sparkle(s, 7, 6, 2, PAL.yellow, "#fffbe8");
}

function drawMaxRange(s) {
  card(s);
  groundShadow(s, 11, 7);
  bottle(s, {
    liquid: "#ffc324",
    glassTint: "#fdeccc",
    surface: "#ffe98a",
    hiLight: "#fff7d6",
    glow: "#ffd848",
  });
  // 레어템 반짝이
  sparkle(s, 15, 12, 1, "#fff7d6", PAL.white);
  s.px(9, 8, "#fff7d6");
  s.px(4, 4, withAlpha(PAL.yellow, 200));
  s.px(20, 16, withAlpha(PAL.yellow, 200));
}

export default {
  name: "items",
  sprites: [
    { name: "item_balloon", w: 24, h: 24, draw: drawBalloon },
    { name: "item_range", w: 24, h: 24, draw: drawRange },
    { name: "item_speed", w: 24, h: 24, draw: drawSpeed },
    { name: "item_needle", w: 24, h: 24, draw: drawNeedle },
    { name: "item_maxrange", w: 24, h: 24, draw: drawMaxRange },
  ],
};
