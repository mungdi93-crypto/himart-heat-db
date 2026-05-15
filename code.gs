/**
 * (선택) Google Apps Script — HTML만 서빙할 때 사용.
 * 데이터 저장은 Cloudflare Workers + D1 로 이전했습니다.
 * @see 프로젝트의 cloudflare/ 폴더 (wrangler.toml, schema.sql, src/worker.js)
 * 프론트: index.html 에서 window.__HIMART_API_BASE__ 또는 ?api=Workers URL 설정
 */

const SPREADSHEET_ID = '1IB535UcCp5PiaQpYmW1V3yXblitWoNuTkC9uRmUAaP4';
const SHEET_USERS = 'Users';
const SHEET_RECORDS = 'Records';

const CENTERS = [
  '이천TC', '인천TC', '파주TC', '강릉TC', '마산TC',
  '대구TC', '양산TC', '공주TC', '제주TC', 'TC', '화성TC', '광주TC'
];

/** 기준(초안) - 필요 시 회사 기준에 맞춰 조정 */
const ACTION_RULES = [
  { min: -100, max: 26.9, level: '정상', action: '일반 작업 가능, 수분 섭취 권장' },
  { min: 27, max: 29.9, level: '주의', action: '작업자 수분 섭취 강화, 휴식 안내' },
  { min: 30, max: 32.9, level: '경고', action: '작업강도 조절, 휴식시간 확대, 취약자 집중관리' },
  { min: 33, max: 35.9, level: '위험', action: '고강도 작업 제한, 냉방/환기 조치 강화, 순환 휴식' },
  { min: 36, max: 100, level: '매우위험', action: '작업중지 검토, 긴급 보호조치 시행' }
];

const RECORD_HEADERS = [
  'id', 'createdAt', 'userId', 'role', 'center', 'location',
  'measuredAt', 'measurer', 'temperatureC', 'humidity', 'heatIndexC', 'riskLevel', 'actionMemo',
  'selectedActions', 'restStart', 'restEnd', 'restMinutes'
];

function doGet() {
  initializeIfNeeded_();
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('롯데하이마트 체감온도 관리')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** 초기 시트/샘플 계정 생성 */
function initializeIfNeeded_() {
  const ss = getSs_();

  let users = ss.getSheetByName(SHEET_USERS);
  if (!users) {
    users = ss.insertSheet(SHEET_USERS);
    users.getRange(1, 1, 1, 5).setValues([['userId', 'password', 'role', 'center', 'name']]);

    // 샘플 계정
    const seedUsers = [
      ['hq_admin', 'hq1234', 'HQ', 'ALL', '본사관리자'],
      ['icheon', 'tc1234', 'CENTER', '이천TC', '이천 담당자'],
      ['incheon', 'tc1234', 'CENTER', '인천TC', '인천 담당자'],
      ['paju', 'tc1234', 'CENTER', '파주TC', '파주 담당자'],
      ['gangneung', 'tc1234', 'CENTER', '강릉TC', '강릉 담당자'],
      ['masan', 'tc1234', 'CENTER', '마산TC', '마산 담당자'],
      ['daegu', 'tc1234', 'CENTER', '대구TC', '대구 담당자'],
      ['yangsan', 'tc1234', 'CENTER', '양산TC', '양산 담당자'],
      ['gongju', 'tc1234', 'CENTER', '공주TC', '공주 담당자'],
      ['jeju', 'tc1234', 'CENTER', '제주TC', '제주 담당자'],
      ['tc', 'tc1234', 'CENTER', 'TC', 'TC 담당자'],
      ['hwaseong', 'tc1234', 'CENTER', '화성TC', '화성 담당자'],
      ['gwangju', 'tc1234', 'CENTER', '광주TC', '광주 담당자']
    ];
    users.getRange(2, 1, seedUsers.length, 5).setValues(seedUsers);
  }

  let records = ss.getSheetByName(SHEET_RECORDS);
  if (!records) {
    records = ss.insertSheet(SHEET_RECORDS);
    records.getRange(1, 1, 1, RECORD_HEADERS.length).setValues([RECORD_HEADERS]);
  } else {
    ensureRecordHeaders_(records);
  }
}

function getSs_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureRecordHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  if (current.length === 0 || !current[0]) {
    sheet.getRange(1, 1, 1, RECORD_HEADERS.length).setValues([RECORD_HEADERS]);
    return;
  }
  RECORD_HEADERS.forEach(h => {
    if (current.indexOf(h) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(h);
    }
  });
}

