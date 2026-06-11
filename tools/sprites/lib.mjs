// 픽셀아트 생성 공통 라이브러리 — 의존성 없는 PNG 인코더 + 스프라이트 캔버스.
// 모든 에셋 모듈은 이 파일의 Sprite/팔레트 헬퍼만 사용해 그린다.

import { deflateSync } from "node:zlib";

// ── PNG 인코딩 (RGBA 8bit) ─────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── 색상 유틸 ──────────────────────────────────────────────
export function parseColor(c) {
  if (Array.isArray(c)) return c;
  const s = c.replace("#", "");
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const a = s.length >= 8 ? parseInt(s.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

function clamp8(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/// 밝기 조절: amt -1.0(검정)~+1.0(흰색). 픽셀아트 셰이딩용 — 색조를 살짝 회전시켜
/// 단순 명도 변화보다 생동감 있는 램프를 만든다 (어두울수록 푸르게, 밝을수록 노랗게).
export function shade(color, amt) {
  const [r, g, b, a] = parseColor(color);
  if (amt >= 0) {
    const warm = amt * 24;
    return [
      clamp8(r + (255 - r) * amt + warm),
      clamp8(g + (255 - g) * amt + warm * 0.6),
      clamp8(b + (255 - b) * amt),
      a,
    ];
  }
  const k = 1 + amt;
  const cool = -amt * 18;
  return [
    clamp8(r * k),
    clamp8(g * k + cool * 0.3),
    clamp8(b * k + cool),
    a,
  ];
}

/// 4단 셰이딩 램프 [진한 그림자, 그림자, 기본, 하이라이트]
export function ramp(base) {
  return [shade(base, -0.45), shade(base, -0.22), parseColor(base), shade(base, 0.3)];
}

// ── 게임 전역 베이스 팔레트 ────────────────────────────────
export const PAL = {
  // 물 계열
  waterDeep: "#1a6fc4",
  water: "#2e9df0",
  waterLight: "#7fd4ff",
  foam: "#eafcff",
  // 아웃라인 (순수 검정 대신 따뜻한 다크네이비 — 픽셀아트 정석)
  outline: "#1c1832",
  outlineSoft: "#3a3354",
  // 자연
  grass: "#5cba47",
  grassDark: "#3a8f3d",
  leaf: "#7ed957",
  wood: "#a4682f",
  woodDark: "#6e4218",
  woodLight: "#d29b58",
  stone: "#9398ab",
  stoneDark: "#5d617a",
  stoneLight: "#c6cbe0",
  // 금속/공장
  steel: "#8b95a8",
  steelDark: "#525c73",
  rust: "#b35c33",
  // 얼음
  ice: "#a8e6f5",
  iceDark: "#5fb6dd",
  iceLight: "#e2f9ff",
  // 포인트 컬러
  red: "#e84855",
  orange: "#f2933a",
  yellow: "#ffd23f",
  pink: "#ff7eb3",
  purple: "#9b5fe0",
  skin: "#ffd9b0",
  skinShade: "#e8a877",
  white: "#ffffff",
};

// ── 스프라이트 캔버스 ──────────────────────────────────────
export class Sprite {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4); // 투명 초기화
  }

  px(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b, a] = parseColor(color);
    const i = (y * this.w + x) * 4;
    if (a === 255) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = 255;
    } else if (a > 0) {
      // 단순 알파 블렌딩
      const da = this.data[i + 3] / 255;
      const sa = a / 255;
      const oa = sa + da * (1 - sa);
      if (oa === 0) return;
      this.data[i] = clamp8((r * sa + this.data[i] * da * (1 - sa)) / oa);
      this.data[i + 1] = clamp8((g * sa + this.data[i + 1] * da * (1 - sa)) / oa);
      this.data[i + 2] = clamp8((b * sa + this.data[i + 2] * da * (1 - sa)) / oa);
      this.data[i + 3] = clamp8(oa * 255);
    }
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  fillRect(x, y, w, h, color) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) this.px(xx, yy, color);
  }

  hLine(x, y, len, color) {
    this.fillRect(x, y, len, 1, color);
  }

  vLine(x, y, len, color) {
    this.fillRect(x, y, 1, len, color);
  }

  outlineRect(x, y, w, h, color) {
    this.hLine(x, y, w, color);
    this.hLine(x, y + h - 1, w, color);
    this.vLine(x, y, h, color);
    this.vLine(x + w - 1, y, h, color);
  }

  /// 채워진 원 (cx,cy 중심, 반지름 r — 픽셀아트용 정수 라스터)
  disc(cx, cy, r, color) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r + r * 0.5) this.px(x, y, color);
      }
  }

  /// 원 외곽선
  circle(cx, cy, r, color) {
    for (let y = Math.floor(cy - r) - 1; y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 <= r * r + r * 0.5 && d2 >= (r - 1) * (r - 1) + (r - 1) * 0.5)
          this.px(x, y, color);
      }
  }

  /// 타원 (rx, ry 반지름)
  ellipse(cx, cy, rx, ry, color) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1.08) this.px(x, y, color);
      }
  }

  /// 다른 스프라이트 합성 (dx, dy 위치에, 옵션: 좌우반전)
  blit(src, dx, dy, { flipX = false } = {}) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const sx = flipX ? src.w - 1 - x : x;
        const [r, g, b, a] = src.get(sx, y);
        if (a > 0) this.px(dx + x, dy + y, [r, g, b, a]);
      }
  }

  /// 불투명 픽셀 외곽에 1px 아웃라인 (캐릭터 마감용)
  outlineSilhouette(color) {
    const mask = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)[3] > 0) continue;
        const touching =
          this.get(x + 1, y)[3] > 200 ||
          this.get(x - 1, y)[3] > 200 ||
          this.get(x, y + 1)[3] > 200 ||
          this.get(x, y - 1)[3] > 200;
        if (touching) mask.push([x, y]);
      }
    for (const [x, y] of mask) this.px(x, y, color);
  }

  /// 체커보드 디더링 채움 (두 색 교차)
  dither(x, y, w, h, colorA, colorB) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++)
        this.px(xx, yy, (xx + yy) % 2 === 0 ? colorA : colorB);
  }
}

// ── 결정적 RNG (에셋 노이즈용 — 빌드마다 동일 출력) ───────
export function makeRng(seed) {
  let s = seed >>> 0 || 0x12345678;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}
