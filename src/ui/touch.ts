// 모바일 터치 컨트롤: 가상 방향 패드(슬라이드 지원) + 물풍선 버튼,
// 전체화면 + 가로모드 잠금 시도.

import { InputManager, IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT } from "../game/input";

/** 터치 기기 여부 (?touch=1 로 데스크톱 테스트 강제 가능) */
export function isTouchDevice(): boolean {
  if (new URLSearchParams(location.search).has("touch")) return true;
  return matchMedia("(pointer: coarse)").matches;
}

/** 게임 시작 시 전체화면 + 가로 잠금 시도 (iOS는 미지원이라 조용히 무시) */
export async function tryEnterLandscape(): Promise<void> {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    }
  } catch {
    /* iOS Safari 등 미지원 */
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    if (orientation?.lock) await orientation.lock("landscape");
  } catch {
    /* 전체화면 아님/미지원 — 세로면 CSS 회전 안내가 표시됨 */
  }
}

const DIR_NAME: Record<number, string> = {
  [IN_UP]: "up",
  [IN_DOWN]: "down",
  [IN_LEFT]: "left",
  [IN_RIGHT]: "right",
};

/**
 * 터치 컨트롤을 root에 장착. 반환값은 해제 함수.
 * 패드는 터치 위치 기준으로 방향을 계산해 손가락을 떼지 않고 방향 전환 가능.
 */
export function mountTouchControls(root: HTMLElement, input: InputManager): () => void {
  const wrap = document.createElement("div");
  wrap.className = "touch-controls";

  // ── 방향 패드 ──
  const pad = document.createElement("div");
  pad.className = "tc-pad";
  for (const name of ["up", "down", "left", "right"]) {
    const arm = document.createElement("div");
    arm.className = `tc-arm tc-${name}`;
    arm.textContent = name === "up" ? "▲" : name === "down" ? "▼" : name === "left" ? "◀" : "▶";
    pad.append(arm);
  }

  const setDir = (bit: number): void => {
    input.setVirtualDir(bit);
    pad.dataset.dir = DIR_NAME[bit] ?? "";
  };

  const updateFromPoint = (clientX: number, clientY: number): void => {
    const r = pad.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 14) {
      setDir(0); // 중앙 데드존
      return;
    }
    setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? IN_RIGHT : IN_LEFT) : (dy > 0 ? IN_DOWN : IN_UP));
  };

  let padPointer: number | null = null;
  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    padPointer = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    updateFromPoint(e.clientX, e.clientY);
  });
  pad.addEventListener("pointermove", (e) => {
    if (e.pointerId === padPointer) updateFromPoint(e.clientX, e.clientY);
  });
  const padRelease = (e: PointerEvent): void => {
    if (e.pointerId === padPointer) {
      padPointer = null;
      setDir(0);
    }
  };
  pad.addEventListener("pointerup", padRelease);
  pad.addEventListener("pointercancel", padRelease);

  // ── 물풍선 버튼 ──
  const action = document.createElement("div");
  action.className = "tc-action";
  action.textContent = "💧";
  action.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    action.setPointerCapture(e.pointerId);
    action.classList.add("pressed");
    input.setVirtualAction(true);
  });
  const actionRelease = (): void => {
    action.classList.remove("pressed");
    input.setVirtualAction(false);
  };
  action.addEventListener("pointerup", actionRelease);
  action.addEventListener("pointercancel", actionRelease);

  // 컨텍스트 메뉴(길게 누르기) 방지
  wrap.addEventListener("contextmenu", (e) => e.preventDefault());

  wrap.append(pad, action);
  root.append(wrap);

  return () => {
    wrap.remove();
    input.setVirtualDir(0);
    input.setVirtualAction(false);
  };
}

/** 세로 방향 안내 오버레이 (body.in-game + portrait + 터치에서만 CSS로 표시) */
export function mountRotateOverlay(): void {
  const overlay = document.createElement("div");
  overlay.className = "rotate-overlay";
  overlay.innerHTML = "📱<br>기기를 가로로 돌려주세요";
  document.body.append(overlay);
}

/**
 * 더블탭/핀치 줌 차단 (CSS touch-action: manipulation의 JS 이중 방어).
 * 구형 iOS Safari는 CSS만으로 안 막히는 경우가 있어 이벤트 차단을 병행한다.
 */
export function preventZoomGestures(): void {
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  // iOS 전용 핀치 제스처
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  // 300ms 내 연속 터치(더블탭) 차단 — 버튼/링크 동작은 첫 탭에서 이미 발화됨
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd < 300) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false }
  );
}
