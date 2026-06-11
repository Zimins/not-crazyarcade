// DOM 기반 화면 구성: 타이틀 → 로비(봇전/방 목록) → 대기실 → 인게임 → 결과

import type { Atlases } from "../render/atlas";
import type { PlayerView, Snapshot } from "../game/snapshot";
import { PlayerState } from "../game/snapshot";
import { currentUser } from "../auth/client";
import type { RoomListing, RoomState } from "../net/client";

export const CHAR_INFO = [
  { name: "코코", desc: "밸런스" },
  { name: "피코", desc: "스피드" },
  { name: "부리", desc: "물량" },
  { name: "테라", desc: "폭발" },
];

export const MAP_INFO = [
  { name: "숲", theme: "forest" },
  { name: "공장", theme: "factory" },
  { name: "얼음", theme: "ice" },
];

const TEAM_COLORS = ["#2e9df0", "#e84855", "#5cba47", "#ffd23f", "#9b5fe0", "#ff7eb3", "#f2933a", "#7fd4ff"];

export interface MatchSetup {
  charType: number;
  mapId: number;
  botCount: number;
  teamMode: boolean; // true: 2v2 (나+봇 vs 봇2)
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 아틀라스 프레임을 작은 캔버스로 복사 (선택 카드/HUD 아이콘용) */
function frameCanvas(atlases: Atlases, atlasName: keyof Atlases, frame: string): HTMLCanvasElement {
  const atlas = atlases[atlasName];
  const f = atlas.frame(frame);
  const c = document.createElement("canvas");
  c.width = f.w;
  c.height = f.h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  return c;
}

// ── 타이틀 화면 ────────────────────────────────────────────
export function titleScreen(opts: {
  onStart: (nickname: string) => void;
}): HTMLElement {
  const root = el("div", "screen");

  const logo = el("div", "logo");
  const title = el("div", "title", "SPLASH ARENA");
  const subtitle = el("div", "subtitle", "물풍선 액션 아케이드 — 가두고, 구하고, 터뜨려라!");
  logo.append(title, subtitle);

  const panel = el("div", "panel");
  const h = el("h2", undefined, "닉네임을 정하고 바로 시작");
  const row = el("div", "row");
  const input = el("input");
  input.type = "text";
  input.maxLength = 12;
  input.placeholder = "닉네임 (최대 12자)";
  input.value = currentUser()?.nickname ?? "";
  const startBtn = el("button", "primary", "게임 시작");
  row.append(input, startBtn);
  const note = el("p", "muted");
  note.style.marginTop = "10px";
  note.textContent = "익명 로그인으로 전적이 저장됩니다. (구글/깃허브 연동은 추후 지원)";
  panel.append(h, row, note);

  const help = el("div", "panel");
  const h2 = el("h2", undefined, "조작법");
  const helpText = el("div");
  helpText.innerHTML =
    "이동: <b>방향키 / WASD</b> &nbsp;·&nbsp; 물풍선: <b>Space</b> &nbsp;·&nbsp; " +
    "갇혔을 때 바늘 사용: <b>Space</b><br><span class='muted'>물줄기에 맞으면 물방울에 갇힙니다. " +
    "5초 안에 못 나오면 사망! 적과 닿으면 즉시 터집니다.</span>";
  help.append(h2, helpText);

  let starting = false;
  const start = () => {
    if (starting) return; // 더블클릭/Enter 연타로 인한 중복 로그인 방지
    starting = true;
    startBtn.disabled = true;
    opts.onStart(input.value);
  };
  startBtn.addEventListener("click", start);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") start();
  });

  root.append(logo, panel, help);
  return root;
}