/** 로그인 */
function login(userId, password) {
  initializeIfNeeded_();
  const users = getSs_().getSheetByName(SHEET_USERS);
  const values = users.getDataRange().getValues();
  const header = values[0];
  const rows = values.slice(1);

  const idx = {
    userId: header.indexOf('userId'),
    password: header.indexOf('password'),
    role: header.indexOf('role'),
    center: header.indexOf('center'),
    name: header.indexOf('name')
  };

  const found = rows.find(r => String(r[idx.userId]) === String(userId) && String(r[idx.password]) === String(password));
  if (!found) return { ok: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' };

  return {
    ok: true,
    user: {
      userId: found[idx.userId],
      role: found[idx.role],      // HQ or CENTER
      center: found[idx.center],  // ALL or 센터명
      name: found[idx.name]
    },
    centers: CENTERS,
    actionRules: ACTION_RULES
  };
}

/** 비밀번호 변경 (센터 계정 본인) */
function changePassword(payload) {
  initializeIfNeeded_();
  const { userId, currentPassword, newPassword } = payload || {};
  if (!userId || !currentPassword || !newPassword) {
    return { ok: false, message: '필수값이 누락되었습니다.' };
  }
  if (String(newPassword).length < 4) {
    return { ok: false, message: '새 비밀번호는 4자 이상이어야 합니다.' };
  }

  const users = getSs_().getSheetByName(SHEET_USERS);
  const values = users.getDataRange().getValues();
  const header = values[0];
  const idxUser = header.indexOf('userId');
  const idxPw = header.indexOf('password');

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idxUser]) === String(userId)) {
      if (String(values[i][idxPw]) !== String(currentPassword)) {
        return { ok: false, message: '현재 비밀번호가 일치하지 않습니다.' };
      }
      users.getRange(i + 1, idxPw + 1).setValue(String(newPassword));
      return { ok: true, message: '비밀번호가 변경되었습니다.' };
    }
  }
  return { ok: false, message: '사용자를 찾을 수 없습니다.' };
}

/** 체감온도 계산(Heat Index, 섭씨 반환) */
function calcHeatIndexC(tempC, humidity) {
  // 습구온도 (J5)
  const wetBulb =
    tempC * Math.atan(0.151977 * Math.sqrt(humidity + 8.313659)) +
    Math.atan(tempC + humidity) -
    Math.atan(humidity - 1.676331) +
    0.00391838 * Math.pow(humidity, 1.5) * Math.atan(0.023101 * humidity) -
    4.686035;

  // 체감온도 (K5)
  const heatIndex =
    -0.2442 +
    0.55399 * wetBulb +
    0.45535 * tempC -
    0.0022 * Math.pow(wetBulb, 2) +
    0.00278 * tempC * wetBulb +
    3;

  return Number(heatIndex.toFixed(1));
}

function getRiskByHeatIndex_(heatIndexC) {
  return ACTION_RULES.find(r => heatIndexC >= r.min && heatIndexC <= r.max) || ACTION_RULES[0];
}

/** 기록 저장 */
function saveRecord(payload) {
  initializeIfNeeded_();

  const {
    userId, role, center, location, measuredAt, measurer, temperatureC, humidity, actionMemo, selectedActions, restStart, restEnd, restMinutes
  } = payload;

  if (!userId || !role || !center || !location) {
    return { ok: false, message: '필수값이 누락되었습니다.' };
  }

  const temp = Number(temperatureC);
  const hum = Number(humidity);
  if (isNaN(temp) || isNaN(hum)) {
    return { ok: false, message: '온도/습도 값이 올바르지 않습니다.' };
  }

  const heatIndexC = calcHeatIndexC(temp, hum);
  const risk = getRiskByHeatIndex_(heatIndexC);

  const sheet = getSs_().getSheetByName(SHEET_RECORDS);
  ensureRecordHeaders_(sheet);
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = new Array(header.length).fill('');
  const set = (key, value) => {
    const i = header.indexOf(key);
    if (i >= 0) row[i] = value;
  };

  set('id', Utilities.getUuid());
  set('createdAt', new Date());
  set('userId', userId);
  set('role', role);
  set('center', center);
  set('location', location);
  set('measuredAt', measuredAt ? new Date(measuredAt) : new Date());
  set('measurer', measurer || '');
  set('temperatureC', temp);
  set('humidity', hum);
  set('heatIndexC', heatIndexC);
  set('riskLevel', risk.level);
  set('actionMemo', actionMemo || risk.action);
  set('selectedActions', Array.isArray(selectedActions) ? selectedActions.join(' | ') : (selectedActions || ''));
  set('restStart', restStart || '');
  set('restEnd', restEnd || '');
  set('restMinutes', restMinutes || '');

  sheet.appendRow(row);

  return {
    ok: true,
    message: '저장되었습니다.',
    record: {
      center,
      location,
      temperatureC: temp,
      humidity: hum,
      heatIndexC,
      riskLevel: risk.level,
      actionMemo: actionMemo || risk.action,
      selectedActions: Array.isArray(selectedActions) ? selectedActions : [],
      restStart: restStart || '',
      restEnd: restEnd || '',
      restMinutes: restMinutes || ''
    }
  };
}

