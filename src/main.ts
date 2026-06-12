// Splash Arena 엔트리포인트 — 화면 흐름과 게임 루프 오케스트레이션.
//
// 흐름: 타이틀(익명 로그인) → 로비(봇 연습 / 온라인 방 목록) → 대기실 → 매치
// 멀티플레이: 결정적 WASM 시뮬 + 서버(RoomDO) 입력 릴레이 락스텝

import "./style.css";
import { initWasm, GameSession, type MatchConfig } from "./game/wasm";
import { parseSnapshot, Phase, Ev, type GameEvent } from "./game/snapshot";
import { InputManager } from "./game/input";
import { sfx, unlockAudio, setMuted, isMuted } from "./game/audio";
import { loadAllAtlases, type Atlases } from "./render/atlas";
import { Renderer } from "./render/renderer";
import {
  titleScreen,
  setupScreen,
  lobbyScreen,
  roomScreen,
  gameScreen,
  showBanner,
  clearOverlay,
  showResult,
  CHAR_INFO,
  feedbackUrl,
  type MatchSetup,
} from "./ui/screens";
import { restoreSession, guestLogin, currentUser, recordMatch } from "./auth/client";
import {
  fetchRooms,
  createRoom,
  RoomConnection,
  type RoomState,
  type StartInfo,
} from "./net/client";

const TICK_DT = 1 / 60;
const MAX_TICKS_PER_FRAME = 5;
/** 멀티: 이 이상 프레임이 밀리면 빠르게 따라잡기 (틱 수) */
const NET_CATCHUP_THRESHOLD = 9;

const app = document.getElementById("app")!;
let atlases: Atlases;

function swapScreen(node: HTMLElement): void {
  app.innerHTML = "";
  app.append(node);
}

function showMessage(text: string): void {
  const msg = document.createElement("div");
  msg.className = "loading";
  msg.textContent = text;
  swapScreen(msg);
}

// ── 상단 사용자/음소거 바 ──────────────────────────────────
function mountTopbar(): void {
  const bar = document.createElement("div");
  bar.className = "topbar";
  const who = document.createElement("span");
  const muteBtn = document.createElement("button");
  muteBtn.textContent = "🔊";
  muteBtn.addEventListener("click", () => {
    setMuted(!isMuted());
    muteBtn.textContent = isMuted() ? "🔇" : "🔊";
  });
  const refresh = () => {
    const u = currentUser();
    who.textContent = u ? `${u.nickname} (${u.provider === "guest" ? "게스트" : u.provider})` : "";
  };
  refresh();

  // GitHub 이슈 바로 작성 링크
  const feedback = document.createElement("a");
  feedback.className = "feedback-link";
  feedback.textContent = "피드백 보내기";
  feedback.href = feedbackUrl();
  feedback.target = "_blank";
  feedback.rel = "noopener noreferrer";

  bar.append(who, feedback, muteBtn);
  document.body.append(bar);
  window.addEventListener("auth-changed", refresh);
}

// ── 효과음 ─────────────────────────────────────────────────
function handleSfxEvents(events: GameEvent[]): void {
  for (const e of events) {
    switch (e.kind) {
      case Ev.Place:
        sfx.place();
        break;
      case Ev.Explode:
        sfx.explode();
        break;
      case Ev.BlockBreak:
        sfx.blockBreak();
        break;
      case Ev.Pickup:
        sfx.pickup();
        break;
      case Ev.Trapped:
        sfx.trapped();
        break;
      case Ev.Rescue:
        sfx.rescue();
        break;
      case Ev.PopDeath:
      case Ev.TimeoutDeath:
        sfx.pop();
        break;
      case Ev.NeedleEscape:
        sfx.needle();
        break;
      case Ev.RoundStart:
        sfx.roundStart();
        break;
      case Ev.ItemDestroyed:
        sfx.itemDestroyed();
        break;
      default:
        break;
    }
  }
}

function playResultSfx(result: "win" | "lose" | "draw"): void {
  if (result === "win") sfx.win();
  else if (result === "lose") sfx.lose();
  else sfx.draw();
}

// ── 화면 흐름 ──────────────────────────────────────────────
function gotoTitle(): void {
  swapScreen(
    titleScreen({
      onStart: (nickname) => {
        unlockAudio();
        void guestLogin(nickname).then(() => {
          window.dispatchEvent(new Event("auth-changed"));
          gotoLobby();
        });
      },
    })
  );
}

function gotoLobby(): void {
  swapScreen(
    lobbyScreen({
      onSolo: () => gotoSetup(),
      onRefresh: async () => {
        try {
          return await fetchRooms();
        } catch {
          return null;
        }
      },
      onCreate: (name) => {
        void (async () => {
          try {
            const code = await createRoom(name);
            await enterRoom(code);
          } catch (err) {
            showMessage(`방 만들기 실패: ${err instanceof Error ? err.message : err}`);
            setTimeout(gotoLobby, 1500);
          }
        })();
      },
      onJoin: (code) => {
        void enterRoom(code).catch((err) => {
          showMessage(`입장 실패: ${err instanceof Error ? err.message : err}`);
          setTimeout(gotoLobby, 1500);
        });
      },
    })
  );
}

