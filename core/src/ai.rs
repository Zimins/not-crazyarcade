//! 봇 AI: 위험 지도 + 위험 인지 BFS 길찾기.
//!
//! 우선순위: 생존(위험 회피) > 갇힌 적 터뜨리기 > 아군 구출 > 아이템 > 블록 파괴/적 압박
//!
//! 핵심 원칙: 모든 이동 경로는 "경유지"의 위험까지 고려한다. 목적지만 안전한
//! 경로(폭발 예정 십자를 관통하는 경로)는 선택하지 않는다.

use crate::constants::*;
use crate::game::{Game, PState, IN_ACTION, IN_DOWN, IN_LEFT, IN_RIGHT, IN_UP};
use crate::map::Tile;

const INF: f32 = 1e9;

fn idx(x: i32, y: i32) -> usize {
    (y as usize) * MAP_W + x as usize
}

/// 각 셀이 물에 덮이기까지 남은 시간 (0=지금 위험, INF=안전)
fn danger_map(g: &Game) -> Vec<f32> {
    let mut danger = vec![INF; MAP_W * MAP_H];

    // 활성 물줄기 = 즉시 위험
    for s in &g.streams {
        if s.x >= 0 && s.y >= 0 && s.x < MAP_W as i32 && s.y < MAP_H as i32 {
            danger[idx(s.x, s.y)] = 0.0;
        }
    }

    // 풍선 십자 범위: fuse 시간 후 위험. 연쇄는 2패스로 근사.
    let mut fuses: Vec<(i32, i32, u32, f32)> = g
        .balloons
        .iter()
        .map(|b| (b.x, b.y, b.range, b.fuse))
        .collect();
    for _pass in 0..2 {
        let snapshot = fuses.clone();
        for (bx, by, _r, fuse) in fuses.iter_mut() {
            for (ox, oy, or_, ofuse) in &snapshot {
                if ofuse >= fuse {
                    continue;
                }
                let in_cross = (*bx == *ox && (by.abs_diff(*oy)) <= *or_)
                    || (*by == *oy && (bx.abs_diff(*ox)) <= *or_);
                if in_cross {
                    *fuse = *ofuse;
                }
            }
        }
    }
    for (bx, by, range, fuse) in fuses {
        mark_cross(g, &mut danger, bx, by, range, fuse);
    }
    danger
}

/// (bx,by) 중심 십자를 danger 지도에 min-기록 (하드 블록에 막히고 소프트에서 정지)
fn mark_cross(g: &Game, danger: &mut [f32], bx: i32, by: i32, range: u32, fuse: f32) {
    let mut mark = |x: i32, y: i32| {
        if x >= 0 && y >= 0 && x < MAP_W as i32 && y < MAP_H as i32 {
            let i = idx(x, y);
            if fuse < danger[i] {
                danger[i] = fuse;
            }
        }
    };
    mark(bx, by);
    for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
        for d in 1..=range as i32 {
            let (cx, cy) = (bx + dx * d, by + dy * d);
            let t = g.map.tile(cx, cy);
            if t == Tile::Hard {
                break;
            }
            mark(cx, cy);
            if t == Tile::Soft {
                break;
            }
        }
    }
}

struct Paths {
    dist: Vec<i32>,
    first_step: Vec<u8>,
}