/** 기록 조회 */
function getRecords(query) {
  initializeIfNeeded_();
  const { role, center, fromDate, toDate, filterCenter } = query || {};

  const sheet = getSs_().getSheetByName(SHEET_RECORDS);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return { ok: true, records: [], trend: [] };

  const header = values[0];
  const rows = values.slice(1);

  const idx = {
    id: header.indexOf('id'),
    createdAt: header.indexOf('createdAt'),
    center: header.indexOf('center'),
    location: header.indexOf('location'),
    measuredAt: header.indexOf('measuredAt'),
    measurer: header.indexOf('measurer'),
    temperatureC: header.indexOf('temperatureC'),
    humidity: header.indexOf('humidity'),
    heatIndexC: header.indexOf('heatIndexC'),
    riskLevel: header.indexOf('riskLevel'),
    actionMemo: header.indexOf('actionMemo'),
    selectedActions: header.indexOf('selectedActions'),
    restStart: header.indexOf('restStart'),
    restEnd: header.indexOf('restEnd'),
    restMinutes: header.indexOf('restMinutes'),
    userId: header.indexOf('userId')
  };

  const from = fromDate ? new Date(fromDate + 'T00:00:00') : null;
  const to = toDate ? new Date(toDate + 'T23:59:59') : null;

  let filtered = rows.filter(r => {
    const dt = new Date(r[idx.createdAt]);
    if (from && dt < from) return false;
    if (to && dt > to) return false;

    // 권한 필터
    if (role === 'CENTER' && r[idx.center] !== center) return false;
    if (role === 'HQ' && filterCenter && filterCenter !== 'ALL' && r[idx.center] !== filterCenter) return false;

    return true;
  });

  filtered = filtered.sort((a, b) => new Date(a[idx.createdAt]) - new Date(b[idx.createdAt]));

  const records = filtered.map(r => ({
    id: idx.id >= 0 ? r[idx.id] : '',
    createdAtRaw: new Date(r[idx.createdAt]).getTime(),
    createdAt: Utilities.formatDate(new Date(r[idx.createdAt]), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    measuredAtRaw: idx.measuredAt >= 0 ? new Date(r[idx.measuredAt]).getTime() : new Date(r[idx.createdAt]).getTime(),
    measuredAt: Utilities.formatDate(
      idx.measuredAt >= 0 ? new Date(r[idx.measuredAt]) : new Date(r[idx.createdAt]),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm'
    ),
    center: r[idx.center],
    location: r[idx.location],
    measurer: idx.measurer >= 0 ? r[idx.measurer] : '',
    temperatureC: r[idx.temperatureC],
    humidity: r[idx.humidity],
    heatIndexC: r[idx.heatIndexC],
    riskLevel: r[idx.riskLevel],
    actionMemo: r[idx.actionMemo],
    selectedActions: idx.selectedActions >= 0 ? r[idx.selectedActions] : '',
    restStart: idx.restStart >= 0 ? r[idx.restStart] : '',
    restEnd: idx.restEnd >= 0 ? r[idx.restEnd] : '',
    restMinutes: idx.restMinutes >= 0 ? r[idx.restMinutes] : '',
    userId: r[idx.userId]
  }));

  // 시간 추세(일시별 평균 체감온도)
  const group = {};
  records.forEach(rec => {
    const key = rec.createdAt.substring(0, 13) + ':00';
    if (!group[key]) group[key] = { sum: 0, count: 0 };
    group[key].sum += Number(rec.heatIndexC);
    group[key].count += 1;
  });

  const trend = Object.keys(group).sort().map(k => ({
    time: k,
    avgHeatIndex: Number((group[k].sum / group[k].count).toFixed(1))
  }));

  return { ok: true, records, trend, centers: CENTERS };
}

/** 기록 삭제 */
function deleteRecord(payload) {
  initializeIfNeeded_();
  const { id, role, center } = payload || {};
  if (!id) return { ok: false, message: '삭제할 기록 ID가 없습니다.' };

  const sheet = getSs_().getSheetByName(SHEET_RECORDS);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return { ok: false, message: '삭제할 기록이 없습니다.' };

  const header = values[0];
  const idxId = header.indexOf('id');
  const idxCenter = header.indexOf('center');
  if (idxId < 0) return { ok: false, message: 'id 컬럼이 없습니다.' };

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idxId]) === String(id)) {
      if (role === 'CENTER' && idxCenter >= 0 && String(values[i][idxCenter]) !== String(center)) {
        return { ok: false, message: '본인 센터 기록만 삭제할 수 있습니다.' };
      }
      sheet.deleteRow(i + 1);
      return { ok: true, message: '기록이 삭제되었습니다.' };
    }
  }
  return { ok: false, message: '해당 기록을 찾을 수 없습니다.' };
}
