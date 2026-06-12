//! 게임 시뮬레이션 본체. 고정 타임스텝(60Hz) tick 기반.
//!
//! 모든 좌표는 타일 단위 f32 (타일 중심 = x.5). 렌더링 좌표 변환은 JS 몫.

use crate::ai;
use crate::constants::*;
use crate::map::{GameMap, Tile};
use crate::rng::Rng;

// ── 입력 비트 ──────────────────────────────────────────────
pub const IN_UP: u8 = 1;
pub const IN_DOWN: u8 = 2;
pub const IN_LEFT: u8 = 4;
pub const IN_RIGHT: u8 = 8;
pub const IN_ACTION: u8 = 16;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dir {
    Down,
    Up,
    Left,
    Right,
}

impl Dir {
    pub fn code(self) -> f32 {
        match self {
            Dir::Down => 0.0,
            Dir::Up => 1.0,
            Dir::Left => 2.0,
            Dir::Right => 3.0,
        }
    }
    pub fn delta(self) -> (i32, i32) {
        match self {
            Dir::Down => (0, 1),
            Dir::Up => (0, -1),
            Dir::Left => (-1, 0),
            Dir::Right => (1, 0),
        }
    }
}

// ── 캐릭터 아키타입 ────────────────────────────────────────
#[derive(Clone, Copy)]
pub struct CharStats {
    pub start_balloons: u32,
    pub max_balloons: u32,
    pub start_range: u32,
    pub max_range: u32,
    pub start_speed_lv: u32,
    pub max_speed_lv: u32,
}

/// 캐릭터 수 (스프라이트·UI와 동기화)
pub const NUM_CHARS: u32 = 8;

/// 캐릭터 아키타입 (원작 스탯 분포 패턴 기반, 1~10 스케일).
/// 0=코코(밸런스/초반형), 1=피코(스피드형), 2=부리(물량형), 3=테라(폭발형),
/// 4=모카(대기만성형: 시작 최저·캡 최고), 5=푸딩(초반 물량형: 시작 풍선 2),
/// 6=치치(질주형: 저화력·풍선 캡 높음), 7=펭펭(초반 강세형: 시작 합 최고·캡 최저)
pub fn char_stats(char_type: u32) -> CharStats {
    match char_type % NUM_CHARS {
        1 => CharStats { start_balloons: 1, max_balloons: 6, start_range: 1, max_range: 7, start_speed_lv: 5, max_speed_lv: 9 },
        2 => CharStats { start_balloons: 2, max_balloons: 9, start_range: 1, max_range: 6, start_speed_lv: 4, max_speed_lv: 7 },
        3 => CharStats { start_balloons: 1, max_balloons: 7, start_range: 2, max_range: 9, start_speed_lv: 4, max_speed_lv: 8 },
        4 => CharStats { start_balloons: 1, max_balloons: 9, start_range: 1, max_range: 8, start_speed_lv: 4, max_speed_lv: 8 },
        5 => CharStats { start_balloons: 2, max_balloons: 8, start_range: 1, max_range: 6, start_speed_lv: 5, max_speed_lv: 8 },
        6 => CharStats { start_balloons: 1, max_balloons: 8, start_range: 1, max_range: 5, start_speed_lv: 5, max_speed_lv: 9 },
        7 => CharStats { start_balloons: 1, max_balloons: 6, start_range: 2, max_range: 6, start_speed_lv: 6, max_speed_lv: 7 },
        _ => CharStats { start_balloons: 1, max_balloons: 7, start_range: 2, max_range: 7, start_speed_lv: 5, max_speed_lv: 8 },
    }
}

// ── 엔티티 ─────────────────────────────────────────────────
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum PState {
    Normal,
    Trapped,
    Dead,
}

pub struct Player {
    pub id: u32,
    pub char_type: u32,
    pub team: i32,
    pub is_bot: bool,
    pub x: f32,
    pub y: f32,
    pub dir: Dir,
    pub moving: bool,
    pub state: PState,
    pub state_timer: f32, // Trapped: 남은 시간
    pub invuln: f32,
    pub max_balloons: u32,
    pub balloons_used: u32,
    pub range: u32,
    pub speed_lv: u32,
    pub needles: u32,
    pub kills: u32,
    pub input: u8,
    pub prev_input: u8,
    pub ai_timer: f32,
    pub stats: CharStats,
}

impl Player {
    pub fn speed(&self) -> f32 {
        SPEED_BASE + self.speed_lv as f32 * SPEED_STEP
    }
    pub fn tile(&self) -> (i32, i32) {
        (self.x as i32, self.y as i32)
    }
    pub fn alive(&self) -> bool {
        !matches!(self.state, PState::Dead)
    }
}

