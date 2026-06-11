// WASM 스냅샷 버퍼 파서. 레이아웃은 core/src/game.rs 의 build_snapshot 과 1:1.

export const HEADER_LEN = 16;
export const PLAYER_STRIDE = 16;
export const BALLOON_STRIDE = 6;
export const STREAM_STRIDE = 4;
export const ITEM_STRIDE = 4;
export const EVENT_STRIDE = 4;

export const enum Phase {
  Countdown = 0,
  Playing = 1,
  RoundOver = 2,
}

export const enum PlayerState {
  Normal = 0,
  Trapped = 1,
  Dead = 2,
}

// core/src/game.rs 이벤트 코드
export const enum Ev {
  Place = 1,
  Explode = 2,
  BlockBreak = 3,
  Pickup = 4,
  Trapped = 5,
  Rescue = 6,
  PopDeath = 7,
  TimeoutDeath = 8,
  RoundStart = 9,
  RoundEnd = 10,
  NeedleEscape = 11,
  ItemDestroyed = 12,
}

export interface PlayerView {
  id: number;
  charType: number;
  team: number;
  x: number;
  y: number;
  dir: number; // 0 down 1 up 2 left 3 right
  moving: boolean;
  state: PlayerState;
  stateTimer: number;
  maxBalloons: number;
  balloonsUsed: number;
  range: number;
  speedLv: number;
  needles: number;
  isBot: boolean;
  kills: number;
}

export interface BalloonView {
  x: number;
  y: number;
  owner: number;
  fuse01: number; // 남은 퓨즈 비율 1→0
  range: number;
}

export interface StreamView {
  x: number;
  y: number;
  part: number; // 0 center 1 h 2 v 3 endL 4 endR 5 endU 6 endD
  age01: number;
}

export interface ItemView {
  x: number;
  y: number;
  kind: number; // 0 balloon 1 range 2 speed 3 needle 4 maxrange
}

export interface GameEvent {
  kind: Ev;
  x: number;
  y: number;
  data: number;
}

export interface Snapshot {
  tick: number;
  phase: Phase;
  phaseTimer: number;
  timeRemaining: number;
  mapW: number;
  mapH: number;
  winnerTeam: number; // -1 진행중 -2 무승부
  mapId: number;
  tiles: Float32Array; // 0 empty 1 soft 2 hard
  players: PlayerView[];
  balloons: BalloonView[];
  streams: StreamView[];
  items: ItemView[];
  events: GameEvent[];
}

export function parseSnapshot(buf: Float32Array): Snapshot {
  const nPlayers = buf[7];
  const nBalloons = buf[8];
  const nStreams = buf[9];
  const nItems = buf[10];
  const nEvents = buf[11];
  const mapW = buf[5];
  const mapH = buf[6];

  let off = HEADER_LEN;
  const tiles = buf.subarray(off, off + mapW * mapH);
  off += mapW * mapH;

  const players: PlayerView[] = [];
  for (let i = 0; i < nPlayers; i++) {
    const b = off + i * PLAYER_STRIDE;
    players.push({
      id: buf[b],
      charType: buf[b + 1],
      team: buf[b + 2],
      x: buf[b + 3],
      y: buf[b + 4],
      dir: buf[b + 5],
      moving: buf[b + 6] > 0.5,
      state: buf[b + 7] as PlayerState,
      stateTimer: buf[b + 8],
      maxBalloons: buf[b + 9],
      balloonsUsed: buf[b + 10],
      range: buf[b + 11],
      speedLv: buf[b + 12],
      needles: buf[b + 13],
      isBot: buf[b + 14] > 0.5,
      kills: buf[b + 15],
    });
  }
  off += nPlayers * PLAYER_STRIDE;

  const balloons: BalloonView[] = [];
  for (let i = 0; i < nBalloons; i++) {
    const b = off + i * BALLOON_STRIDE;
    balloons.push({ x: buf[b], y: buf[b + 1], owner: buf[b + 2], fuse01: buf[b + 3], range: buf[b + 4] });
  }
  off += nBalloons * BALLOON_STRIDE;

  const streams: StreamView[] = [];
  for (let i = 0; i < nStreams; i++) {
    const b = off + i * STREAM_STRIDE;
    streams.push({ x: buf[b], y: buf[b + 1], part: buf[b + 2], age01: buf[b + 3] });
  }
  off += nStreams * STREAM_STRIDE;

  const items: ItemView[] = [];
  for (let i = 0; i < nItems; i++) {
    const b = off + i * ITEM_STRIDE;
    items.push({ x: buf[b], y: buf[b + 1], kind: buf[b + 2] });
  }
  off += nItems * ITEM_STRIDE;

  const events: GameEvent[] = [];
  for (let i = 0; i < nEvents; i++) {
    const b = off + i * EVENT_STRIDE;
    events.push({ kind: buf[b] as Ev, x: buf[b + 1], y: buf[b + 2], data: buf[b + 3] });
  }

  return {
    tick: buf[1],
    phase: buf[2] as Phase,
    phaseTimer: buf[3],
    timeRemaining: buf[4],
    mapW,
    mapH,
    winnerTeam: buf[12],
    mapId: buf[13],
    tiles,
    players,
    balloons,
    streams,
    items,
    events,
  };
}
