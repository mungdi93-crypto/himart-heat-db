/**
 * LOTTE HIMART 체감온도 API — Cloudflare Workers + D1
 * 엔드포인트: POST /api/{login|getRecords|saveRecord|deleteRecord|changePassword}
 */

const CENTERS = [
  '이천TC', '인천TC', '파주TC', '강릉TC', '마산TC',
  '대구TC', '양산TC', '공주TC', '제주TC', 'TC', '화성TC', '광주TC'
];

const ACTION_RULES = [
  { min: -100, max: 26.9, level: '정상', action: '일반 작업 가능, 수분 섭취 권장' },
  { min: 27, max: 29.9, level: '주의', action: '작업자 수분 섭취 강화, 휴식 안내' },
  { min: 30, max: 32.9, level: '경고', action: '작업강도 조절, 휴식시간 확대, 취약자 집중관리' },
  { min: 33, max: 35.9, level: '위험', action: '고강도 작업 제한, 냉방/환기 조치 강화, 순환 휴식' },
  { min: 36, max: 100, level: '매우위험', action: '작업중지 검토, 긴급 보호조치 시행' }
];

function calcHeatIndexC(tempC, humidity) {
  const wetBulb =
    tempC * Math.atan(0.151977 * Math.sqrt(humidity + 8.313659)) +
    Math.atan(tempC + humidity) -
    Math.atan(humidity - 1.676331) +
    0.00391838 * Math.pow(humidity, 1.5) * Math.atan(0.023101 * humidity) -
    4.686035;
  const heatIndex =
    -0.2442 +
    0.55399 * wetBulb +
    0.45535 * tempC -
    0.0022 * Math.pow(wetBulb, 2) +
    0.00278 * tempC * wetBulb +
    3;
  return Math.round(heatIndex * 10) / 10;
}

function getRiskLevel(heatIndexC) {
  for (const r of ACTION_RULES) {
    if (heatIndexC >= r.min && heatIndexC <= r.max) return r.level;
  }
  return '정상';
}

function corsHeaders(env, req) {
  const allow = env.ALLOWED_ORIGIN || '*';
  const origin = req.headers.get('Origin') || '*';
  const acao = allow === '*' ? origin : allow;
  return {
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400'
  };
}

function json(env, req, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env, req) }
  });
}

function checkApiSecret(env, req) {
  if (!env.API_SECRET) return true;
  return req.headers.get('X-API-Key') === env.API_SECRET;
}