pub struct Balloon {
    pub x: i32,
    pub y: i32,
    pub owner: u32,
    pub fuse: f32,
    pub range: u32,
    /// 설치 시점에 겹쳐 있던 플레이어들은 벗어날 때까지 통과 가능
    pub walkthrough: Vec<u32>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StreamPart {
    Center,
    HMid,
    VMid,
    EndL,
    EndR,
    EndU,
    EndD,
}

impl StreamPart {
    pub fn code(self) -> f32 {
        match self {
            StreamPart::Center => 0.0,
            StreamPart::HMid => 1.0,
            StreamPart::VMid => 2.0,
            StreamPart::EndL => 3.0,
            StreamPart::EndR => 4.0,
            StreamPart::EndU => 5.0,
            StreamPart::EndD => 6.0,
        }
    }
}

pub struct StreamCell {
    pub x: i32,
    pub y: i32,
    pub part: StreamPart,
    pub age: f32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ItemType {
    BalloonUp,
    RangeUp,
    SpeedUp,
    Needle,
    MaxRange,
}

impl ItemType {
    pub fn code(self) -> f32 {
        match self {
            ItemType::BalloonUp => 0.0,
            ItemType::RangeUp => 1.0,
            ItemType::SpeedUp => 2.0,
            ItemType::Needle => 3.0,
            ItemType::MaxRange => 4.0,
        }
    }
}

pub struct GroundItem {
    pub x: i32,
    pub y: i32,
    pub kind: ItemType,
    /// 이 시각(라운드 경과초)까지는 물줄기에 파괴되지 않음 (드러낸 폭발 보호)
    pub protect_until: f32,
}

// ── 이벤트 (JS가 사운드/이펙트 트리거용으로 드레인) ───────
pub const EV_PLACE: f32 = 1.0;
pub const EV_EXPLODE: f32 = 2.0;
pub const EV_BLOCK_BREAK: f32 = 3.0;
pub const EV_PICKUP: f32 = 4.0;
pub const EV_TRAPPED: f32 = 5.0;
pub const EV_RESCUE: f32 = 6.0;
pub const EV_POP_DEATH: f32 = 7.0;
pub const EV_TIMEOUT_DEATH: f32 = 8.0;
pub const EV_ROUND_START: f32 = 9.0;
pub const EV_ROUND_END: f32 = 10.0;
pub const EV_NEEDLE_ESCAPE: f32 = 11.0;
pub const EV_ITEM_DESTROYED: f32 = 12.0;
pub const EV_AIRDROP: f32 = 13.0;

pub struct Event {
    pub kind: f32,
    pub x: f32,
    pub y: f32,
    pub data: f32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Countdown,
    Playing,
    RoundOver,
}

impl Phase {
    pub fn code(self) -> f32 {
        match self {
            Phase::Countdown => 0.0,
            Phase::Playing => 1.0,
            Phase::RoundOver => 2.0,
        }
    }
}

// ── 게임 본체 ──────────────────────────────────────────────
pub struct Game {
    pub map: GameMap,
    pub map_id: u32,
    pub players: Vec<Player>,
    pub balloons: Vec<Balloon>,
    pub streams: Vec<StreamCell>,
    pub items: Vec<GroundItem>,
    pub events: Vec<Event>,
    pub rng: Rng,
    pub phase: Phase,
    pub phase_timer: f32,
    pub time_remaining: f32,
    pub elapsed: f32,
    pub tick_no: u64,
    /// -1=진행중, -2=무승부, 그 외=승리 팀
    pub winner_team: i32,
    /// 다음 아이템 보급 인덱스 (AIRDROP_TIMES)
    airdrop_idx: usize,
    snapshot_buf: Vec<f32>,
}

impl Game {
    pub fn new(seed: u64, map_id: u32) -> Self {
        let mut rng = Rng::new(seed);
        let map = GameMap::by_id(map_id, &mut rng);
        Self {
            map,
            map_id,
            players: Vec::new(),
            balloons: Vec::new(),
            streams: Vec::new(),
            items: Vec::new(),
            events: Vec::new(),
            rng,
            phase: Phase::Countdown,
            phase_timer: COUNTDOWN_SECS,
            time_remaining: ROUND_SECS,
            elapsed: 0.0,
            tick_no: 0,
            winner_team: -1,
            airdrop_idx: 0,
            snapshot_buf: Vec::with_capacity(1024),
        }
    }

    pub fn add_player(&mut self, char_type: u32, team: i32, is_bot: bool) -> u32 {
        let id = self.players.len() as u32;
        let (sx, sy) = self.map.spawns[(id as usize) % crate::map::MAX_SPAWNS];
        let stats = char_stats(char_type);
        self.players.push(Player {
            id,
            char_type,
            team,
            is_bot,
            x: sx,
            y: sy,
            dir: Dir::Down,
            moving: false,
            state: PState::Normal,
            state_timer: 0.0,
            invuln: 0.0,
            max_balloons: stats.start_balloons,
            balloons_used: 0,
            range: stats.start_range,
            speed_lv: stats.start_speed_lv,
            needles: 0,
            kills: 0,
            input: 0,
            prev_input: 0,
            ai_timer: 0.0,
            stats,
        });
        id
    }

    pub fn set_input(&mut self, player_id: u32, input: u8) {
        if let Some(p) = self.players.get_mut(player_id as usize) {
            if !p.is_bot {
                p.input = input;
            }
        }
    }

    fn push_event(&mut self, kind: f32, x: f32, y: f32, data: f32) {
        self.events.push(Event { kind, x, y, data });
    }

    // ── 충돌 ───────────────────────────────────────────────
    /// 해당 타일이 플레이어에게 통행 불가인지
    pub fn solid_for(&self, tx: i32, ty: i32, player_id: u32) -> bool {
        if self.map.tile(tx, ty).is_solid() {
            return true;
        }
        self.balloons
            .iter()
            .any(|b| b.x == tx && b.y == ty && !b.walkthrough.contains(&player_id))
    }

    /// AABB(반폭 PLAYER_HALF)가 (px,py) 중심에 있을 때 충돌하는지
    fn collides(&self, px: f32, py: f32, player_id: u32) -> bool {
        let min_tx = (px - PLAYER_HALF).floor() as i32;
        let max_tx = (px + PLAYER_HALF - 1e-4).floor() as i32;
        let min_ty = (py - PLAYER_HALF).floor() as i32;
        let max_ty = (py + PLAYER_HALF - 1e-4).floor() as i32;
        for ty in min_ty..=max_ty {
            for tx in min_tx..=max_tx {
                if self.solid_for(tx, ty, player_id) {
                    return true;
                }
            }
        }
        false
    }