function gotoSetup(): void {
  swapScreen(
    setupScreen(atlases, {
      onPlay: (setup) => startMatch(setup),
      onBack: () => gotoLobby(),
    })
  );
}

// ── 솔로(봇전) 매치 ────────────────────────────────────────
function buildConfig(setup: MatchSetup): MatchConfig {
  const n = CHAR_INFO.length;
  const players: MatchConfig["players"] = [];
  if (setup.teamMode) {
    players.push({ charType: setup.charType, team: 0, isBot: false });
    players.push({ charType: (setup.charType + 1) % n, team: 0, isBot: true });
    players.push({ charType: (setup.charType + 2) % n, team: 1, isBot: true });
    players.push({ charType: (setup.charType + 3) % n, team: 1, isBot: true });
  } else {
    players.push({ charType: setup.charType, team: 0, isBot: false });
    for (let i = 0; i < setup.botCount; i++) {
      players.push({ charType: (setup.charType + 1 + i) % n, team: i + 1, isBot: true });
    }
  }
  return {
    seed: BigInt(Date.now()) ^ (BigInt(Math.floor(Math.random() * 0xffff)) << 32n),
    mapId: setup.mapId,
    players,
  };
}

function startMatch(setup: MatchSetup): void {
  const cfg = buildConfig(setup);
  const session = new GameSession(cfg);
  const hud = gameScreen(atlases);
  swapScreen(hud.root);

  const renderer = new Renderer(hud.canvas, atlases);
  const input = new InputManager();
  input.attach();

  const names = cfg.players.map((p, i) =>
    i === 0 ? (currentUser()?.nickname ?? "나") : `${CHAR_INFO[p.charType].name}봇`
  );

  let raf = 0;
  let last = performance.now();
  let accumulator = 0;
  let resultShown = false;
  let started = false;

  showBanner(hud.overlay, "READY...");

  const endMatch = (): void => {
    input.detach();
    cancelAnimationFrame(raf);
    renderer.dispose();
    session.destroy();
  };

  const loop = (now: number): void => {
    const frameDt = Math.min(0.25, (now - last) / 1000);
    last = now;
    accumulator += frameDt;

    session.setInput(input.bitmask());
    let ticks = 0;
    while (accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
      session.tick();
      accumulator -= TICK_DT;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0;

    const snap = parseSnapshot(session.snapshot());
    handleSfxEvents(snap.events);
    renderer.spawnEffects(snap.events);
    renderer.render(snap, frameDt);
    hud.update(snap, session.localPlayerId, names);

    if (snap.phase === Phase.Playing && !started) {
      started = true;
      showBanner(hud.overlay, "GAME START!!");
      setTimeout(() => {
        if (!resultShown) clearOverlay(hud.overlay);
      }, 900);
    }

    if (snap.phase === Phase.RoundOver && !resultShown) {
      resultShown = true;
      const me = snap.players.find((p) => p.id === session.localPlayerId);
      const myTeam = me?.team ?? 0;
      const result: "win" | "lose" | "draw" =
        snap.winnerTeam === -2 ? "draw" : snap.winnerTeam === myTeam ? "win" : "lose";
      playResultSfx(result);
      void recordMatch({
        mapId: snap.mapId,
        charType: me?.charType ?? 0,
        won: result === "win",
        draw: result === "draw",
        kills: me?.kills ?? 0,
      });
      setTimeout(() => {
        showResult(hud.overlay, result, {
          onRetry: () => {
            endMatch();
            startMatch(setup);
          },
          onLobby: () => {
            endMatch();
            gotoSetup();
          },
        });
      }, 700);
    }

    raf = requestAnimationFrame(loop);
  };

  raf = requestAnimationFrame(loop);
}

// ── 온라인 방 흐름 ─────────────────────────────────────────
async function enterRoom(code: string): Promise<void> {
  const conn = new RoomConnection();
  let lastRoom: RoomState | null = null;
  let inGame = false;

  const refs = roomScreen(atlases, {
    onChar: (v) => conn.sendChar(v),
    onMap: (v) => conn.sendMap(v),
    onStart: () => conn.sendStart(),
    onLeave: () => {
      conn.close();
      gotoLobby();
    },
  });

  const backToRoom = (): void => {
    inGame = false;
    swapScreen(refs.root);
    if (lastRoom) refs.update(lastRoom);
  };

  conn.callbacks = {
    onRoom: (room) => {
      lastRoom = room;
      if (!inGame) refs.update(room);
    },
    onStart: (info) => {
      if (inGame || !lastRoom) return;
      inGame = true;
      startNetMatch(conn, info, lastRoom.you, backToRoom);
    },
    onClose: () => {
      if (!inGame) {
        showMessage("방 연결이 끊어졌습니다");
        setTimeout(gotoLobby, 1500);
      }
      // 게임 중 끊김은 startNetMatch 쪽 onClose 가 처리
    },
  };

  await conn.connect(code, currentUser()?.nickname ?? "물풍선", 0);
  swapScreen(refs.root);
}

/** 락스텝 네트워크 매치: 서버 입력 프레임을 소비하며 결정적 시뮬 재생 */
function startNetMatch(
  conn: RoomConnection,
  info: StartInfo,
  mySlot: number,
  backToRoom: () => void
): void {
  const players = [...info.players].sort((a, b) => a.slot - b.slot);
  const myIndex = Math.max(0, players.findIndex((p) => p.slot === mySlot));
  const cfg: MatchConfig = {
    seed: BigInt(info.seed),
    mapId: info.mapId,
    // FFA: 팀 = 슬롯
    players: players.map((p) => ({ charType: p.charType, team: p.slot, isBot: false })),
  };
  const session = new GameSession(cfg, myIndex);
  const hud = gameScreen(atlases);
  swapScreen(hud.root);

  const renderer = new Renderer(hud.canvas, atlases);
  const input = new InputManager();
  input.attach();

  const names: string[] = players.map((p) => p.nickname);

  // 틱 단위 입력 큐 (서버 배치를 펼쳐서 적재)
  const tickQueue: number[][] = [];
  let raf = 0;
  let last = performance.now();
  let accumulator = 0;
  let lastSentInput = -1;
  let resultShown = false;
  let started = false;
  let ended = false;

  showBanner(hud.overlay, "READY...");

  const endMatch = (): void => {
    if (ended) return;
    ended = true;
    input.detach();
    cancelAnimationFrame(raf);
    renderer.dispose();
    session.destroy();
  };

  conn.callbacks.onFrames = (batch) => {
    for (let i = 0; i < batch.count; i++) tickQueue.push(batch.inputs);
  };
  conn.callbacks.onEnd = () => {
    // 서버 종료 통지 — 로컬 시뮬이 이미 결과를 표시했을 것
  };
  conn.callbacks.onClose = () => {
    endMatch();
    showMessage("방 연결이 끊어졌습니다");
    setTimeout(gotoLobby, 1500);
  };

  const applyTick = (inputs: number[]): void => {
    inputs.forEach((bits, idx) => session.setInputFor(idx, bits));
    session.tick();
  };

  const loop = (now: number): void => {
    const frameDt = Math.min(0.25, (now - last) / 1000);
    last = now;

    // 내 입력 전송 (변할 때만)
    const bits = input.bitmask();
    if (bits !== lastSentInput) {
      lastSentInput = bits;
      conn.sendInput(bits);
    }

    // 프레임 소비: 60Hz 페이스 + 밀리면 따라잡기
    accumulator += frameDt;
    let want = Math.floor(accumulator / TICK_DT);
    if (tickQueue.length > NET_CATCHUP_THRESHOLD) {
      want = Math.max(want, tickQueue.length - 3); // 지연 스파이크 → 3틱 버퍼만 남기고 소화
    }
    let consumed = 0;
    while (consumed < want && tickQueue.length > 0) {
      applyTick(tickQueue.shift()!);
      consumed++;
    }
    accumulator = Math.min(accumulator - consumed * TICK_DT, TICK_DT * 2);

    const snap = parseSnapshot(session.snapshot());
    handleSfxEvents(snap.events);
    renderer.spawnEffects(snap.events);
    renderer.render(snap, frameDt);
    hud.update(snap, session.localPlayerId, names);

    if (snap.phase === Phase.Playing && !started) {
      started = true;
      showBanner(hud.overlay, "GAME START!!");
      setTimeout(() => {
        if (!resultShown) clearOverlay(hud.overlay);
      }, 900);
    }

    if (snap.phase === Phase.RoundOver && !resultShown) {
      resultShown = true;
      const me = snap.players.find((p) => p.id === session.localPlayerId);
      const result: "win" | "lose" | "draw" =
        snap.winnerTeam === -2 ? "draw" : snap.winnerTeam === (me?.team ?? -99) ? "win" : "lose";
      playResultSfx(result);
      // 호스트(게임 참가자 중 최저 슬롯)가 서버에 결과 보고 → 방이 대기 상태로 복귀
      if (mySlot === Math.min(...players.map((p) => p.slot))) {
        conn.sendResult(snap.winnerTeam);
      }
      void recordMatch({
        mapId: snap.mapId,
        charType: me?.charType ?? 0,
        won: result === "win",
        draw: result === "draw",
        kills: me?.kills ?? 0,
      });
      setTimeout(() => {
        showResult(hud.overlay, result, {
          onLobby: () => {
            endMatch();
            backToRoom();
          },
          lobbyLabel: "대기실로",
        });
      }, 700);
    }

    if (!ended) raf = requestAnimationFrame(loop);
  };

  raf = requestAnimationFrame(loop);
}

// ── 부트스트랩 ─────────────────────────────────────────────
async function boot(): Promise<void> {
  showMessage("물풍선에 물 채우는 중...");
  await Promise.all([initWasm(), loadAllAtlases().then((a) => (atlases = a)), restoreSession()]);
  mountTopbar();
  gotoTitle();
}

void boot().catch((err) => {
  showMessage(`로드 실패: ${err instanceof Error ? err.message : String(err)}`);
});