// ── 매치 설정 화면 ─────────────────────────────────────────
export function setupScreen(
  atlases: Atlases,
  opts: { onPlay: (setup: MatchSetup) => void; onBack: () => void }
): HTMLElement {
  const root = el("div", "screen");
  const setup: MatchSetup = { charType: 0, mapId: 0, botCount: 3, teamMode: false };

  // 캐릭터 선택
  const charPanel = el("div", "panel");
  charPanel.append(el("h2", undefined, "캐릭터 선택"));
  const charGrid = el("div", "select-grid");
  const charCards: HTMLElement[] = [];
  CHAR_INFO.forEach((c, i) => {
    const card = el("div", "select-card" + (i === setup.charType ? " selected" : ""));
    card.append(frameCanvas(atlases, "characters", `char${i}_down_0`));
    card.append(el("div", "name", c.name));
    card.append(el("div", "desc", c.desc));
    card.addEventListener("click", () => {
      setup.charType = i;
      charCards.forEach((cc, j) => cc.classList.toggle("selected", j === i));
    });
    charCards.push(card);
    charGrid.append(card);
  });
  charPanel.append(charGrid);

  // 맵 선택
  const mapPanel = el("div", "panel");
  mapPanel.append(el("h2", undefined, "맵 선택"));
  const mapGrid = el("div", "select-grid maps");
  const mapCards: HTMLElement[] = [];
  MAP_INFO.forEach((m, i) => {
    const card = el("div", "select-card map-card" + (i === setup.mapId ? " selected" : ""));
    // 맵 미리보기: 타일 3종 미니 조합
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const atlas = atlases.tiles;
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 3; x++) {
        const f = atlas.frame(`${m.theme}_floor_${(x + y) % 2}`);
        ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, x * 32, y * 32, 32, 32);
      }
    const soft = atlas.frame(`${m.theme}_soft`);
    ctx.drawImage(atlas.image, soft.x, soft.y, soft.w, soft.h, 32, 0, 32, 32);
    const hard = atlas.frame(`${m.theme}_hard`);
    ctx.drawImage(atlas.image, hard.x, hard.y, hard.w, hard.h, 64, 32, 32, 32);
    card.append(c);
    card.append(el("div", "name", m.name));
    card.addEventListener("click", () => {
      setup.mapId = i;
      mapCards.forEach((mc, j) => mc.classList.toggle("selected", j === i));
    });
    mapCards.push(card);
    mapGrid.append(card);
  });
  mapPanel.append(mapGrid);

  // 모드/봇 설정
  const modePanel = el("div", "panel");
  modePanel.append(el("h2", undefined, "대전 설정"));
  const modeRow = el("div", "row");
  const ffaBtn = el("button", "primary", "개인전 (봇 3)");
  const teamBtn = el("button", undefined, "팀전 2 vs 2");
  const duoBtn = el("button", undefined, "1 vs 1 (봇 1)");
  const pick = (mode: "ffa" | "team" | "duo") => {
    setup.teamMode = mode === "team";
    setup.botCount = mode === "duo" ? 1 : 3;
    ffaBtn.className = mode === "ffa" ? "primary" : "";
    teamBtn.className = mode === "team" ? "primary" : "";
    duoBtn.className = mode === "duo" ? "primary" : "";
  };
  ffaBtn.addEventListener("click", () => pick("ffa"));
  teamBtn.addEventListener("click", () => pick("team"));
  duoBtn.addEventListener("click", () => pick("duo"));
  modeRow.append(ffaBtn, teamBtn, duoBtn);
  modePanel.append(modeRow);

  // 시작/뒤로
  const actions = el("div", "row");
  const backBtn = el("button", undefined, "← 뒤로");
  const playBtn = el("button", "primary", "출발! ▶");
  playBtn.style.fontSize = "20px";
  playBtn.style.padding = "14px 40px";
  backBtn.addEventListener("click", opts.onBack);
  playBtn.addEventListener("click", () => opts.onPlay({ ...setup }));
  actions.append(backBtn, playBtn);

  root.append(charPanel, mapPanel, modePanel, actions);
  return root;
}