    /// 축 단위 이동 + 코너 슬라이딩. 새 좌표 반환.
    ///
    /// 막혔을 때 두 가지 보정:
    /// 1. 진행 방향 "중심 셀"은 열려 있는데 인접 모서리 셀에 클리핑된 경우
    ///    → 행/열 중심 쪽으로 끌어당겨 모서리를 흘려보냄 (오버슈트 없이 중심에 클램프)
    /// 2. 중심 셀이 막혔지만 충분히(CORNER_ASSIST) 치우쳐 있고 그쪽 행/열이 열린 경우
    ///    → 열린 행/열 중심 쪽으로 우회 (역시 클램프; 경계를 넘으면 1번 케이스가 이어받아 수렴)
    fn move_axis(&self, pid: u32, x: f32, y: f32, dx: f32, dy: f32) -> (f32, f32) {
        debug_assert!(dx == 0.0 || dy == 0.0);
        let (nx, ny) = (x + dx, y + dy);
        if !self.collides(nx, ny, pid) {
            return (nx, ny);
        }
        // 막힘 → 벽에 밀착
        let (mut cx, mut cy) = (x, y);
        if dx != 0.0 {
            let tile_edge = if dx > 0.0 {
                (x + PLAYER_HALF + dx).floor() - PLAYER_HALF - 1e-3
            } else {
                (x - PLAYER_HALF + dx).ceil() + PLAYER_HALF + 1e-3
            };
            if !self.collides(tile_edge, y, pid) {
                cx = tile_edge;
            }
            // 진행 방향 리딩 칼럼
            let tx = if dx > 0.0 {
                (x + PLAYER_HALF + dx).floor() as i32
            } else {
                (x - PLAYER_HALF + dx).floor() as i32
            };
            let ty = y.floor() as i32;
            let frac = y - (ty as f32 + 0.5);
            let step = dx.abs();
            if !self.solid_for(tx, ty, pid) {
                // 케이스 1: 중심 셀 열림 — 모서리 클리핑이면 중심으로 정렬
                if frac > 0.0 && self.solid_for(tx, ty + 1, pid) {
                    cy = (y - step).max(ty as f32 + 0.5);
                } else if frac < 0.0 && self.solid_for(tx, ty - 1, pid) {
                    cy = (y + step).min(ty as f32 + 0.5);
                }
            } else {
                // 케이스 2: 중심 셀 막힘 — 치우친 쪽 행이 열려 있으면 우회
                if frac > CORNER_ASSIST && !self.solid_for(tx, ty + 1, pid) {
                    cy = (y + step).min(ty as f32 + 1.5);
                } else if frac < -CORNER_ASSIST && !self.solid_for(tx, ty - 1, pid) {
                    cy = (y - step).max(ty as f32 - 0.5);
                }
            }
            if self.collides(cx, cy, pid) {
                cy = y;
                if self.collides(cx, cy, pid) {
                    cx = x;
                }
            }
        } else if dy != 0.0 {
            let tile_edge = if dy > 0.0 {
                (y + PLAYER_HALF + dy).floor() - PLAYER_HALF - 1e-3
            } else {
                (y - PLAYER_HALF + dy).ceil() + PLAYER_HALF + 1e-3
            };
            if !self.collides(x, tile_edge, pid) {
                cy = tile_edge;
            }
            let ty = if dy > 0.0 {
                (y + PLAYER_HALF + dy).floor() as i32
            } else {
                (y - PLAYER_HALF + dy).floor() as i32
            };
            let tx = x.floor() as i32;
            let frac = x - (tx as f32 + 0.5);
            let step = dy.abs();
            if !self.solid_for(tx, ty, pid) {
                if frac > 0.0 && self.solid_for(tx + 1, ty, pid) {
                    cx = (x - step).max(tx as f32 + 0.5);
                } else if frac < 0.0 && self.solid_for(tx - 1, ty, pid) {
                    cx = (x + step).min(tx as f32 + 0.5);
                }
            } else {
                if frac > CORNER_ASSIST && !self.solid_for(tx + 1, ty, pid) {
                    cx = (x + step).min(tx as f32 + 1.5);
                } else if frac < -CORNER_ASSIST && !self.solid_for(tx - 1, ty, pid) {
                    cx = (x - step).max(tx as f32 - 0.5);
                }
            }
            if self.collides(cx, cy, pid) {
                cx = x;
                if self.collides(cx, cy, pid) {
                    cy = y;
                }
            }
        }
        (cx, cy)
    }

    // ── 메인 루프 ──────────────────────────────────────────
    pub fn tick(&mut self) {
        self.tick_no += 1;
        match self.phase {
            Phase::Countdown => {
                self.phase_timer -= TICK_DT;
                if self.phase_timer <= 0.0 {
                    self.phase = Phase::Playing;
                    self.push_event(EV_ROUND_START, 0.0, 0.0, 0.0);
                }
            }
            Phase::Playing => {
                self.elapsed += TICK_DT;
                self.time_remaining -= TICK_DT;
                self.tick_airdrop();
                self.run_ai();
                self.tick_players();
                self.tick_balloons();
                self.tick_streams();
                self.tick_pickups();
                self.tick_bubbles();
                self.check_end();
                for p in &mut self.players {
                    p.prev_input = p.input;
                }
            }
            Phase::RoundOver => {
                self.phase_timer += TICK_DT;
            }
        }
    }

    fn run_ai(&mut self) {
        for i in 0..self.players.len() {
            if !self.players[i].is_bot || !self.players[i].alive() {
                continue;
            }
            self.players[i].ai_timer -= TICK_DT;
            if self.players[i].ai_timer <= 0.0 {
                self.players[i].ai_timer = AI_THINK_INTERVAL;
                let input = ai::think(self, i);
                self.players[i].input = input;
            }
        }
    }

    fn tick_players(&mut self) {
        for i in 0..self.players.len() {
            let p = &self.players[i];
            if !p.alive() {
                continue;
            }
            let (input, prev) = (p.input, p.prev_input);
            let pressed = input & !prev;

            // 이동
            let speed = match p.state {
                PState::Normal => p.speed(),
                PState::Trapped => TRAPPED_SPEED,
                PState::Dead => 0.0,
            };
            let dir = if input & IN_UP != 0 {
                Some(Dir::Up)
            } else if input & IN_DOWN != 0 {
                Some(Dir::Down)
            } else if input & IN_LEFT != 0 {
                Some(Dir::Left)
            } else if input & IN_RIGHT != 0 {
                Some(Dir::Right)
            } else {
                None
            };

            let (px, py, pid) = (self.players[i].x, self.players[i].y, self.players[i].id);
            if let Some(d) = dir {
                let step = speed * TICK_DT;
                let (dx, dy) = match d {
                    Dir::Up => (0.0, -step),
                    Dir::Down => (0.0, step),
                    Dir::Left => (-step, 0.0),
                    Dir::Right => (step, 0.0),
                };
                let (nx, ny) = self.move_axis(pid, px, py, dx, dy);
                let p = &mut self.players[i];
                p.moving = nx != px || ny != py;
                p.x = nx.clamp(PLAYER_HALF, MAP_W as f32 - PLAYER_HALF);
                p.y = ny.clamp(PLAYER_HALF, MAP_H as f32 - PLAYER_HALF);
                p.dir = d;
            } else {
                self.players[i].moving = false;
            }

            // 액션 (눌린 순간만)
            if pressed & IN_ACTION != 0 {
                match self.players[i].state {
                    PState::Normal => self.place_balloon(i),
                    PState::Trapped => self.try_needle_escape(i),
                    PState::Dead => {}
                }
            }

            let p = &mut self.players[i];
            if p.invuln > 0.0 {
                p.invuln -= TICK_DT;
            }
        }

        // 풍선 walkthrough 갱신: 타일에서 벗어난 플레이어는 통과권 상실
        for b in &mut self.balloons {
            b.walkthrough.retain(|&pid| {
                self.players.get(pid as usize).map_or(false, |p| {
                    let overlaps_x = (p.x - (b.x as f32 + 0.5)).abs() < 0.5 + PLAYER_HALF;
                    let overlaps_y = (p.y - (b.y as f32 + 0.5)).abs() < 0.5 + PLAYER_HALF;
                    overlaps_x && overlaps_y
                })
            });
        }
    }

