// 모바일 터치 컨트롤: 가상 방향 패드(슬라이드 지원) + 물풍선 버튼,
// 전체화면 + 가로모드 잠금 시도.

import { InputManager, IN_UP, IN_DOWN, IN_LEFT, IN_RIGHT } from "../game/input";

/** 터치 기기 여부 (?touch=1 로 데스크톱 테스트 강제 가능) */
export function isTouchDevice(): boolean {
  if (new URLSearchParams(location.search).has("touch")) return true;
  return matchMedia("(pointer: coarse)").matches;
}

/** 게임 시작 시 전체화면만 시도(몰입). 가로 잠금은 하지 않는다 — 세로 모드도 지원한다. */
export async function tryEnterLandscape(): Promise<void> {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    }
  } catch {
    /* iOS Safari 등 미지원 */
  }
}

/** 조이스틱 노브 최대 반경(px)과 중앙 데드존(px) */
const STICK_MAX_R = 48;
const STICK_DEAD = 12;

export interface TouchControls {
  /** 컨트롤 제거 (매치 종료) */
  destroy: () => void;
  /** 입력 활성/비활성 — 사망 시 false로 막아 결과(재시작/나가기) 버튼만 누르도록 한다 */
  setEnabled: (on: boolean) => void;
}

/**
 * 터치 컨트롤을 root에 장착. 좌하단에 고정 조이스틱(항상 표시) + 물풍선 버튼.
 * 조이스틱 영역을 누른 채 끌어 방향을 정한다(주 축 4방향). 떼면 노브가 중앙으로 복귀·정지.
 */
export function mountTouchControls(root: HTMLElement, input: InputManager): TouchControls {
  const wrap = document.createElement("div");
  wrap.className = "touch-controls";

  // ── 고정 조이스틱 (좌하단 항상 표시) ──
  const zone = document.createElement("div");
  zone.className = "tc-stickzone";
  const base = document.createElement("div");
  base.className = "tc-base";
  const knob = document.createElement("div");
  knob.className = "tc-knob";
  base.append(knob);
  zone.append(base);

  const setDir = (bit: number): void => input.setVirtualDir(bit);
  const resetKnob = (): void => {
    knob.style.transform = "translate(-50%, -50%)";
  };

  let stickId: number | null = null;

  // 베이스 중심 기준 드래그 벡터 → 노브 위치 + 방향(주 축 4방향)
  const updateKnob = (clientX: number, clientY: number): void => {
    const r = base.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    const cl = Math.min(dist, STICK_MAX_R);
    const a = Math.atan2(dy, dx);
    knob.style.transform = `translate(calc(-50% + ${Math.cos(a) * cl}px), calc(-50% + ${Math.sin(a) * cl}px))`;
    if (dist < STICK_DEAD) setDir(0);
    else setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? IN_RIGHT : IN_LEFT) : dy > 0 ? IN_DOWN : IN_UP);
  };

  zone.addEventListener("pointerdown", (e) => {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    updateKnob(e.clientX, e.clientY);
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId === stickId) updateKnob(e.clientX, e.clientY);
  });
  const stickRelease = (e: PointerEvent): void => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    resetKnob();
    setDir(0);
  };
  zone.addEventListener("pointerup", stickRelease);
  zone.addEventListener("pointercancel", stickRelease);

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

  wrap.append(zone, action);
  root.append(wrap);

  return {
    destroy: () => {
      wrap.remove();
      input.setVirtualDir(0);
      input.setVirtualAction(false);
    },
    setEnabled: (on: boolean) => {
      wrap.classList.toggle("disabled", !on);
      if (!on) {
        stickId = null;
        resetKnob();
        action.classList.remove("pressed");
        input.setVirtualDir(0);
        input.setVirtualAction(false);
      }
    },
  };
}

/**
 * 더블탭/핀치 줌 차단 (CSS touch-action: manipulation의 JS 이중 방어).
 * 구형 iOS Safari는 CSS만으로 안 막히는 경우가 있어 이벤트 차단을 병행한다.
 */
export function preventZoomGestures(): void {
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  // iOS 전용 핀치 제스처
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  // 롱프레스 컨텍스트 메뉴 차단 (텍스트 입력창은 붙여넣기 등 허용)
  document.addEventListener("contextmenu", (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
  });
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