/// 위험 인지 BFS.
/// 셀 진입 허용 조건: 통행 가능 ∧ (danger == INF ∨ danger > 도착예상시간 + margin).
/// strict=true 면 위험 셀(danger < INF)은 아예 경유 금지 (목표 이동용).
/// strict=false 면 "터지기 전에 지나갈 수 있는" 셀 경유 허용 (탈출용).
fn bfs_aware(
    g: &Game,
    pid: u32,
    sx: i32,
    sy: i32,
    danger: &[f32],
    speed: f32,
    strict: bool,
) -> Paths {
    let mut dist = vec![-1; MAP_W * MAP_H];
    let mut first = vec![0u8; MAP_W * MAP_H];
    let mut queue = std::collections::VecDeque::new();
    if sx < 0 || sy < 0 || sx >= MAP_W as i32 || sy >= MAP_H as i32 {
        return Paths { dist, first_step: first };
    }
    let step_time = 1.0 / speed.max(0.5);
    dist[idx(sx, sy)] = 0;
    queue.push_back((sx, sy));
    while let Some((cx, cy)) = queue.pop_front() {
        let d = dist[idx(cx, cy)];
        let f = first[idx(cx, cy)];
        for (dx, dy, input) in [(1, 0, IN_RIGHT), (-1, 0, IN_LEFT), (0, 1, IN_DOWN), (0, -1, IN_UP)] {
            let (nx, ny) = (cx + dx, cy + dy);
            if nx < 0 || ny < 0 || nx >= MAP_W as i32 || ny >= MAP_H as i32 {
                continue;
            }
            let ni = idx(nx, ny);
            if dist[ni] >= 0 || g.solid_for(nx, ny, pid) {
                continue;
            }
            let cell_danger = danger[ni];
            let arrival = (d + 1) as f32 * step_time;
            let passable = if strict {
                cell_danger >= INF
            } else {
                // 터지기 0.35초 이상 전에 빠져나갈 수 있으면 경유 허용
                cell_danger >= INF || cell_danger > arrival + 0.35
            };
            if !passable {
                continue;
            }
            dist[ni] = d + 1;
            first[ni] = if d == 0 { input } else { f };
            queue.push_back((nx, ny));
        }
    }
    Paths { dist, first_step: first }
}

/// 가장 가까운 "안전 셀(danger INF)"로의 첫 스텝
fn escape_step(g: &Game, pid: u32, sx: i32, sy: i32, danger: &[f32], speed: f32) -> Option<u8> {
    let paths = bfs_aware(g, pid, sx, sy, danger, speed, false);
    let mut best: Option<(i32, u8)> = None;
    for y in 0..MAP_H as i32 {
        for x in 0..MAP_W as i32 {
            let ii = idx(x, y);
            if paths.dist[ii] >= 0 && danger[ii] >= INF {
                if best.map_or(true, |(bd, _)| paths.dist[ii] < bd) {
                    best = Some((paths.dist[ii], paths.first_step[ii]));
                }
            }
        }
    }
    best.map(|(_, step)| step)
}

/// (bx,by) 풍선의 십자(range)가 (tx,ty)를 덮는지 — 블록·다른 풍선에 막힘
fn cross_covers(g: &Game, bx: i32, by: i32, range: u32, tx: i32, ty: i32) -> bool {
    if (bx != tx && by != ty) || (bx == tx && by == ty) {
        return false;
    }
    if (tx - bx).abs() + (ty - by).abs() > range as i32 {
        return false;
    }
    let (dx, dy) = ((tx - bx).signum(), (ty - by).signum());
    let (mut cx, mut cy) = (bx, by);
    loop {
        cx += dx;
        cy += dy;
        if cx == tx && cy == ty {
            return true;
        }
        if g.map.tile(cx, cy) != Tile::Empty {
            return false;
        }
        if g.balloons.iter().any(|b| b.x == cx && b.y == cy) {
            return false;
        }
    }
}

/// (cx,cy)에 풍선을 놓았다고 가정할 때 그 자리에서 탈출로가 있는지.
/// 경로로 이어지는 기존 풍선이 있으면 타이머가 동기화되므로(코어 규칙)
/// 새 풍선의 실효 퓨즈를 그 최소값으로 가정한다 — 봇의 자폭 방지.
fn can_place_at(g: &Game, pid: u32, range: u32, speed: f32, cx: i32, cy: i32, danger: &[f32]) -> bool {
    let mut fuse = BALLOON_FUSE;
    for b in &g.balloons {
        let linked = cross_covers(g, cx, cy, range, b.x, b.y)
            || cross_covers(g, b.x, b.y, b.range, cx, cy);
        if linked && b.fuse < fuse {
            fuse = b.fuse;
        }
    }
    let mut danger2 = danger.to_vec();
    mark_cross(g, &mut danger2, cx, cy, range, fuse);
    escape_step(g, pid, cx, cy, &danger2, speed).is_some()
}