    fn place_balloon(&mut self, idx: usize) {
        let p = &self.players[idx];
        if p.balloons_used >= p.max_balloons {
            return;
        }
        let (tx, ty) = p.tile();
        if self.map.tile(tx, ty).is_solid() {
            return;
        }
        if self.balloons.iter().any(|b| b.x == tx && b.y == ty) {
            return;
        }
        let range = p.range;
        let owner = p.id;
        // 설치 순간 그 타일에 겹쳐 있는 모든 플레이어는 벗어날 때까지 통과 가능
        let walkthrough: Vec<u32> = self
            .players
            .iter()
            .filter(|q| {
                q.alive()
                    && (q.x - (tx as f32 + 0.5)).abs() < 0.5 + PLAYER_HALF
                    && (q.y - (ty as f32 + 0.5)).abs() < 0.5 + PLAYER_HALF
            })
            .map(|q| q.id)
            .collect();
        self.balloons.push(Balloon {
            x: tx,
            y: ty,
            owner,
            fuse: BALLOON_FUSE,
            range,
            walkthrough,
        });
        self.players[idx].balloons_used += 1;
        self.push_event(EV_PLACE, tx as f32 + 0.5, ty as f32 + 0.5, owner as f32);
    }

    fn try_needle_escape(&mut self, idx: usize) {
        let p = &mut self.players[idx];
        if p.needles == 0 {
            return;
        }
        p.needles -= 1;
        p.state = PState::Normal;
        p.state_timer = 0.0;
        p.invuln = 1.0;
        let (x, y) = (p.x, p.y);
        let id = p.id;
        self.push_event(EV_NEEDLE_ESCAPE, x, y, id as f32);
    }

    fn tick_balloons(&mut self) {
        for b in &mut self.balloons {
            b.fuse -= TICK_DT;
        }
        // 연쇄 폭발: fuse<=0 인 풍선부터 시작해 물줄기에 닿는 풍선 전파
        loop {
            let Some(start) = self.balloons.iter().position(|b| b.fuse <= 0.0) else {
                break;
            };
            self.explode_chain(start);
        }
    }

    /// start 인덱스 풍선을 기점으로 연쇄 폭발 처리
    fn explode_chain(&mut self, start: usize) {
        let mut queue: Vec<usize> = vec![start];
        let mut exploded: Vec<usize> = Vec::new();
        // (x, y, part) — 이번 연쇄로 생성될 물줄기 셀
        let mut new_streams: Vec<(i32, i32, StreamPart)> = Vec::new();
        let mut broken_blocks: Vec<(i32, i32)> = Vec::new();

        while let Some(bi) = queue.pop() {
            if exploded.contains(&bi) {
                continue;
            }
            exploded.push(bi);
            let (bx, by, range) = {
                let b = &self.balloons[bi];
                (b.x, b.y, b.range)
            };
            self.push_event(EV_EXPLODE, bx as f32 + 0.5, by as f32 + 0.5, range as f32);
            new_streams.push((bx, by, StreamPart::Center));

            for dir in [Dir::Left, Dir::Right, Dir::Up, Dir::Down] {
                let (dx, dy) = dir.delta();
                for dist in 1..=range as i32 {
                    let (cx, cy) = (bx + dx * dist, by + dy * dist);
                    let tile = self.map.tile(cx, cy);
                    if tile == Tile::Hard {
                        break;
                    }
                    let is_end = dist == range as i32;
                    let part = if tile == Tile::Soft || is_end {
                        match dir {
                            Dir::Left => StreamPart::EndL,
                            Dir::Right => StreamPart::EndR,
                            Dir::Up => StreamPart::EndU,
                            Dir::Down => StreamPart::EndD,
                        }
                    } else {
                        match dir {
                            Dir::Left | Dir::Right => StreamPart::HMid,
                            Dir::Up | Dir::Down => StreamPart::VMid,
                        }
                    };

                    if tile == Tile::Soft {
                        // 같은 연쇄에서 여러 물줄기가 같은 블록을 때려도
                        // 파괴/드랍 추첨/이벤트는 칸당 1회만
                        if !broken_blocks.contains(&(cx, cy)) {
                            broken_blocks.push((cx, cy));
                        }
                        new_streams.push((cx, cy, part));
                        break;
                    }

                    // 다른 풍선 → 연쇄. 의도된 규칙: 물줄기는 풍선(같은 연쇄로
                    // 이미 터질 예정인 것 포함)에 항상 막힌다 — 그 칸은 해당
                    // 풍선 자신의 십자가 같은 틱에 덮으므로 판정 공백은 없음.
                    if let Some(other) = self.balloons.iter().position(|b| b.x == cx && b.y == cy) {
                        if !exploded.contains(&other) && !queue.contains(&other) {
                            queue.push(other);
                        }
                        new_streams.push((cx, cy, part));
                        break;
                    }

                    new_streams.push((cx, cy, part));
                }
            }
        }

        // 폭발한 풍선 제거 + 소유자 카운트 반환
        exploded.sort_unstable_by(|a, b| b.cmp(a));
        for bi in exploded {
            let b = self.balloons.swap_remove(bi);
            if let Some(p) = self.players.get_mut(b.owner as usize) {
                p.balloons_used = p.balloons_used.saturating_sub(1);
            }
        }

        // 블록 파괴 + 아이템 드랍
        for (bx, by) in broken_blocks {
            self.map.set_tile(bx, by, Tile::Empty);
            self.push_event(EV_BLOCK_BREAK, bx as f32 + 0.5, by as f32 + 0.5, 0.0);
            if self.rng.chance(ITEM_DROP_RATE) {
                let kind = self.roll_item();
                self.items.push(GroundItem {
                    x: bx,
                    y: by,
                    kind,
                    protect_until: self.elapsed + STREAM_SECS + 0.05,
                });
            }
        }

        // 물줄기 셀 추가 (같은 칸 중복 시 기존 갱신)
        for (sx, sy, part) in new_streams {
            if let Some(existing) = self.streams.iter_mut().find(|s| s.x == sx && s.y == sy) {
                existing.age = 0.0;
                if part == StreamPart::Center {
                    existing.part = StreamPart::Center;
                }
            } else {
                self.streams.push(StreamCell { x: sx, y: sy, part, age: 0.0 });
            }
        }

        // 바닥 아이템 파괴 (보호 시간 지난 것만)
        let elapsed = self.elapsed;
        let stream_cells: Vec<(i32, i32)> = self.streams.iter().map(|s| (s.x, s.y)).collect();
        let mut destroyed: Vec<(f32, f32)> = Vec::new();
        self.items.retain(|it| {
            let hit = stream_cells.contains(&(it.x, it.y)) && elapsed >= it.protect_until;
            if hit {
                destroyed.push((it.x as f32 + 0.5, it.y as f32 + 0.5));
            }
            !hit
        });
        for (x, y) in destroyed {
            self.push_event(EV_ITEM_DESTROYED, x, y, 0.0);
        }
    }

