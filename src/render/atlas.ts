// 절차 생성된 스프라이트시트(PNG + JSON 메타) 로더.

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Atlas {
  constructor(
    readonly image: HTMLImageElement,
    readonly frames: Record<string, Frame>
  ) {}

  frame(name: string): Frame {
    const f = this.frames[name];
    if (!f) throw new Error(`스프라이트 프레임 없음: ${name}`);
    return f;
  }

  has(name: string): boolean {
    return name in this.frames;
  }
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    img.src = src;
  });
}

export async function loadAtlas(name: string): Promise<Atlas> {
  const base = `${import.meta.env.BASE_URL}assets/generated`;
  const [image, meta] = await Promise.all([
    loadImage(`${base}/${name}.png`),
    fetch(`${base}/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`아틀라스 메타 로드 실패: ${name}`);
      return r.json() as Promise<{ frames: Record<string, Frame> }>;
    }),
  ]);
  return new Atlas(image, meta.frames);
}

export interface Atlases {
  characters: Atlas;
  tiles: Atlas;
  balloons: Atlas;
  items: Atlas;
  effects: Atlas;
}

export async function loadAllAtlases(): Promise<Atlases> {
  const [characters, tiles, balloons, items, effects] = await Promise.all([
    loadAtlas("characters"),
    loadAtlas("tiles"),
    loadAtlas("balloons"),
    loadAtlas("items"),
    loadAtlas("effects"),
  ]);
  return { characters, tiles, balloons, items, effects };
}
