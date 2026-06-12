//! 게임 밸런스 상수. 원작 크레이지 아케이드의 체감을 따르되 수치는 자체 튜닝값.

/// 시뮬레이션 고정 타임스텝 (초)
pub const TICK_DT: f32 = 1.0 / 60.0;

pub const MAP_W: usize = 15;
pub const MAP_H: usize = 13;

/// 라운드 시작 카운트다운 (초)
pub const COUNTDOWN_SECS: f32 = 3.0;
/// 라운드 제한 시간 (초)
pub const ROUND_SECS: f32 = 180.0;

/// 플레이어 충돌 박스 반폭 (타일 단위)
pub const PLAYER_HALF: f32 = 0.36;
/// 코너 슬라이딩 보정 임계값 (타일 중심에서의 수직 오프셋)
pub const CORNER_ASSIST: f32 = 0.28;

/// 물풍선 폭발까지 시간 (초) — 원작 통용치 약 3초
pub const BALLOON_FUSE: f32 = 3.0;
/// 물줄기 시각 지속 시간 (초) — 셀이 화면에 남는 시간
pub const STREAM_SECS: f32 = 0.5;
/// 물줄기 피격 판정 시간 (초) — 이 시간 안에 닿아야 갇힘 (원작 ~0.2초)
pub const STREAM_HIT_SECS: f32 = 0.2;
/// 한 칸당 물줄기 전파 지연 없음(즉시 십자 전개) — 원작 방식

/// 물방울(갇힘) 지속 시간 (초). 시간 내 탈출 실패 시 사망. (원작 통용치 ~5초)
pub const TRAPPED_SECS: f32 = 5.0;
/// 갇힌 상태 이동 속도 (타일/초) — 원작은 "아주 천천히"
pub const TRAPPED_SPEED: f32 = 0.5;
/// 구출/터뜨리기 접촉 판정 거리 (타일)
pub const POP_RADIUS: f32 = 0.7;

/// 속도 단계(1~10 스케일) → 타일/초 변환: BASE + level * STEP. 일반 캐릭터 기본 5.
pub const SPEED_BASE: f32 = 2.0;
pub const SPEED_STEP: f32 = 0.4;

/// 아이템 드랍 확률 (소프트 블록 파괴 시, 원작 비공개 — 자체 밸런싱)
pub const ITEM_DROP_RATE: f32 = 0.40;
/// 바늘 최대 소지 수
pub const MAX_NEEDLES: u32 = 3;

/// 시스템 전역 상한 (1~10 스케일, 캐릭터별 상한과 별개)
pub const HARD_MAX_BALLOONS: u32 = 10;
pub const HARD_MAX_RANGE: u32 = 9;
pub const HARD_MAX_SPEED_LV: u32 = 10;

/// 봇 AI 사고 주기 (초)
pub const AI_THINK_INTERVAL: f32 = 0.12;

/// 아이템 보급 시각 (남은 시간 기준, 초) — 원작 아이템 비행기 타이밍 차용.
/// 블록이 다 부서진 후반에도 아이템이 계속 등장해 루즈해지지 않게 한다.
pub const AIRDROP_TIMES: [f32; 6] = [119.0, 96.0, 74.0, 51.0, 29.0, 7.0];
/// 보급 회당 아이템 수
pub const AIRDROP_COUNT: usize = 2;