// ── 로비: 봇 연습 + 온라인 방 목록 ─────────────────────────
export function lobbyScreen(opts: {
  onSolo: () => void;
  onCreate: (name: string) => void;
  onJoin: (code: string) => void;
  onRefresh: () => Promise<RoomListing[] | null>;
}): HTMLElement {
  const root = el("div", "screen");
  root.style.maxWidth = "860px";

  const solo = el("div", "panel");
  solo.append(el("h2", undefined, "혼자 연습"));
  const soloRow = el("div", "row");
  const soloBtn = el("button", "primary", "봇 대전 시작 ▶");
  soloRow.append(soloBtn, el("span", "muted", "봇 1~3마리와 오프라인 대전 (개인전/팀전)"));
  soloBtn.addEventListener("click", opts.onSolo);
  solo.append(soloRow);

  const online = el("div", "panel");
  const head = el("div", "row");
  head.style.justifyContent = "space-between";
  head.append(el("h2", undefined, "온라인 방 목록 (최대 6인)"));
  const refreshBtn = el("button", undefined, "새로고침");
  head.append(refreshBtn);
  online.append(head);

  const listBox = el("div", "room-list");
  online.append(listBox);

  const createRow = el("div", "row");
  createRow.style.marginTop = "12px";
  const nameInput = el("input");
  nameInput.type = "text";
  nameInput.maxLength = 20;
  nameInput.placeholder = "방 이름 (예: 같이 물풍선 던져요)";
  const createBtn = el("button", "primary", "방 만들기");
  createRow.append(nameInput, createBtn);
  online.append(createRow);

  const hint = el("p", "muted");
  hint.style.marginTop = "8px";
  hint.textContent = "방을 만들면 자동 입장됩니다. 2명 이상 모이면 방장이 시작할 수 있어요.";
  online.append(hint);

  const renderList = (rooms: RoomListing[] | null) => {
    listBox.innerHTML = "";
    if (rooms === null) {
      listBox.append(el("div", "muted", "방 목록을 불러올 수 없습니다 (오프라인 모드)"));
      return;
    }
    if (rooms.length === 0) {
      listBox.append(el("div", "muted", "열린 방이 없습니다 — 첫 방을 만들어 보세요!"));
      return;
    }
    for (const r of rooms) {
      const row = el("div", "room-row");
      const left = el("div");
      left.append(el("div", "name", r.name));
      left.append(el("div", "muted", `코드 ${r.code}`));
      const right = el("div", "row");
      const count = el("span", undefined, `${r.count}/${r.max}`);
      const joinBtn = el("button", r.status === "waiting" && r.count < r.max ? "primary" : "", "입장");
      joinBtn.disabled = r.status !== "waiting" || r.count >= r.max;
      if (r.status === "playing") joinBtn.textContent = "게임 중";
      else if (r.count >= r.max) joinBtn.textContent = "가득 참";
      joinBtn.addEventListener("click", () => opts.onJoin(r.code));
      right.append(count, joinBtn);
      row.append(left, right);
      listBox.append(row);
    }
  };

  const refresh = async () => {
    refreshBtn.disabled = true;
    renderList(await opts.onRefresh());
    refreshBtn.disabled = false;
  };
  refreshBtn.addEventListener("click", () => void refresh());

  let creating = false;
  const create = () => {
    if (creating) return;
    creating = true;
    createBtn.disabled = true;
    opts.onCreate(nameInput.value.trim() || `${currentUser()?.nickname ?? "물풍선"}의 방`);
  };
  createBtn.addEventListener("click", create);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") create();
  });

  root.append(solo, online);
  void refresh();
  return root;
}

// ── 대기실 (방) ────────────────────────────────────────────
export interface RoomScreenRefs {
  root: HTMLElement;
  update: (room: RoomState) => void;
}

