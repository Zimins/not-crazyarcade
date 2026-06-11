-- Migration: 초기 스키마 (익명 유저 + 전적)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  -- 익명 로그인 = 'guest'. 추후 OAuth 연동 시 'google'/'github' + provider_id 채움
  provider TEXT NOT NULL DEFAULT 'guest',
  provider_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS match_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  map_id INTEGER NOT NULL,
  char_type INTEGER NOT NULL,
  won INTEGER NOT NULL,
  draw INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  played_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_match_user ON match_results(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id)
  WHERE provider_id IS NOT NULL;
