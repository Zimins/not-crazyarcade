// WASM 코어 브리지. wasm-pack --target web 산출물을 직접 import.

import init, { WasmGame } from "../wasm/pkg/game_core.js";

let memory: WebAssembly.Memory;

export async function initWasm(): Promise<void> {
  const out = await init();
  memory = out.memory;
}

export interface MatchConfig {
  seed: bigint;
  mapId: number;
  // [캐릭터, 팀, 봇 여부] — index 0 = 로컬 플레이어
  players: Array<{ charType: number; team: number; isBot: boolean }>;
  /** 봇 난이도 0=쉬움 1=보통 2=어려움 (미지정 시 1) */
  botSkill?: number;
}

export class GameSession {
  private game: WasmGame;
  readonly localPlayerId: number;

  /** localIndex: cfg.players 중 로컬 플레이어의 인덱스 (솔로는 0, 멀티는 내 슬롯 순서) */
  constructor(cfg: MatchConfig, localIndex = 0) {
    this.game = new WasmGame(cfg.seed, cfg.mapId);
    let localId = 0;
    cfg.players.forEach((p, i) => {
      const id = this.game.add_player(p.charType, p.team, p.isBot);
      if (p.isBot && cfg.botSkill !== undefined) {
        this.game.set_bot_skill(id, cfg.botSkill);
      }
      if (i === localIndex) localId = id;
    });
    this.localPlayerId = localId;
  }

  setInput(bitmask: number): void {
    this.game.set_input(this.localPlayerId, bitmask);
  }

  /** 멀티플레이 락스텝용: 임의 플레이어 입력 주입 (전원 is_bot=false 전제) */
  setInputFor(playerId: number, bitmask: number): void {
    this.game.set_input(playerId, bitmask);
  }

  tick(): void {
    this.game.tick();
  }

  /** zero-copy 스냅샷 뷰. WASM 메모리 grow 시 detach 되므로 매 호출마다 새 뷰 생성. */
  snapshot(): Float32Array {
    const ptr = this.game.snapshot_ptr();
    const len = this.game.snapshot_len();
    return new Float32Array(memory.buffer, ptr, len);
  }

  destroy(): void {
    this.game.free();
  }
}