    /// 아이템 종류 가중치 추첨 (블록 드랍·공중 보급 공용)
    fn roll_item(&mut self) -> ItemType {
        let roll = self.rng.next_f32();
        if roll < 0.30 {
            ItemType::BalloonUp
        } else if roll < 0.60 {
            ItemType::RangeUp
        } else if roll < 0.85 {
            ItemType::SpeedUp
        } else if roll < 0.97 {
            ItemType::Needle
        } else {
            ItemType::MaxRange
        }
    }

    /// 아이템 보급: 정해진 시각마다 빈 칸에 아이템을 떨어뜨린다.
    /// 블록이 다 부서진 후반에도 파밍 거리가 남아 게임이 루즈해지지 않게 하는 장치 (원작의 아이템 비행기).
    fn tick_airdrop(&mut self) {
        if self.airdrop_idx >= AIRDROP_TIMES.len()
            || self.time_remaining > AIRDROP_TIMES[self.airdrop_idx]
        {
            return;
        }
        self.airdrop_idx += 1;
        for _ in 0..AIRDROP_COUNT {
            // 후보: 빈 타일 + 풍선/기존 아이템 없는 곳
            let mut candidates: Vec<(i32, i32)> = Vec::new();
            for y in 0..MAP_H as i32 {
                for x in 0..MAP_W as i32 {
                    if self.map.tile(x, y) == Tile::Empty
                        && !self.balloons.iter().any(|b| b.x == x && b.y == y)
                        && !self.items.iter().any(|it| it.x == x && it.y == y)
                    {
                        candidates.push((x, y));
                    }
                }
            }
            if candidates.is_empty() {
                return;
            }
            let (x, y) = candidates[self.rng.next_range(candidates.len() as u32) as usize];
            let kind = self.roll_item();
            self.items.push(GroundItem {
                x,
                y,
                kind,
                // 착지 순간 물줄기에 바로 증발하지 않게 잠깐 보호
                protect_until: self.elapsed + STREAM_SECS + 0.05,
            });
            self.push_event(EV_AIRDROP, x as f32 + 0.5, y as f32 + 0.5, kind.code());
        }
    }

    fn tick_streams(&mut self) {
        for s in &mut self.streams {
            s.age += TICK_DT;
        }
        // 물줄기에 닿은 플레이어 → 갇힘 (판정은 STREAM_HIT_SECS 동안만, 잔상은 시각 효과)
        for i in 0..self.players.len() {
            let p = &self.players[i];
            if p.state != PState::Normal || p.invuln > 0.0 {
                continue;
            }
            let (tx, ty) = p.tile();
            if self
                .streams
                .iter()
                .any(|s| s.x == tx && s.y == ty && s.age < STREAM_HIT_SECS)
            {
                let p = &mut self.players[i];
                p.state = PState::Trapped;
                p.state_timer = TRAPPED_SECS;
                let (x, y, id) = (p.x, p.y, p.id);
                self.push_event(EV_TRAPPED, x, y, id as f32);
            }
        }
        self.streams.retain(|s| s.age < STREAM_SECS);
    }

    fn tick_pickups(&mut self) {
        for i in 0..self.players.len() {
            if self.players[i].state != PState::Normal {
                continue;
            }
            let (px, py) = (self.players[i].x, self.players[i].y);
            let mut picked: Option<(ItemType, f32, f32)> = None;
            self.items.retain(|it| {
                if picked.is_none()
                    && (px - (it.x as f32 + 0.5)).abs() < 0.55
                    && (py - (it.y as f32 + 0.5)).abs() < 0.55
                {
                    picked = Some((it.kind, it.x as f32 + 0.5, it.y as f32 + 0.5));
                    false
                } else {
                    true
                }
            });
            if let Some((kind, ix, iy)) = picked {
                let p = &mut self.players[i];
                match kind {
                    ItemType::BalloonUp => {
                        p.max_balloons = (p.max_balloons + 1).min(p.stats.max_balloons).min(HARD_MAX_BALLOONS)
                    }
                    ItemType::RangeUp => {
                        p.range = (p.range + 1).min(p.stats.max_range).min(HARD_MAX_RANGE)
                    }
                    ItemType::SpeedUp => {
                        p.speed_lv = (p.speed_lv + 1).min(p.stats.max_speed_lv).min(HARD_MAX_SPEED_LV)
                    }
                    ItemType::Needle => p.needles = (p.needles + 1).min(MAX_NEEDLES),
                    ItemType::MaxRange => p.range = p.stats.max_range.min(HARD_MAX_RANGE),
                }
                self.push_event(EV_PICKUP, ix, iy, kind.code());
            }
        }
    }

