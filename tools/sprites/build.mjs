// 스프라이트시트 빌더: 각 에셋 모듈을 실행해 PNG 아틀라스 + JSON 메타를 출력한다.
//
// 에셋 모듈 인터페이스 (tools/sprites/assets/*.mjs):
//   export default {
//     name: "characters",            // 출력 파일명
//     sprites: [
//       { name: "char0_down_0", w: 32, h: 40, draw(s /* Sprite */) { ... } },
//     ],
//   }
//
// 출력: public/assets/generated/<name>.png + <name>.json
//   JSON: { frames: { "<sprite-name>": { x, y, w, h } }, meta: { w, h } }

import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Sprite, encodePng } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, "assets");
const outDir = resolve(here, "../../public/assets/generated");
mkdirSync(outDir, { recursive: true });

const PADDING = 1; // 프레임 간 여백 (텍스처 블리딩 방지)
const SHEET_MAX_W = 1024;

function packSheet(sprites) {
  // shelf packing: 높이 내림차순 정렬 후 행 단위 배치
  const order = [...sprites].sort((a, b) => b.h - a.h || b.w - a.w);
  let x = PADDING;
  let y = PADDING;
  let rowH = 0;
  let sheetW = 0;
  const places = new Map();
  for (const sp of order) {
    if (x + sp.w + PADDING > SHEET_MAX_W) {
      x = PADDING;
      y += rowH + PADDING;
      rowH = 0;
    }
    places.set(sp.name, { x, y, w: sp.w, h: sp.h });
    x += sp.w + PADDING;
    rowH = Math.max(rowH, sp.h);
    sheetW = Math.max(sheetW, x);
  }
  return { places, sheetW, sheetH: y + rowH + PADDING };
}

async function buildModule(file) {
  const mod = (await import(join(assetsDir, file))).default;
  const { places, sheetW, sheetH } = packSheet(mod.sprites);
  const sheet = new Sprite(sheetW, sheetH);
  const frames = {};
  for (const sp of mod.sprites) {
    const place = places.get(sp.name);
    const s = new Sprite(sp.w, sp.h);
    sp.draw(s);
    sheet.blit(s, place.x, place.y);
    frames[sp.name] = place;
    // favicon 프레임은 단독 PNG로도 추출 (index.html에서 직접 참조)
    if (sp.name === "favicon") {
      writeFileSync(join(outDir, "favicon.png"), encodePng(sp.w, sp.h, s.data));
    }
  }
  writeFileSync(join(outDir, `${mod.name}.png`), encodePng(sheetW, sheetH, sheet.data));
  writeFileSync(
    join(outDir, `${mod.name}.json`),
    JSON.stringify({ frames, meta: { w: sheetW, h: sheetH } })
  );

  // 4배 확대 프리뷰 (체커보드 배경 위) — 시각 검수용, 게임에선 미사용
  const SCALE = 4;
  const prev = new Sprite(sheetW * SCALE, sheetH * SCALE);
  for (let y = 0; y < sheetH * SCALE; y++)
    for (let x = 0; x < sheetW * SCALE; x++)
      prev.px(x, y, (((x / 8) | 0) + ((y / 8) | 0)) % 2 === 0 ? "#cccccc" : "#999999");
  for (let y = 0; y < sheetH; y++)
    for (let x = 0; x < sheetW; x++) {
      const [r, g, b, a] = sheet.get(x, y);
      if (a === 0) continue;
      for (let dy = 0; dy < SCALE; dy++)
        for (let dx = 0; dx < SCALE; dx++)
          prev.px(x * SCALE + dx, y * SCALE + dy, [r, g, b, a]);
    }
  writeFileSync(
    join(outDir, `${mod.name}@preview.png`),
    encodePng(sheetW * SCALE, sheetH * SCALE, prev.data)
  );
  console.log(`✓ ${mod.name}: ${mod.sprites.length} frames → ${sheetW}x${sheetH}`);
}

// --only <이름> : 특정 모듈만 빌드 (병렬 에셋 작업 시 격리용)
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

let files = readdirSync(assetsDir).filter((f) => f.endsWith(".mjs"));
if (only) files = files.filter((f) => f === `${only}.mjs`);
if (files.length === 0) {
  console.error("assets/ 에 해당하는 에셋 모듈이 없습니다");
  process.exit(1);
}
let failed = false;
for (const f of files.sort()) {
  try {
    await buildModule(f);
  } catch (err) {
    failed = true;
    console.error(`✗ ${f}: ${err.message}`);
  }
}
console.log(`완료 → ${outDir}`);
if (failed) process.exit(1);