/// 현재 위치에 풍선을 놓아도 탈출로가 있는지
fn safe_to_place(g: &Game, i: usize, danger: &[f32]) -> bool {
    let p = &g.players[i];
    let (bx, by) = p.tile();
    can_place_at(g, p.id, p.range, p.speed(), bx, by, danger)
}

// (이전의 수직 정렬 보정 steer()는 제거됨 — 사고주기당 이동량(speed×0.12s ≈ 0.5타일)이
// 정렬 데드존(±0.12)보다 커서 2-사이클 진동 교착을 일으켰다. 타일 중심 정렬은
// move_axis의 코너 슬라이딩 "중심 끌어당김"이 물리 단에서 처리한다.)

pub fn think(g: &Game, i: usize) -> u8 {
    let p = &g.players[i];

    // 갇혔으면: 바늘 시도 (ACTION은 엣지 트리거라 펄스로 눌러야 함)
    if p.state == PState::Trapped {
        return if (g.tick_no / 6) % 2 == 0 { IN_ACTION } else { 0 };
    }

    let danger = danger_map(g);
    let (px, py) = p.tile();
    let my_danger = danger[idx(px, py)];
    let speed = p.speed();

    // 1) 지금 위치가 위험 → 탈출 (경유지 위험 고려)
    if my_danger < INF {
        if let Some(step) = escape_step(g, p.id, px, py, &danger, speed) {
            return step;
        }
        // 안전 셀 없음: 위험이 가장 늦게 오는 인접 셀로
        let loose = bfs_aware(g, p.id, px, py, &danger, speed, false);
        let mut best_t = my_danger;
        let mut step = 0u8;
        for y in 0..MAP_H as i32 {
            for x in 0..MAP_W as i32 {
                let ii = idx(x, y);
                if loose.dist[ii] >= 0 && loose.dist[ii] <= 3 && danger[ii] > best_t {
                    best_t = danger[ii];
                    step = loose.first_step[ii];
                }
            }
        }
        return step;
    }

    // 안전한 경로만 사용하는 목표 이동 (위험 셀 경유 금지)
    let paths = bfs_aware(g, p.id, px, py, &danger, speed, true);

    // 2) 갇힌 적 터뜨리기 / 아군 구출 (가까우면)
    let mut target_step: Option<(i32, u8)> = None;
    for q in &g.players {
        if q.id == p.id || q.state != PState::Trapped {
            continue;
        }
        let (qx, qy) = q.tile();
        let ii = idx(qx, qy);
        if paths.dist[ii] >= 0 && paths.dist[ii] <= 8 {
            let d = paths.dist[ii];
            if target_step.map_or(true, |(bd, _)| d < bd) {
                target_step = Some((d, paths.first_step[ii]));
            }
        }
    }
    if let Some((d, step)) = target_step {
        if d == 0 {
            return 0; // 이미 접촉 중
        }
        return step;
    }

    // 3) 아이템 줍기
    let mut item_step: Option<(i32, u8)> = None;
    for it in &g.items {
        let ii = idx(it.x, it.y);
        if paths.dist[ii] >= 0 {
            let d = paths.dist[ii];
            if item_step.map_or(true, |(bd, _)| d < bd) {
                item_step = Some((d, paths.first_step[ii]));
            }
        }
    }
    if let Some((d, step)) = item_step {
        if d > 0 {
            return step;
        }
        return 0;
    }

    let can_place = p.balloons_used < p.max_balloons;

    // 4) 적이 같은 행/열 & 사거리 내, 또는 근접(맨해튼 3 이내) → 풍선 설치
    if can_place {
        for q in &g.players {
            if q.id == p.id || !q.alive() || q.team == p.team {
                continue;
            }
            let (qx, qy) = q.tile();
            let aligned = (qx == px && qy.abs_diff(py) <= p.range)
                || (qy == py && qx.abs_diff(px) <= p.range);
            let close = qx.abs_diff(px) + qy.abs_diff(py) <= 3;
            if (aligned || close) && safe_to_place(g, i, &danger) {
                return IN_ACTION;
            }
        }
    }

    // 5) 소프트 블록 인접이면서 "설치 후 탈출 가능"한 셀로 이동 → 설치
    //    (설치 불가능한 코너 포켓에 도착해 얼어붙는 것을 방지: 설치 지점 자체를 계획)
    if can_place {
        let mut candidates: Vec<(i32, i32, i32)> = Vec::new(); // (dist, x, y)
        for y in 0..MAP_H as i32 {
            for x in 0..MAP_W as i32 {
                let ii = idx(x, y);
                if paths.dist[ii] < 0 {
                    continue;
                }
                let near_soft = [(1, 0), (-1, 0), (0, 1), (0, -1)]
                    .iter()
                    .any(|(dx, dy)| g.map.tile(x + dx, y + dy) == Tile::Soft);
                if near_soft {
                    candidates.push((paths.dist[ii], x, y));
                }
            }
        }
        candidates.sort_unstable();
        // 가까운 후보부터 "그 자리에서 놓고 도망갈 수 있는" 첫 지점 선택
        for &(d, x, y) in candidates.iter().take(24) {
            if !can_place_at(g, p.id, p.range, p.speed(), x, y, &danger) {
                continue;
            }
            if d == 0 {
                return IN_ACTION;
            }
            return paths.first_step[idx(x, y)];
        }
    }

    // 6) 적에게 접근
    let mut chase: Option<(i32, u8)> = None;
    for q in &g.players {
        if q.id == p.id || !q.alive() || q.team == p.team {
            continue;
        }
        let (qx, qy) = q.tile();
        let ii = idx(qx, qy);
        if paths.dist[ii] >= 1 {
            let d = paths.dist[ii];
            if chase.map_or(true, |(bd, _)| d < bd) {
                chase = Some((d, paths.first_step[ii]));
            }
        }
    }
    if let Some((_, step)) = chase {
        return step;
    }

    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::{Balloon, Game, Phase};

    #[test]
    fn bot_flees_from_balloon() {
        let mut g = Game::new(5, 0);
        g.add_player(0, 0, true);
        g.add_player(1, 1, false);
        g.phase = Phase::Playing;
        g.players[0].x = 1.5;
        g.players[0].y = 1.5;
        g.players[1].x = 13.5;
        g.players[1].y = 11.5;
        g.balloons.push(Balloon { x: 1, y: 1, owner: 1, fuse: 2.5, range: 2, walkthrough: vec![0] });
        let input = think(&g, 0);
        assert_ne!(input, 0, "위험 지역에서 봇은 이동해야 함");
        assert_eq!(input & IN_ACTION, 0, "도주 중 풍선 설치 금지");
    }

    #[test]
    fn bot_survives_a_long_match() {
        // 봇 4마리를 30초 돌려도 패닉 없이 시뮬레이션 유지
        let mut g = Game::new(777, 1);
        for t in 0..4 {
            g.add_player(t, t as i32, true);
        }
        g.phase = Phase::Playing;
        for _ in 0..(30.0 / crate::constants::TICK_DT) as usize {
            g.tick();
            if g.phase == Phase::RoundOver {
                break;
            }
        }
    }

    /// 6인 방(멀티플레이 정원) 시뮬레이션 안정성 — 스폰 6개 전부 사용
    #[test]
    fn six_player_match_is_stable() {
        for map_id in 0..3 {
            let mut g = Game::new(99 + map_id as u64, map_id);
            for t in 0..6 {
                g.add_player(t % 4, t as i32, true);
            }
            // 스폰이 서로 달라야 함
            for a in 0..6 {
                for b in (a + 1)..6 {
                    let pa = (g.players[a].x, g.players[a].y);
                    let pb = (g.players[b].x, g.players[b].y);
                    assert_ne!(pa, pb, "map {map_id}: 스폰 {a}/{b} 겹침");
                }
            }
            g.phase = Phase::Playing;
            for _ in 0..(30.0 / crate::constants::TICK_DT) as usize {
                g.tick();
                if g.phase == Phase::RoundOver {
                    break;
                }
            }
        }
    }

    /// 리뷰 확정 버그 회귀: 정렬 진동 교착 — 비정렬 상태에서도 아이템에 도달해야 함
    #[test]
    fn bot_reaches_misaligned_item() {
        use crate::game::{GroundItem, ItemType};
        use crate::map::Tile;
        let mut g = Game::new(11, 0);
        g.add_player(0, 0, true);
        g.add_player(1, 1, false);
        g.phase = Phase::Playing;
        for y in 0..crate::constants::MAP_H as i32 {
            for x in 0..crate::constants::MAP_W as i32 {
                g.map.set_tile(x, y, Tile::Empty);
            }
        }
        g.map.set_tile(3, 7, Tile::Hard); // 경로 중간에 모서리 클립 유발
        g.players[0].x = 1.5;
        g.players[0].y = 6.8; // 비정렬 시작
        g.players[1].x = 13.5;
        g.players[1].y = 1.5;
        g.items.push(GroundItem { x: 5, y: 6, kind: ItemType::Needle, protect_until: 0.0 });
        for _ in 0..(10.0 / crate::constants::TICK_DT) as usize {
            g.tick();
            if g.items.is_empty() {
                break;
            }
        }
        assert!(
            g.items.is_empty(),
            "봇이 진동 없이 아이템에 도달해야 함 (pos=({:.2},{:.2}))",
            g.players[0].x,
            g.players[0].y
        );
    }

    /// 봇 혼자 두면 (적이 멀리 있어도) 최소 20초는 자멸하지 않아야 한다
    #[test]
    fn bots_do_not_suicide_early() {
        for seed in [777u64, 123, 42, 9999, 31337] {
            for map_id in 0..3 {
                let mut g = Game::new(seed, map_id);
                for t in 0..4 {
                    g.add_player(t, t as i32, true);
                }
                g.phase = Phase::Playing;
                let mut first_death_tick = None;
                for tick in 0..(20.0 / crate::constants::TICK_DT) as usize {
                    g.tick();
                    let alive = g.players.iter().filter(|p| p.alive()).count();
                    if alive < 4 {
                        first_death_tick = Some(tick as f32 * crate::constants::TICK_DT);
                        break;
                    }
                }
                if let Some(t) = first_death_tick {
                    assert!(
                        t >= 12.0,
                        "seed={seed} map={map_id}: 봇이 {t:.1}초 만에 죽음 (자멸 가능성)"
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod diag_tests {
    use crate::constants::TICK_DT;
    use crate::game::{Game, Phase};

    #[test]
    fn diag_bot_match_timeline() {
        for seed in [777u64, 123, 42] {
            let mut g = Game::new(seed, 0);
            for t in 0..4 {
                g.add_player(t, t as i32, true);
            }
            g.phase = Phase::Playing;
            let mut last_alive = 4;
            for tick in 0..(120.0 / TICK_DT) as usize {
                g.tick();
                let alive = g.players.iter().filter(|p| p.alive()).count();
                if alive != last_alive {
                    let secs = tick as f32 * TICK_DT;
                    let states: Vec<String> = g
                        .players
                        .iter()
                        .map(|p| format!("p{}({:?})", p.id, p.state))
                        .collect();
                    println!(
                        "seed={seed} t={secs:.1}s alive {last_alive}->{alive}: {}",
                        states.join(" ")
                    );
                    last_alive = alive;
                }
                if g.phase == Phase::RoundOver {
                    println!(
                        "seed={seed} round over at t={:.1}s winner={}",
                        tick as f32 * TICK_DT,
                        g.winner_team
                    );
                    break;
                }
            }
        }
    }
}
