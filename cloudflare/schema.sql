-- D1 초기 스키마 + 샘플 계정 (비밀번호는 평문 저장 — 운영 시 해시 권장)
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  center TEXT NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  center TEXT NOT NULL,
  location TEXT NOT NULL,
  measured_at INTEGER NOT NULL,
  measurer TEXT,
  temperature_c REAL NOT NULL,
  humidity REAL NOT NULL,
  heat_index_c REAL NOT NULL,
  risk_level TEXT NOT NULL,
  action_memo TEXT,
  selected_actions TEXT,
  rest_start TEXT,
  rest_end TEXT,
  rest_minutes TEXT
);

CREATE INDEX IF NOT EXISTS idx_records_center_measured ON records(center, measured_at);
CREATE INDEX IF NOT EXISTS idx_records_measured ON records(measured_at);

INSERT OR IGNORE INTO users (user_id, password, role, center, name) VALUES
('hq_admin', 'hq1234', 'HQ', 'ALL', '본사관리자'),
('icheon', 'tc1234', 'CENTER', '이천TC', '이천 담당자'),
('incheon', 'tc1234', 'CENTER', '인천TC', '인천 담당자'),
('paju', 'tc1234', 'CENTER', '파주TC', '파주 담당자'),
('gangneung', 'tc1234', 'CENTER', '강릉TC', '강릉 담당자'),
('masan', 'tc1234', 'CENTER', '마산TC', '마산 담당자'),
('daegu', 'tc1234', 'CENTER', '대구TC', '대구 담당자'),
('yangsan', 'tc1234', 'CENTER', '양산TC', '양산 담당자'),
('gongju', 'tc1234', 'CENTER', '공주TC', '공주 담당자'),
('jeju', 'tc1234', 'CENTER', '제주TC', '제주 담당자'),
('tc', 'tc1234', 'CENTER', 'TC', 'TC 담당자'),
('hwaseong', 'tc1234', 'CENTER', '화성TC', '화성 담당자'),
('gwangju', 'tc1234', 'CENTER', '광주TC', '광주 담당자');