function formatKstDate(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function formatKstTime(ms) {
  return new Date(ms).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/** 브라우저에서 오는 "YYYY-MM-DDTHH:mm:ss" 등을 KST 기준 epoch(ms)로 변환 */
function parseMeasuredAtMs(measuredAt) {
  if (measuredAt == null || measuredAt === '') return Date.now();
  if (typeof measuredAt === 'number' && !Number.isNaN(measuredAt)) return measuredAt;
  const s = String(measuredAt).trim();
  if (/Z|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
  return new Date(`${s}+09:00`).getTime();
}

function mapRecordRow(row) {
  const measuredAt = row.measured_at;
  return {
    id: row.id,
    measuredAtRaw: measuredAt,
    date: formatKstDate(measuredAt),
    time: formatKstTime(measuredAt).slice(0, 8),
    location: row.location,
    measurer: row.measurer || row.user_id,
    temperatureC: row.temperature_c,
    humidity: row.humidity,
    heatIndexC: row.heat_index_c,
    riskLevel: row.risk_level,
    actionMemo: row.action_memo || '',
    selectedActions: row.selected_actions || '',
    restStart: row.rest_start || '',
    restEnd: row.rest_end || '',
    restMinutes: row.rest_minutes || '',
    userId: row.user_id
  };
}

async function handleLogin(env, req, body) {
  const { id, pw } = body || {};
  if (!id || !pw) return json(env, req, { ok: false, message: '아이디/비밀번호를 입력하세요.' }, 400);

  const row = await env.DB.prepare(
    'SELECT user_id, password, role, center, name FROM users WHERE user_id = ?'
  ).bind(id).first();

  if (!row || String(row.password) !== String(pw)) {
    return json(env, req, { ok: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' }, 401);
  }

  return json(env, req, {
    ok: true,
    user: { userId: row.user_id, role: row.role, center: row.center, name: row.name },
    centers: CENTERS,
    actionRules: ACTION_RULES
  });
}

async function handleGetRecords(env, req, body) {
  const { role, center, fromDate, toDate, filterCenter } = body || {};
  const fromMs = fromDate ? new Date(`${fromDate}T00:00:00+09:00`).getTime() : null;
  const toMs = toDate ? new Date(`${toDate}T23:59:59.999+09:00`).getTime() : null;

  let sql = 'SELECT * FROM records WHERE 1=1';
  const binds = [];

  if (fromMs != null) {
    sql += ' AND measured_at >= ?';
    binds.push(fromMs);
  }
  if (toMs != null) {
    sql += ' AND measured_at <= ?';
    binds.push(toMs);
  }
  if (role === 'CENTER') {
    sql += ' AND center = ?';
    binds.push(center);
  } else if (role === 'HQ' && filterCenter && filterCenter !== 'ALL') {
    sql += ' AND center = ?';
    binds.push(filterCenter);
  }

  sql += ' ORDER BY measured_at ASC';

  const stmt = binds.length ? env.DB.prepare(sql).bind(...binds) : env.DB.prepare(sql);
  const { results } = await stmt.all();

  const records = (results || []).map(mapRecordRow);
  return json(env, req, { ok: true, records, trend: [], centers: CENTERS });
}

async function handleSaveRecord(env, req, body) {
  const {
    userId, role, center, location, measuredAt, measurer,
    temperatureC, humidity, actionMemo, selectedActions, restStart, restEnd, restMinutes
  } = body || {};

  if (!userId || !role || !center || !location) {
    return json(env, req, { ok: false, message: '필수값이 누락되었습니다.' }, 400);
  }

  const temp = Number(temperatureC);
  const hum = Number(humidity);
  if (Number.isNaN(temp) || Number.isNaN(hum)) {
    return json(env, req, { ok: false, message: '온도/습도 값이 올바르지 않습니다.' }, 400);
  }

  const account = await env.DB.prepare('SELECT role, center FROM users WHERE user_id = ?').bind(userId).first();
  if (!account) {
    return json(env, req, { ok: false, message: '사용자를 확인할 수 없습니다.' }, 403);
  }
  if (account.role === 'CENTER' && String(account.center) !== String(center)) {
    return json(env, req, { ok: false, message: '본인 센터만 기록할 수 있습니다.' }, 403);
  }

  const heatIndexC = calcHeatIndexC(temp, hum);
  const riskLevel = getRiskLevel(heatIndexC);
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const measuredMs = parseMeasuredAtMs(measuredAt);
  const actionsStr = Array.isArray(selectedActions) ? selectedActions.join(' | ') : (selectedActions || '');
  const memo = actionMemo || ACTION_RULES.find(r => r.level === riskLevel)?.action || '';

  await env.DB.prepare(
    `INSERT INTO records (
      id, created_at, user_id, role, center, location, measured_at, measurer,
      temperature_c, humidity, heat_index_c, risk_level, action_memo,
      selected_actions, rest_start, rest_end, rest_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, createdAt, userId, account.role, center, location, measuredMs, measurer || userId,
    temp, hum, heatIndexC, riskLevel, memo,
    actionsStr, restStart || '', restEnd || '', restMinutes || ''
  ).run();

  return json(env, req, {
    ok: true,
    message: '저장되었습니다.',
    record: { center, location, temperatureC: temp, humidity: hum, heatIndexC, riskLevel, actionMemo: memo }
  });
}

async function handleDeleteRecord(env, req, body) {
  const { id, userId } = body || {};
  if (!id) return json(env, req, { ok: false, message: '삭제할 기록 ID가 없습니다.' }, 400);

  const row = await env.DB.prepare('SELECT center FROM records WHERE id = ?').bind(id).first();
  if (!row) return json(env, req, { ok: false, message: '해당 기록을 찾을 수 없습니다.' }, 404);

  if (userId) {
    const account = await env.DB.prepare('SELECT role, center FROM users WHERE user_id = ?').bind(userId).first();
    if (account && account.role === 'CENTER' && String(row.center) !== String(account.center)) {
      return json(env, req, { ok: false, message: '본인 센터 기록만 삭제할 수 있습니다.' }, 403);
    }
  }

  await env.DB.prepare('DELETE FROM records WHERE id = ?').bind(id).run();
  return json(env, req, { ok: true, message: '기록이 삭제되었습니다.' });
}

async function handleChangePassword(env, req, body) {
  const { userId, currentPassword, newPassword } = body || {};
  if (!userId || !currentPassword || !newPassword) {
    return json(env, req, { ok: false, message: '필수값이 누락되었습니다.' }, 400);
  }
  if (String(newPassword).length < 4) {
    return json(env, req, { ok: false, message: '새 비밀번호는 4자 이상이어야 합니다.' }, 400);
  }

  const row = await env.DB.prepare(
    'SELECT password FROM users WHERE user_id = ?'
  ).bind(userId).first();

  if (!row) return json(env, req, { ok: false, message: '사용자를 찾을 수 없습니다.' }, 404);
  if (String(row.password) !== String(currentPassword)) {
    return json(env, req, { ok: false, message: '현재 비밀번호가 일치하지 않습니다.' }, 401);
  }

  await env.DB.prepare('UPDATE users SET password = ? WHERE user_id = ?').bind(newPassword, userId).run();
  return json(env, req, { ok: true, message: '비밀번호가 변경되었습니다.' });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    if (!checkApiSecret(env, request)) {
      return json(env, request, { ok: false, message: 'API 키가 올바르지 않습니다.' }, 401);
    }

    const url = new URL(request.url);
    if (request.method !== 'POST' || !url.pathname.startsWith('/api/')) {
      return json(env, request, { ok: false, message: 'Not found' }, 404);
    }

    const action = url.pathname.replace('/api/', '').replace(/\/$/, '');
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }

    try {
      switch (action) {
        case 'login':
          return handleLogin(env, request, body);
        case 'getRecords':
          return handleGetRecords(env, request, body);
        case 'saveRecord':
          return handleSaveRecord(env, request, body);
        case 'deleteRecord':
          return handleDeleteRecord(env, request, body);
        case 'changePassword':
          return handleChangePassword(env, request, body);
        default:
          return json(env, request, { ok: false, message: 'Unknown action' }, 404);
      }
    } catch (e) {
      return json(env, request, { ok: false, message: e.message || 'Server error' }, 500);
    }
  }
};