export function roomScreen(
  atlases: Atlases,
  opts: {
    onChar: (charType: number) => void;
    onMap: (mapId: number) => void;
    onStart: () => void;
    onLeave: () => void;
  }
): RoomScreenRefs {
  const root = el("div", "screen");
  root.style.maxWidth = "860px";

  const head = el("div", "panel");
  const title = el("h2", undefined, "대기실");
  const sub = el("p", "muted", "");
  head.append(title, sub);

  const slotsPanel = el("div", "panel");
  slotsPanel.append(el("h2", undefined, "참가자"));
  const slotsGrid = el("div", "select-grid");
  slotsGrid.style.gridTemplateColumns = "repeat(6, 1fr)";
  slotsPanel.append(slotsGrid);

  const charPanel = el("div", "panel");
  charPanel.append(el("h2", undefined, "내 캐릭터"));
  const charGrid = el("div", "select-grid");
  const charCards: HTMLElement[] = [];
  CHAR_INFO.forEach((c, i) => {
    const card = el("div", "select-card");
    card.append(frameCanvas(atlases, "characters", `char${i}_down_0`));
    card.append(el("div", "name", c.name));
    card.append(el("div", "desc", c.desc));
    card.addEventListener("click", () => opts.onChar(i));
    charCards.push(card);
    charGrid.append(card);
  });
  charPanel.append(charGrid);

  const hostPanel = el("div", "panel");
  hostPanel.append(el("h2", undefined, "맵 선택 (방장)"));
  const mapRow = el("div", "row");
  const mapBtns: HTMLButtonElement[] = [];
  MAP_INFO.forEach((m, i) => {
    const b = el("button", undefined, m.name);
    b.addEventListener("click", () => opts.onMap(i));
    mapBtns.push(b);
    mapRow.append(b);
  });
  hostPanel.append(mapRow);

  const actions = el("div", "row");
  const leaveBtn = el("button", undefined, "← 나가기");
  const startBtn = el("button", "primary", "게임 시작 ▶");
  startBtn.style.fontSize = "18px";
  startBtn.style.padding = "12px 36px";
  leaveBtn.addEventListener("click", opts.onLeave);
  startBtn.addEventListener("click", opts.onStart);
  actions.append(leaveBtn, startBtn);

  root.append(head, slotsPanel, charPanel, hostPanel, actions);

  const update = (room: RoomState) => {
    title.textContent = `대기실 — ${room.name}`;
    sub.textContent = `방 코드 ${room.code} · ${room.players.length}/6명`;

    slotsGrid.innerHTML = "";
    for (let slot = 0; slot < 6; slot++) {
      const p = room.players.find((q) => q.slot === slot);
      const card = el("div", "select-card");
      if (p) {
        card.append(frameCanvas(atlases, "characters", `char${p.charType}_down_0`));
        const label = p.slot === room.you ? `${p.nickname} (나)` : p.nickname;
        card.append(el("div", "name", label));
        card.append(el("div", "desc", p.slot === room.host ? "방장" : CHAR_INFO[p.charType].name));
        if (p.slot === room.you) card.classList.add("selected");
      } else {
        const empty = el("div", "muted", "빈 자리");
        empty.style.padding = "30px 0";
        card.append(empty);
        card.style.opacity = "0.5";
      }
      slotsGrid.append(card);
    }

    const me = room.players.find((q) => q.slot === room.you);
    charCards.forEach((c, i) => c.classList.toggle("selected", me?.charType === i));

    const amHost = room.you === room.host;
    mapBtns.forEach((b, i) => {
      b.disabled = !amHost;
      b.className = i === room.mapId ? "primary" : "";
    });
    startBtn.disabled = !(amHost && room.players.length >= 2);
    startBtn.textContent = amHost
      ? room.players.length >= 2
        ? "게임 시작 ▶"
        : "2명 이상 필요"
      : "방장이 시작합니다...";
  };

  return { root, update };
}

// ── 인게임 HUD ─────────────────────────────────────────────
export interface HudRefs {
  root: HTMLElement;
  boardWrap: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  update: (snap: Snapshot, localId: number, names: string[]) => void;
}

