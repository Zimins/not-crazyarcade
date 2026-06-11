//! 타일 맵: 레이아웃 정의와 파싱.
//!
//! 레이아웃 문자: '.'=빈칸, 's'=소프트 블록, '?'=50% 확률 소프트, 'H'=하드 블록,
//! '1'~'6'=스폰 지점(빈칸) — 1~4 코너, 5~6 좌우 중앙 (6인 방 지원)

use crate::constants::{MAP_H, MAP_W};
use crate::rng::Rng;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tile {
    Empty,
    Soft,
    Hard,
}

impl Tile {
    pub fn code(self) -> f32 {
        match self {
            Tile::Empty => 0.0,
            Tile::Soft => 1.0,
            Tile::Hard => 2.0,
        }
    }

    pub fn is_solid(self) -> bool {
        !matches!(self, Tile::Empty)
    }
}

pub const MAX_SPAWNS: usize = 6;

pub struct GameMap {
    pub tiles: Vec<Tile>,
    pub spawns: [(f32, f32); MAX_SPAWNS],
}

impl GameMap {
    pub fn idx(x: usize, y: usize) -> usize {
        y * MAP_W + x
    }

    pub fn tile(&self, x: i32, y: i32) -> Tile {
        if x < 0 || y < 0 || x >= MAP_W as i32 || y >= MAP_H as i32 {
            return Tile::Hard;
        }
        self.tiles[Self::idx(x as usize, y as usize)]
    }

    pub fn set_tile(&mut self, x: i32, y: i32, t: Tile) {
        if x >= 0 && y >= 0 && x < MAP_W as i32 && y < MAP_H as i32 {
            self.tiles[Self::idx(x as usize, y as usize)] = t;
        }
    }

    pub fn from_layout(layout: &[&str], rng: &mut Rng) -> Self {
        assert_eq!(layout.len(), MAP_H, "layout height must be {}", MAP_H);
        let mut tiles = vec![Tile::Empty; MAP_W * MAP_H];
        let mut spawns = [(1.5, 1.5); MAX_SPAWNS];
        for (y, row) in layout.iter().enumerate() {
            let chars: Vec<char> = row.chars().collect();
            assert_eq!(chars.len(), MAP_W, "layout row {} width must be {}", y, MAP_W);
            for (x, ch) in chars.iter().enumerate() {
                let t = match ch {
                    '.' => Tile::Empty,
                    's' => Tile::Soft,
                    '?' => {
                        if rng.chance(0.5) {
                            Tile::Soft
                        } else {
                            Tile::Empty
                        }
                    }
                    'H' => Tile::Hard,
                    '1'..='6' => {
                        let i = (*ch as u8 - b'1') as usize;
                        spawns[i] = (x as f32 + 0.5, y as f32 + 0.5);
                        Tile::Empty
                    }
                    _ => panic!("unknown layout char {ch}"),
                };
                tiles[Self::idx(x, y)] = t;
            }
        }
        Self { tiles, spawns }
    }

    pub fn by_id(map_id: u32, rng: &mut Rng) -> Self {
        let layout = match map_id % 3 {
            0 => &FOREST,
            1 => &FACTORY,
            _ => &ICE,
        };
        Self::from_layout(layout, rng)
    }
}

/// 맵 0: 숲 — 대칭 클래식 배치 (5·6 = 좌우 중앙 스폰)
pub const FOREST: [&str; 13] = [
    "1.sss.s.sss..2.",
    ".Hs?Hs?s?Hs?H..",
    "ss.ss?s.s?ss.ss",
    "s?H.s.H.H.s.H?s",
    "ss.ss?.s.?ss.ss",
    ".?s.H?sss?H.s?.",
    "5.ss.s?H?s.ss.6",
    ".?s.H?sss?H.s?.",
    "ss.ss?.s.?ss.ss",
    "s?H.s.H.H.s.H?s",
    "ss.ss?s.s?ss.ss",
    "..H?sH?s?sH?sH.",
    "3.sss.s.sss..4.",
];

/// 맵 1: 공장 — 중앙 십자 통로와 하드 블록 라인
pub const FACTORY: [&str; 13] = [
    "1..ss.s.s.ss..2",
    ".HH.s?.s.?s.HH.",
    ".H?ss.sss.ss?H.",
    "s.s.H?.s.?H.s.s",
    "s?s.?ss.ss?.s?s",
    ".s.Hs.s?s.sH.s.",
    "5s?.ss?H?ss.?s6",
    ".s.Hs.s?s.sH.s.",
    "s?s.?ss.ss?.s?s",
    "s.s.H?.s.?H.s.s",
    ".H?ss.sss.ss?H.",
    ".HH.s?.s.?s.HH.",
    "3..ss.s.s.ss..4",
];

/// 맵 2: 얼음 — 트인 중앙, 가장자리 위주 블록
pub const ICE: [&str; 13] = [
    "1.ss?s...s?ss.2",
    ".H.s.H?s?H.s.H.",
    "ss.?s.....s?.ss",
    "?s.H..sss..H.s?",
    "s.?.s?s.s?s.?.s",
    ".Hs..s...s..sH.",
    "5.s.ss.H.ss.s.6",
    ".Hs..s...s..sH.",
    "s.?.s?s.s?s.?.s",
    "?s.H..sss..H.s?",
    "ss.?s.....s?.ss",
    ".H.s.H?s?H.s.H.",
    "3.ss?s...s?ss.4",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layouts_parse_and_have_spawns() {
        for id in 0..3 {
            let mut rng = Rng::new(42 + id as u64);
            let map = GameMap::by_id(id, &mut rng);
            assert_eq!(map.tiles.len(), MAP_W * MAP_H);
            // 스폰 지점은 모두 서로 달라야 하고 빈칸이어야 함
            for (i, &(sx, sy)) in map.spawns.iter().enumerate() {
                let (tx, ty) = (sx as i32, sy as i32);
                assert_eq!(map.tile(tx, ty), Tile::Empty, "spawn {i} on map {id} not empty");
            }
        }
    }

    #[test]
    fn spawn_corners_are_clear_of_soft_neighbors_blocking_escape() {
        // 스폰 인접 4칸 중 최소 1칸은 항상 통행 가능해야 함 ('?'가 전부 soft여도)
        for id in 0..3 {
            let mut rng = Rng::new(7);
            let map = GameMap::by_id(id, &mut rng);
            for &(sx, sy) in map.spawns.iter() {
                let (tx, ty) = (sx as i32, sy as i32);
                let open = [(1, 0), (-1, 0), (0, 1), (0, -1)]
                    .iter()
                    .any(|(dx, dy)| !map.tile(tx + dx, ty + dy).is_solid());
                assert!(open, "spawn ({tx},{ty}) on map {id} is sealed");
            }
        }
    }
}
