// Canvas 2D 렌더러 — 픽셀아트 정수 스케일, 스냅샷 기반 그리기.

import type { Atlases } from "./atlas";
import {
  Ev,
  Phase,
  PlayerState,
  type GameEvent,
  type Snapshot,
} from "../game/snapshot";

export const TILE = 32;
export const MAP_W = 15;
export const MAP_H = 13;
export const BOARD_W = MAP_W * TILE; // 480
export const BOARD_H = MAP_H * TILE; // 416

const THEMES = ["forest", "factory", "ice"] as const;

const STREAM_PART_NAMES = [
  "stream_center",
  "stream_h",
  "stream_v",
  "stream_end_l",
  "stream_end_r",
  "stream_end_u",
  "stream_end_d",
] as const;

const ITEM_NAMES = ["item_balloon", "item_range", "item_speed", "item_needle", "item_maxrange"] as const;

const DIR_NAMES = ["down", "up", "left", "right"] as const;

/** 이벤트로 생성되는 일회성 시각 이펙트 */
interface FxInstance {
  kind: "splash" | "pop" | "spark";
  x: number;
  y: number;
  t: number; // 경과 초
}

const FX_DURATION: Record<FxInstance["kind"], number> = {
  splash: 0.4,
  pop: 0.4,
  spark: 0.35,
};

/** 사망 연출 추적 (스냅샷의 Dead 상태는 영구라 직후 애니메이션용 타이머가 필요) */
interface DeathAnim {
  t: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private fx: FxInstance[] = [];
  private deathAnims = new Map<number, DeathAnim>();
  private time = 0;
  private onResize = () => this.applyScale();

  constructor(
    private canvas: HTMLCanvasElement,
    private atlases: Atlases
  ) {
    canvas.width = BOARD_W;
    canvas.height = BOARD_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D 컨텍스트 생성 실패");
    this.ctx = ctx;
    this.applyScale();
    window.addEventListener("resize", this.onResize);
  }

  /** 매치 종료 시 호출 — resize 리스너 누적 방지 */
  dispose(): void {
    window.removeEventListener("resize", this.onResize);
  }

  /** CSS 배율 스케일 — 물리 픽셀 정수 정렬 (devicePixelRatio 단위) */
  private applyScale(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const availW = parent.clientWidth || window.innerWidth;
    const availH = parent.clientHeight || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    // 확대(>=1)는 물리 픽셀 정수 배율로 크리스프하게,
    // 축소(<1, 모바일 가로 등)는 화면에 꽉 차도록 비정수 허용
    const raw = Math.min(availW / BOARD_W, availH / BOARD_H);
    const scale = raw >= 1 ? Math.max(1, Math.floor(raw * dpr) / dpr) : raw;
    this.canvas.style.width = `${BOARD_W * scale}px`;
    this.canvas.style.height = `${BOARD_H * scale}px`;
    // 컨텍스트 상태는 width 대입 시 리셋되므로 매번 재설정
    this.ctx.imageSmoothingEnabled = false;
  }