    /// 갇힌 플레이어: 타이머, 구출/터뜨리기
    fn tick_bubbles(&mut self) {
        // 타이머 만료 → 사망
        for i in 0..self.players.len() {
            if self.players[i].state != PState::Trapped {
                continue;
            }
            self.players[i].state_timer -= TICK_DT;
            if self.players[i].state_timer <= 0.0 {
                self.players[i].state = PState::Dead;
                let (x, y, id) = (self.players[i].x, self.players[i].y, self.players[i].id);
                self.push_event(EV_TIMEOUT_DEATH, x, y, id as f32);
            }
        }
        // 접촉 판정
        for i in 0..self.players.len() {
            if self.players[i].state != PState::Trapped {
                continue;
            }
            for j in 0..self.players.len() {
                if i == j || self.players[j].state != PState::Normal {
                    continue;
                }
                let (dx, dy) = (
                    self.players[i].x - self.players[j].x,
                    self.players[i].y - self.players[j].y,
                );
                if dx * dx + dy * dy > POP_RADIUS * POP_RADIUS {
                    continue;
                }
                let same_team = self.players[i].team == self.players[j].team;
                let (x, y) = (self.players[i].x, self.players[i].y);
                if same_team {
                    self.players[i].state = PState::Normal;
                    self.players[i].state_timer = 0.0;
                    self.players[i].invuln = 1.0;
                    self.push_event(EV_RESCUE, x, y, self.players[i].id as f32);
                } else {
                    self.players[i].state = PState::Dead;
                    self.players[j].kills += 1;
                    self.push_event(EV_POP_DEATH, x, y, self.players[i].id as f32);
                }
                break;
            }
        }
    }

    fn check_end(&mut self) {
        let mut alive_teams: Vec<i32> = self
            .players
            .iter()
            .filter(|p| p.alive())
            .map(|p| p.team)
            .collect();
        alive_teams.sort_unstable();
        alive_teams.dedup();

        let over = if alive_teams.is_empty() {
            self.winner_team = -2;
            true
        } else if alive_teams.len() == 1 && self.players.len() > 1 {
            self.winner_team = alive_teams[0];
            true
        } else if self.time_remaining <= 0.0 {
            self.winner_team = -2;
            true
        } else {
            false
        };

        if over {
            self.phase = Phase::RoundOver;
            self.phase_timer = 0.0;
            self.push_event(EV_ROUND_END, 0.0, 0.0, self.winner_team as f32);
        }
    }

    // ── 스냅샷: JS가 zero-copy로 읽는 패킹 버퍼 ────────────
    pub const HEADER_LEN: usize = 16;
    pub const PLAYER_STRIDE: usize = 16;
    pub const BALLOON_STRIDE: usize = 6;
    pub const STREAM_STRIDE: usize = 4;
    pub const ITEM_STRIDE: usize = 4;
    pub const EVENT_STRIDE: usize = 4;

    /// 스냅샷 버퍼 재구축 후 (ptr, len) 반환용 슬라이스 접근
    pub fn build_snapshot(&mut self) -> &[f32] {
        let buf = &mut self.snapshot_buf;
        buf.clear();
        buf.push(1.0); // version
        buf.push(self.tick_no as f32);
        buf.push(self.phase.code());
        buf.push(match self.phase {
            Phase::Countdown => self.phase_timer,
            _ => self.phase_timer,
        });
        buf.push(self.time_remaining.max(0.0));
        buf.push(MAP_W as f32);
        buf.push(MAP_H as f32);
        buf.push(self.players.len() as f32);
        buf.push(self.balloons.len() as f32);
        buf.push(self.streams.len() as f32);
        buf.push(self.items.len() as f32);
        buf.push(self.events.len() as f32);
        buf.push(self.winner_team as f32);
        buf.push(self.map_id as f32);
        buf.push(0.0);
        buf.push(0.0);
        debug_assert_eq!(buf.len(), Self::HEADER_LEN);

        for t in &self.map.tiles {
            buf.push(t.code());
        }
        for p in &self.players {
            buf.push(p.id as f32);
            buf.push(p.char_type as f32);
            buf.push(p.team as f32);
            buf.push(p.x);
            buf.push(p.y);
            buf.push(p.dir.code());
            buf.push(if p.moving { 1.0 } else { 0.0 });
            buf.push(match p.state {
                PState::Normal => 0.0,
                PState::Trapped => 1.0,
                PState::Dead => 2.0,
            });
            buf.push(p.state_timer);
            buf.push(p.max_balloons as f32);
            buf.push(p.balloons_used as f32);
            buf.push(p.range as f32);
            buf.push(p.speed_lv as f32);
            buf.push(p.needles as f32);
            buf.push(if p.is_bot { 1.0 } else { 0.0 });
            buf.push(p.kills as f32);
        }
        for b in &self.balloons {
            buf.push(b.x as f32 + 0.5);
            buf.push(b.y as f32 + 0.5);
            buf.push(b.owner as f32);
            buf.push((b.fuse / BALLOON_FUSE).clamp(0.0, 1.0));
            buf.push(b.range as f32);
            buf.push(if b.walkthrough.is_empty() { 1.0 } else { 0.0 });
        }
        for s in &self.streams {
            buf.push(s.x as f32 + 0.5);
            buf.push(s.y as f32 + 0.5);
            buf.push(s.part.code());
            buf.push((s.age / STREAM_SECS).clamp(0.0, 1.0));
        }
        for it in &self.items {
            buf.push(it.x as f32 + 0.5);
            buf.push(it.y as f32 + 0.5);
            buf.push(it.kind.code());
            buf.push(0.0);
        }
        for e in &self.events {
            buf.push(e.kind);
            buf.push(e.x);
            buf.push(e.y);
            buf.push(e.data);
        }
        // 계약: 스냅샷을 읽는 쪽이 이벤트를 그 즉시 소비해야 한다 (드레인 방식).
        // JS 루프는 tick 0~N회 후 프레임당 정확히 1회 snapshot을 읽으므로 유실 없음.
        self.events.clear();
        &self.snapshot_buf
    }

