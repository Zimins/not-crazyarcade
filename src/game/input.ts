// 키보드 입력 → 입력 비트마스크. 방향키는 "마지막에 누른 방향" 우선.

export const IN_UP = 1;
export const IN_DOWN = 2;
export const IN_LEFT = 4;
export const IN_RIGHT = 8;
export const IN_ACTION = 16;

const DIR_KEYS: Record<string, number> = {
  ArrowUp: IN_UP,
  ArrowDown: IN_DOWN,
  ArrowLeft: IN_LEFT,
  ArrowRight: IN_RIGHT,
  KeyW: IN_UP,
  KeyS: IN_DOWN,
  KeyA: IN_LEFT,
  KeyD: IN_RIGHT,
};

const ACTION_KEYS = new Set(["Space", "ControlLeft", "ControlRight", "KeyX"]);

export class InputManager {
  /** 현재 눌려 있는 방향 비트, 누른 순서대로 (마지막 요소가 최신) */
  private dirStack: number[] = [];
  /** 눌려 있는 액션 키 코드들 (여러 개 동시 입력 대응) */
  private actionKeys = new Set<string>();
  private attached = false;

  private onKeyDown = (e: KeyboardEvent) => {
    const dir = DIR_KEYS[e.code];
    if (dir !== undefined) {
      e.preventDefault();
      if (e.repeat) return;
      this.dirStack = this.dirStack.filter((d) => d !== dir);
      this.dirStack.push(dir);
    } else if (ACTION_KEYS.has(e.code)) {
      e.preventDefault();
      this.actionKeys.add(e.code);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const dir = DIR_KEYS[e.code];
    if (dir !== undefined) {
      this.dirStack = this.dirStack.filter((d) => d !== dir);
    } else if (ACTION_KEYS.has(e.code)) {
      this.actionKeys.delete(e.code);
    }
  };

  private onBlur = () => {
    this.dirStack = [];
    this.actionKeys.clear();
  };

  attach(): void {
    if (this.attached) return;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.onBlur();
    this.attached = false;
  }

  /** 코어로 보낼 비트마스크 (방향은 최신 1개만) */
  bitmask(): number {
    const dir = this.dirStack.length > 0 ? this.dirStack[this.dirStack.length - 1] : 0;
    return dir | (this.actionKeys.size > 0 ? IN_ACTION : 0);
  }
}