  /** 이벤트 → 이펙트 인스턴스 생성 (사운드는 호출자 몫) */
  spawnEffects(events: GameEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case Ev.BlockBreak:
          this.fx.push({ kind: "splash", x: e.x, y: e.y, t: 0 });
          break;
        case Ev.PopDeath:
        case Ev.TimeoutDeath:
          this.fx.push({ kind: "pop", x: e.x, y: e.y, t: 0 });
          this.deathAnims.set(e.data, { t: 0 });
          break;
        case Ev.Pickup:
        case Ev.Rescue:
        case Ev.NeedleEscape:
          this.fx.push({ kind: "spark", x: e.x, y: e.y, t: 0 });
          break;
        case Ev.Explode:
          // 폭발 자체는 stream 셀로 그려짐
          break;
        default:
          break;
      }
    }
  }

  render(snap: Snapshot, dt: number): void {
    this.time += dt;
    const { ctx } = this;
    ctx.imageSmoothingEnabled = false;
    const theme = THEMES[snap.mapId % THEMES.length];

    this.drawFloor(theme);
    this.drawItems(snap);
    this.drawBalloons(snap);
    this.drawStreams(snap);
    this.drawBlocks(snap, theme);
    this.drawPlayers(snap, dt);
    this.drawFx(dt);

    if (snap.phase === Phase.Countdown) {
      ctx.fillStyle = "rgba(12, 10, 30, 0.45)";
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    }
  }

  private blit(atlasName: keyof Atlases, frame: string, dx: number, dy: number): void {
    const atlas = this.atlases[atlasName];
    const f = atlas.frame(frame);
    this.ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, Math.floor(dx), Math.floor(dy), f.w, f.h);
  }

  private drawFloor(theme: string): void {
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        // 결정적 변형 선택 (체커 + 약간의 해시 변형)
        const v = (x * 7 + y * 13) % 5 === 0 ? 1 : 0;
        this.blit("tiles", `${theme}_floor_${v}`, x * TILE, y * TILE);
      }
  }

  private drawBlocks(snap: Snapshot, theme: string): void {
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        const t = snap.tiles[y * MAP_W + x];
        if (t === 1) this.blit("tiles", `${theme}_soft`, x * TILE, y * TILE);
        else if (t === 2) this.blit("tiles", `${theme}_hard`, x * TILE, y * TILE);
      }
  }

  private drawItems(snap: Snapshot): void {
    for (const it of snap.items) {
      const bob = Math.sin(this.time * 4 + it.x * 7 + it.y * 3) * 2;
      const name = ITEM_NAMES[it.kind] ?? ITEM_NAMES[0];
      this.blit("items", name, it.x * TILE - 12, it.y * TILE - 12 + bob);
    }
  }

  private drawBalloons(snap: Snapshot): void {
    for (const b of snap.balloons) {
      let frame: string;
      if (b.fuse01 < 0.18) {
        // 터지기 직전 점멸
        frame = Math.floor(this.time * 12) % 2 === 0 ? "balloon_flash" : "balloon_2";
      } else {
        frame = `balloon_${Math.floor(this.time * 5) % 3}`;
      }
      this.blit("balloons", frame, b.x * TILE - 16, b.y * TILE - 16);
    }
  }

  private drawStreams(snap: Snapshot): void {
    for (const s of snap.streams) {
      const fi = Math.min(3, Math.floor(s.age01 * 4));
      const name = `${STREAM_PART_NAMES[s.part] ?? "stream_center"}_${fi}`;
      this.blit("balloons", name, s.x * TILE - 16, s.y * TILE - 16);
    }
  }

  private drawPlayers(snap: Snapshot, dt: number): void {
    // y 정렬로 겹침 자연스럽게
    const sorted = [...snap.players].sort((a, b) => a.y - b.y);
    for (const p of sorted) {
      const px = p.x * TILE;
      const py = p.y * TILE;
      const charBase = `char${p.charType}`;

      if (p.state === PlayerState.Dead) {
        const anim = this.deathAnims.get(p.id);
        if (anim) {
          anim.t += dt;
          if (anim.t < 1.2) {
            const fi = Math.floor(anim.t * 4) % 2;
            this.ctx.globalAlpha = Math.max(0, 1 - anim.t / 1.2);
            this.blit("characters", `${charBase}_dead_${fi}`, px - 16, py - 28);
            this.ctx.globalAlpha = 1;
          }
        }
        continue;
      }

      // 그림자
      this.blit("effects", "shadow", px - 12, py + 4);

      if (p.state === PlayerState.Trapped) {
        const fi = Math.floor(this.time * 5) % 2;
        this.blit("characters", `${charBase}_trapped_${fi}`, px - 16, py - 28);
        // 버블: 시간이 갈수록 불투명 (원작 연출)
        const opaque01 = Math.min(1, Math.max(0, 1 - p.stateTimer / 5.0));
        const bi = Math.floor(this.time * 4) % 3;
        this.ctx.globalAlpha = 0.55 + 0.45 * opaque01;
        this.blit("balloons", `bubble_${bi}`, px - 20, py - 26);
        this.ctx.globalAlpha = 1;
        continue;
      }

      // 승리 포즈 (라운드 종료 시 생존자)
      if (snap.phase === Phase.RoundOver && snap.winnerTeam === p.team) {
        const fi = Math.floor(this.time * 4) % 2;
        this.blit("characters", `${charBase}_win_${fi}`, px - 16, py - 28);
        continue;
      }

      const dir = DIR_NAMES[p.dir] ?? "down";
      const fi = p.moving ? Math.floor(this.time * 9) % 4 : 0;
      this.blit("characters", `${charBase}_${dir}_${fi}`, px - 16, py - 28);
    }
  }

  private drawFx(dt: number): void {
    this.fx = this.fx.filter((f) => {
      f.t += dt;
      const dur = FX_DURATION[f.kind];
      if (f.t >= dur) return false;
      const frames = f.kind === "spark" ? 3 : 4;
      const fi = Math.min(frames - 1, Math.floor((f.t / dur) * frames));
      const name = `${f.kind}_${fi}`;
      if (this.atlases.effects.has(name)) {
        const fr = this.atlases.effects.frame(name);
        this.blit("effects", name, f.x * TILE - fr.w / 2, f.y * TILE - fr.h / 2);
      }
      return true;
    });
  }

  reset(): void {
    this.fx = [];
    this.deathAnims.clear();
    this.time = 0;
  }
}
