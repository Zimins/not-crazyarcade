//! WASM 바인딩 레이어. 게임 상태는 WASM 메모리에 살고,
//! JS는 snapshot 버퍼를 Float32Array 뷰로 zero-copy 읽기한다.

mod ai;
mod constants;
mod game;
mod map;
mod rng;

use wasm_bindgen::prelude::*;

pub use game::Game;

#[wasm_bindgen]
pub struct WasmGame {
    inner: Game,
}

#[wasm_bindgen]
impl WasmGame {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u64, map_id: u32) -> WasmGame {
        WasmGame {
            inner: Game::new(seed, map_id),
        }
    }

    /// char_type: 0~7, team: 임의 정수(같으면 한 팀), is_bot
    pub fn add_player(&mut self, char_type: u32, team: i32, is_bot: bool) -> u32 {
        self.inner.add_player(char_type, team, is_bot)
    }

    /// 봇 난이도: 0=쉬움 1=보통(기본) 2=어려움
    pub fn set_bot_skill(&mut self, player_id: u32, skill: u32) {
        self.inner.set_bot_skill(player_id, skill);
    }

    /// 사람 플레이어 입력. bitmask: 1=상 2=하 4=좌 8=우 16=액션
    pub fn set_input(&mut self, player_id: u32, input: u8) {
        self.inner.set_input(player_id, input);
    }

    /// 고정 타임스텝 1틱 진행 (1/60초)
    pub fn tick(&mut self) {
        self.inner.tick();
    }

    /// 스냅샷 재구축 후 버퍼 포인터 반환 (wasm 메모리 내 f32 오프셋)
    pub fn snapshot_ptr(&mut self) -> *const f32 {
        self.inner.build_snapshot().as_ptr()
    }

    /// 직전 snapshot_ptr() 버퍼의 길이 (f32 개수)
    pub fn snapshot_len(&self) -> usize {
        self.inner.snapshot_buf_len()
    }
}