export function gameScreen(atlases: Atlases): HudRefs {
  const root = el("div", "game-layout");

  const boardWrap = el("div", "board-wrap");
  const canvas = document.createElement("canvas");
  canvas.className = "board";
  const overlay = el("div", "overlay");
  boardWrap.append(canvas, overlay);

  const hud = el("div", "hud");
  const timer = el("div", "timer", "3:00");
  const playersBox = el("div", "players");
  const stats = el("div", "stats");

  const statDefs = [
    { frame: "item_balloon", key: "balloons" },
    { frame: "item_range", key: "range" },
    { frame: "item_speed", key: "speed" },
    { frame: "item_needle", key: "needles" },
  ] as const;
  const statValues = new Map<string, HTMLElement>();
  for (const sd of statDefs) {
    const stat = el("div", "stat");
    stat.append(frameCanvas(atlases, "items", sd.frame));
    const v = el("span", undefined, "0");
    stat.append(v);
    statValues.set(sd.key, v);
    stats.append(stat);
  }

  hud.append(timer, playersBox, stats);
  root.append(boardWrap, hud);

  const slotEls: { root: HTMLElement; dot: HTMLElement; name: HTMLElement; kills: HTMLElement }[] = [];

  const update = (snap: Snapshot, localId: number, names: string[]) => {
    // 타이머
    const t = Math.max(0, snap.timeRemaining);
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60)
      .toString()
      .padStart(2, "0");
    const timeStr = `${mm}:${ss}`;
    if (timer.textContent !== timeStr) timer.textContent = timeStr;
    timer.classList.toggle("urgent", t < 30);

    // 플레이어 슬롯 (최초 생성 후 갱신)
    if (slotEls.length === 0) {
      for (const p of snap.players) {
        const slot = el("div", "player-slot");
        const dot = el("span", "dot");
        dot.style.background = TEAM_COLORS[p.team % TEAM_COLORS.length];
        const name = el("span", undefined, names[p.id] ?? `봇 ${p.id}`);
        const kills = el("span", "kills", "0킬");
        slot.append(dot, name, kills);
        playersBox.append(slot);
        slotEls.push({ root: slot, dot, name, kills });
      }
    }
    snap.players.forEach((p: PlayerView, i: number) => {
      const s = slotEls[i];
      if (!s) return;
      s.root.classList.toggle("dead", p.state === PlayerState.Dead);
      const killStr = `${p.kills}킬`;
      if (s.kills.textContent !== killStr) s.kills.textContent = killStr;
    });

    // 내 스탯
    const me = snap.players.find((p) => p.id === localId);
    if (me) {
      const vals: Record<string, string> = {
        balloons: `${me.maxBalloons - me.balloonsUsed}/${me.maxBalloons}`,
        range: `${me.range}`,
        speed: `${me.speedLv}`,
        needles: `${me.needles}`,
      };
      for (const [k, v] of Object.entries(vals)) {
        const elv = statValues.get(k);
        if (elv && elv.textContent !== v) elv.textContent = v;
      }
    }
  };

  return { root, boardWrap, canvas, overlay, update };
}

/** 오버레이 배너 표시 */
export function showBanner(overlay: HTMLElement, text: string, cls = ""): void {
  overlay.innerHTML = "";
  overlay.append(el("div", `banner ${cls}`, text));
}

export function clearOverlay(overlay: HTMLElement): void {
  overlay.innerHTML = "";
}

/** 결과 오버레이 — onRetry 미지정 시(멀티) 다시하기 버튼 생략 */
export function showResult(
  overlay: HTMLElement,
  result: "win" | "lose" | "draw",
  opts: { onRetry?: () => void; onLobby: () => void; lobbyLabel?: string }
): void {
  overlay.innerHTML = "";
  const text = result === "win" ? "WIN!" : result === "lose" ? "LOSE..." : "DRAW";
  overlay.append(el("div", `banner ${result === "win" ? "win" : result === "lose" ? "lose" : ""}`, text));
  const actions = el("div", "actions");
  if (opts.onRetry) {
    const retry = el("button", "primary", "다시하기");
    retry.addEventListener("click", opts.onRetry);
    actions.append(retry);
  }
  const lobby = el("button", opts.onRetry ? "" : "primary", opts.lobbyLabel ?? "로비로");
  lobby.addEventListener("click", opts.onLobby);
  actions.append(lobby);
  overlay.append(actions);
}