    pub fn snapshot_buf_len(&self) -> usize {
        self.snapshot_buf.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Game {
        let mut g = Game::new(123, 0);
        g.add_player(0, 0, false);
        g.add_player(1, 1, false);
        // 카운트다운 스킵
        g.phase = Phase::Playing;
        g
    }

    fn tick_n(g: &mut Game, n: usize) {
        for _ in 0..n {
            g.tick();
        }
    }

    #[test]
    fn balloon_explodes_after_fuse() {
        let mut g = setup();
        // 스폰 지점(빈칸 보장)에서 설치
        g.players[0].x = 0.5;
        g.players[0].y = 0.5;
        g.players[0].input = IN_ACTION;
        g.tick();
        assert_eq!(g.balloons.len(), 1);
        tick_n(&mut g, (BALLOON_FUSE / TICK_DT) as usize + 2);
        assert_eq!(g.balloons.len(), 0);
        assert!(!g.streams.is_empty(), "폭발 후 물줄기가 생성되어야 함");
    }

    #[test]
    fn player_trapped_by_stream_then_dies() {
        let mut g = setup();
        // 플레이어 0이 스폰에 풍선 설치 후 제자리 대기 → 자기 물줄기에 갇힘
        g.players[0].x = 0.5;
        g.players[0].y = 0.5;
        g.players[1].x = 14.5;
        g.players[1].y = 0.5;
        g.players[0].input = IN_ACTION;
        g.tick();
        g.players[0].input = 0;
        tick_n(&mut g, (BALLOON_FUSE / TICK_DT) as usize + 5);
        assert_eq!(g.players[0].state, PState::Trapped);
        // 갇힘 타이머 만료 → 사망 → 상대 승리
        tick_n(&mut g, (TRAPPED_SECS / TICK_DT) as usize + 5);
        assert_eq!(g.players[0].state, PState::Dead);
        assert_eq!(g.phase, Phase::RoundOver);
        assert_eq!(g.winner_team, 1);
    }

    #[test]
    fn enemy_contact_pops_bubble() {
        let mut g = setup();
        g.players[0].state = PState::Trapped;
        g.players[0].state_timer = TRAPPED_SECS;
        g.players[0].x = 5.5;
        g.players[0].y = 1.5;
        g.players[1].x = 5.5;
        g.players[1].y = 1.6;
        g.tick();
        assert_eq!(g.players[0].state, PState::Dead);
        assert_eq!(g.players[1].kills, 1);
    }

    #[test]
    fn ally_contact_rescues_bubble() {
        let mut g = Game::new(99, 0);
        g.add_player(0, 0, false);
        g.add_player(1, 0, false); // 같은 팀
        g.add_player(2, 1, false);
        g.phase = Phase::Playing;
        g.players[0].state = PState::Trapped;
        g.players[0].state_timer = TRAPPED_SECS;
        g.players[0].x = 5.5;
        g.players[0].y = 1.5;
        g.players[1].x = 5.5;
        g.players[1].y = 1.6;
        g.players[2].x = 13.5;
        g.players[2].y = 11.5;
        g.tick();
        assert_eq!(g.players[0].state, PState::Normal);
        assert!(g.players[0].invuln > 0.0);
    }

    #[test]
    fn needle_escapes_bubble() {
        let mut g = setup();
        g.players[0].state = PState::Trapped;
        g.players[0].state_timer = TRAPPED_SECS;
        g.players[0].needles = 1;
        g.players[0].input = IN_ACTION;
        g.tick();
        assert_eq!(g.players[0].state, PState::Normal);
        assert_eq!(g.players[0].needles, 0);
    }

    #[test]
    fn chain_explosion() {
        let mut g = setup();
        // 경로를 빈칸으로 만들고 두 풍선을 십자 범위 내에 배치
        g.map.set_tile(3, 1, Tile::Empty);
        g.map.set_tile(4, 1, Tile::Empty);
        g.balloons.push(Balloon { x: 3, y: 1, owner: 0, fuse: 0.01, range: 2, walkthrough: vec![] });
        g.balloons.push(Balloon { x: 4, y: 1, owner: 1, fuse: 2.0, range: 2, walkthrough: vec![] });
        g.players[0].x = 10.5;
        g.players[0].y = 11.5;
        g.players[1].x = 12.5;
        g.players[1].y = 11.5;
        tick_n(&mut g, 3);
        assert_eq!(g.balloons.len(), 0, "연쇄 폭발로 둘 다 터져야 함");
    }

    #[test]
    fn soft_block_breaks_and_stream_stops() {
        let mut g = setup();
        // (2,1)에 소프트 블록 보장
        g.map.set_tile(2, 1, Tile::Soft);
        g.map.set_tile(3, 1, Tile::Empty);
        g.balloons.push(Balloon { x: 1, y: 1, owner: 0, fuse: 0.01, range: 3, walkthrough: vec![] });
        g.players[0].x = 10.5;
        g.players[0].y = 11.5;
        g.players[1].x = 12.5;
        g.players[1].y = 11.5;
        tick_n(&mut g, 2);
        assert_eq!(g.map.tile(2, 1), Tile::Empty, "소프트 블록 파괴");
        assert!(
            !g.streams.iter().any(|s| s.x == 3 && s.y == 1),
            "물줄기는 소프트 블록에서 멈춰야 함"
        );
    }

    #[test]
    fn balloon_blocks_movement_after_leaving() {
        let mut g = setup();
        g.players[0].x = 0.5;
        g.players[0].y = 0.5;
        g.players[0].input = IN_ACTION;
        g.tick();
        // 설치 직후엔 통과 가능
        assert!(!g.solid_for(0, 0, 0));
        // 타일에서 벗어나면 솔리드
        g.players[0].input = 0;
        g.players[0].x = 3.5;
        g.players[0].y = 0.5; // 멀리 이동했다고 가정
        g.tick();
        assert!(g.solid_for(0, 0, 0));
    }

    #[test]
    fn snapshot_layout_consistent() {
        let mut g = setup();
        tick_n(&mut g, 10);
        let n_players = g.players.len();
        let n_balloons = g.balloons.len();
        let n_streams = g.streams.len();
        let n_items = g.items.len();
        let n_events = g.events.len();
        let snap = g.build_snapshot();
        let expected = Game::HEADER_LEN
            + MAP_W * MAP_H
            + n_players * Game::PLAYER_STRIDE
            + n_balloons * Game::BALLOON_STRIDE
            + n_streams * Game::STREAM_STRIDE
            + n_items * Game::ITEM_STRIDE
            + n_events * Game::EVENT_STRIDE;
        assert_eq!(snap.len(), expected);
        assert_eq!(snap[7] as usize, n_players);
    }

    #[test]
    fn corner_clip_slides_around_hard_block() {
        // 리뷰 확정 버그 회귀: |frac| ∈ (0.14, 0.28) 데드존에서 모서리에 영구 끼임.
        // (2,0)만 막힌 상태에서 행 1을 따라 오른쪽 이동 — 모서리 클립을 흘려보내야 함.
        let mut g = setup();
        for y in 0..MAP_H as i32 {
            for x in 0..MAP_W as i32 {
                g.map.set_tile(x, y, Tile::Empty);
            }
        }
        g.map.set_tile(2, 0, Tile::Hard);
        g.players[0].x = 1.5;
        g.players[0].y = 1.3; // frac = -0.2 (데드존 한가운데)
        g.players[1].x = 13.5;
        g.players[1].y = 11.5;
        g.players[0].input = IN_RIGHT;
        tick_n(&mut g, 120); // 2초
        assert!(
            g.players[0].x > 3.0,
            "코너 클립에서 미끄러져 전진해야 함 (x={})",
            g.players[0].x
        );
    }

    #[test]
    fn corner_assist_detour_converges() {
        // 중심 셀이 막혔고 충분히 치우친 경우: 열린 행으로 우회가 끝까지 수렴해야 함
        let mut g = setup();
        for y in 0..MAP_H as i32 {
            for x in 0..MAP_W as i32 {
                g.map.set_tile(x, y, Tile::Empty);
            }
        }
        g.map.set_tile(2, 1, Tile::Hard); // 진행 방향 중심 셀 막힘
        g.players[0].x = 1.5;
        g.players[0].y = 1.1; // frac=-0.4 → 위(행 0)로 우회해야 함
        g.players[1].x = 13.5;
        g.players[1].y = 11.5;
        g.players[0].input = IN_RIGHT;
        tick_n(&mut g, 180); // 3초
        assert!(
            g.players[0].x > 3.0,
            "우회가 경계에서 멈추지 않고 수렴해야 함 (x={}, y={})",
            g.players[0].x,
            g.players[0].y
        );
    }

    #[test]
    fn chain_explosion_breaks_block_once() {
        // 리뷰 확정 버그 회귀: 한 연쇄에서 같은 소프트 블록을 두 방향이 때려도
        // 파괴 이벤트/드랍 추첨은 1회만
        let mut g = setup();
        for y in 0..MAP_H as i32 {
            for x in 0..MAP_W as i32 {
                g.map.set_tile(x, y, Tile::Empty);
            }
        }
        g.map.set_tile(3, 1, Tile::Soft);
        g.players[0].x = 12.5;
        g.players[0].y = 11.5;
        g.players[1].x = 13.5;
        g.players[1].y = 11.5;
        // L자 연쇄: A(1,1)→(3,1) 좌측 타격, A→B(1,3) 연쇄, B→C(3,3) 연쇄, C→(3,1) 하단 타격
        g.balloons.push(Balloon { x: 1, y: 1, owner: 0, fuse: 0.01, range: 2, walkthrough: vec![] });
        g.balloons.push(Balloon { x: 1, y: 3, owner: 0, fuse: 3.0, range: 2, walkthrough: vec![] });
        g.balloons.push(Balloon { x: 3, y: 3, owner: 0, fuse: 3.0, range: 2, walkthrough: vec![] });
        g.players[0].max_balloons = 5;
        g.players[0].balloons_used = 3;
        tick_n(&mut g, 2);
        let breaks = g
            .events
            .iter()
            .filter(|e| e.kind == EV_BLOCK_BREAK && e.x == 3.5 && e.y == 1.5)
            .count();
        assert_eq!(breaks, 1, "같은 블록 파괴 이벤트는 1회여야 함");
        assert!(g.items.len() <= 1, "같은 칸에 아이템이 2개 쌓이면 안 됨");
    }

    #[test]
    fn airdrop_spawns_items_on_schedule() {
        let mut g = setup();
        g.players[0].x = 0.5;
        g.players[0].y = 0.5;
        g.players[1].x = 14.5;
        g.players[1].y = 0.5;
        // 첫 보급 직전으로 시간 이동 → 1초 진행하면 보급 발생
        g.time_remaining = AIRDROP_TIMES[0] + 0.5;
        let before = g.items.len();
        tick_n(&mut g, 60);
        assert_eq!(g.items.len(), before + AIRDROP_COUNT, "보급 아이템 2개 등장");
        assert!(
            g.events.iter().filter(|e| e.kind == EV_AIRDROP).count() == AIRDROP_COUNT,
            "보급 이벤트 발생"
        );
        // 같은 시각에 중복 발동하지 않음
        tick_n(&mut g, 60);
        assert_eq!(g.items.len(), before + AIRDROP_COUNT);

        // 다음 시각 도달 시 또 보급
        g.time_remaining = AIRDROP_TIMES[1] + 0.5;
        tick_n(&mut g, 60);
        assert_eq!(g.items.len(), before + AIRDROP_COUNT * 2);
    }

    #[test]
    fn airdrop_lands_on_empty_walkable_cells() {
        let mut g = setup();
        g.players[0].x = 0.5;
        g.players[0].y = 0.5;
        g.players[1].x = 14.5;
        g.players[1].y = 0.5;
        g.time_remaining = AIRDROP_TIMES[0] + 0.5;
        tick_n(&mut g, 60);
        for it in &g.items {
            assert_eq!(g.map.tile(it.x, it.y), Tile::Empty, "보급은 빈 칸에만");
        }
    }

    #[test]
    fn timeout_is_draw() {
        let mut g = setup();
        g.time_remaining = 0.05;
        tick_n(&mut g, 10);
        assert_eq!(g.phase, Phase::RoundOver);
        assert_eq!(g.winner_team, -2);
    }
}
