/**
 * phumintr888 — Google Apps Script backend
 *
 * Data lives in a private Google Spreadsheet created by this script:
 *   Users    : username, password hash, salt, ...
 *   Sessions : one row per logged-in browser
 *   Data     : timetable + homework JSON per username
 *
 * Deploy as Web app: Execute as "Me", Access "Anyone".
 * Run setup() once in the Apps Script editor to create the spreadsheet
 * and grant the Sheets permission.
 */

const PROP_SPREADSHEET_ID = 'PHUMINTR888_SPREADSHEET_ID';
const USERS_SHEET = 'Users';
const SESSIONS_SHEET = 'Sessions';
const DATA_SHEET = 'Data';
const SESSION_DAYS = 30;
const MAX_DATA_CHARS = 45000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 10;

const USER_HEADERS = [
  'username',
  'passwordHash',
  'salt',
  'createdAt',
  'lastLogin',
  'failedAttempts',
  'lockedUntil'
];
const SESSION_HEADERS = ['token', 'username', 'createdAt', 'expiresAt'];
const DATA_HEADERS = ['username', 'dataJson', 'updatedAt'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('phumintr888')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Run this once from the Apps Script editor. */
function setup() {
  try {
    const spreadsheet = ensureDatabase_();
    const info = {
      ok: true,
      spreadsheetId: spreadsheet.getId(),
      spreadsheetUrl: spreadsheet.getUrl(),
      message: 'Database is ready. Deploy this project as a Web App.'
    };
    console.log(JSON.stringify(info));
    return info;
  } catch (error) {
    const info = {
      ok: false,
      error: String(error && error.message ? error.message : error),
      hint: 'Authorize Google Sheets and Drive for this Apps Script project, then run setup again.'
    };
    console.error(JSON.stringify(info));
    return info;
  }
}

function getDatabaseInfo() {
  const spreadsheet = ensureDatabase_();
  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    webAppUrl: ScriptApp.getService().getUrl()
  };
}

function ensureDatabase_() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheet = null;
  const existingId = props.getProperty(PROP_SPREADSHEET_ID);
  if (existingId) {
    try {
      spreadsheet = SpreadsheetApp.openById(existingId);
    } catch (error) {
      spreadsheet = null;
    }
  }
  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create('phumintr888 Database');
    props.setProperty(PROP_SPREADSHEET_ID, spreadsheet.getId());
  }
  ensureSheet_(spreadsheet, USERS_SHEET, USER_HEADERS);
  ensureSheet_(spreadsheet, SESSIONS_SHEET, SESSION_HEADERS);
  ensureSheet_(spreadsheet, DATA_SHEET, DATA_HEADERS);
  return spreadsheet;
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function apiAuth(rawUsername, rawPassword) {
  try {
    const username = normalizeUsername_(rawUsername);
    const password = String(rawPassword || '');
    const usernameError = validateUsername_(username);
    if (usernameError) return fail_(usernameError);
    if (password.length < 6 || password.length > 128) {
      return fail_('รหัสผ่านต้องยาว 6–128 ตัวอักษร');
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const spreadsheet = ensureDatabase_();
      const users = spreadsheet.getSheetByName(USERS_SHEET);
      const sessions = spreadsheet.getSheetByName(SESSIONS_SHEET);
      const data = spreadsheet.getSheetByName(DATA_SHEET);
      cleanupSessions_(sessions);
      const now = new Date();
      const userRow = findRow_(users, 0, username);

      if (userRow === -1) {
        const salt = Utilities.getUuid().replace(/-/g, '');
        const passwordHash = hashPassword_(salt, password);
        users.appendRow([username, passwordHash, salt, now, now, 0, '']);
        const token = createSession_(sessions, username);
        return ok_({
          token,
          username,
          state: readState_(data, username),
          isNew: true
        });
      }

      const row = users.getRange(userRow, 1, 1, USER_HEADERS.length).getValues()[0];
      const lockedUntil = row[6] ? new Date(row[6]) : null;
      if (lockedUntil && lockedUntil.getTime() > now.getTime()) {
        const minutes = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000));
        return fail_(`ลองผิดหลายครั้งเกินไป กรุณารออีก ${minutes} นาที`);
      }

      const salt = String(row[2] || '');
      const expectedHash = String(row[1] || '');
      const actualHash = hashPassword_(salt, password);
      if (actualHash !== expectedHash) {
        const attempts = Number(row[5] || 0) + 1;
        let locked = '';
        if (attempts >= MAX_LOGIN_ATTEMPTS) {
          locked = new Date(now.getTime() + LOCK_MINUTES * 60000);
        }
        users.getRange(userRow, 6, 1, 2).setValues([[attempts, locked]]);
        return fail_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      }

      users.getRange(userRow, 5, 1, 3).setValues([[now, 0, '']]);
      const token = createSession_(sessions, username);
      return ok_({
        token,
        username,
        state: readState_(data, username),
        isNew: false
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return fail_('เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง');
  }
}

function apiResume(token) {
  try {
    const session = validateSession_(token);
    if (!session) return fail_('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'session_expired');
    const spreadsheet = ensureDatabase_();
    const data = spreadsheet.getSheetByName(DATA_SHEET);
    return ok_({
      token: String(token),
      username: session.username,
      state: readState_(data, session.username),
      isNew: false
    });
  } catch (error) {
    console.error(error);
    return fail_('เชื่อมต่อฐานข้อมูลไม่ได้ กรุณาลองใหม่');
  }
}

function apiSave(token, dataJson) {
  try {
    const session = validateSession_(token);
    if (!session) return fail_('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'session_expired');
    let state;
    try {
      state = JSON.parse(String(dataJson || '{}'));
    } catch (error) {
      return fail_('ข้อมูลที่ส่งมาไม่ถูกต้อง');
    }
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return fail_('ข้อมูลที่ส่งมาไม่ถูกต้อง');
    }

    // Images are intentionally not stored in a spreadsheet cell (size limits).
    delete state.scheduleImage;
    const cleanedJson = JSON.stringify(state);
    if (cleanedJson.length > MAX_DATA_CHARS) {
      return fail_('ข้อมูลมีขนาดใหญ่เกินกำหนด ลองลบรูปตารางหรือข้อมูลเก่าออก');
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const spreadsheet = ensureDatabase_();
      const data = spreadsheet.getSheetByName(DATA_SHEET);
      const now = new Date();
      const row = findRow_(data, 0, session.username);
      if (row === -1) {
        data.appendRow([session.username, cleanedJson, now]);
      } else {
        data.getRange(row, 2, 1, 2).setValues([[cleanedJson, now]]);
      }
      return ok_({ updatedAt: now.toISOString() });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return fail_('บันทึกข้อมูลลง Google Sheets ไม่สำเร็จ');
  }
}

function apiLogout(token) {
  try {
    if (!token) return ok_({});
    const spreadsheet = ensureDatabase_();
    const sessions = spreadsheet.getSheetByName(SESSIONS_SHEET);
    const row = findRow_(sessions, 0, String(token));
    if (row !== -1) sessions.deleteRow(row);
    return ok_({});
  } catch (error) {
    console.error(error);
    return ok_({});
  }
}

function normalizeUsername_(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername_(username) {
  if (username.length < 3 || username.length > 30) {
    return 'ชื่อผู้ใช้ต้องยาว 3–30 ตัวอักษร';
  }
  if (!/^[A-Za-z0-9ก-๙][A-Za-z0-9ก-๙._-]{2,29}$/u.test(username)) {
    return 'ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษรไทย/อังกฤษ ตัวเลข จุด ขีดล่าง หรือขีดกลาง';
  }
  return '';
}

function hashPassword_(salt, password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    `${salt}:${password}`,
    Utilities.Charset.UTF_8
  );
  return bytes.map((byte) => (`0${(byte & 0xff).toString(16)}`).slice(-2)).join('');
}

function createSession_(sessionsSheet, username) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  sessionsSheet.appendRow([token, username, now, expires]);
  return token;
}

function validateSession_(token) {
  const rawToken = String(token || '').trim();
  if (!rawToken) return null;
  const spreadsheet = ensureDatabase_();
  const sessions = spreadsheet.getSheetByName(SESSIONS_SHEET);
  const row = findRow_(sessions, 0, rawToken);
  if (row === -1) return null;
  const values = sessions.getRange(row, 1, 1, SESSION_HEADERS.length).getValues()[0];
  const username = String(values[1] || '');
  const expires = new Date(values[3]);
  if (!username || Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
    sessions.deleteRow(row);
    return null;
  }
  return { username };
}

function cleanupSessions_(sessionsSheet) {
  const lastRow = sessionsSheet.getLastRow();
  if (lastRow <= 1) return;
  const values = sessionsSheet.getRange(2, 1, lastRow - 1, SESSION_HEADERS.length).getValues();
  const now = Date.now();
  const expiredRows = [];
  values.forEach((row, index) => {
    const expires = new Date(row[3]);
    if (Number.isNaN(expires.getTime()) || expires.getTime() <= now) expiredRows.push(index + 2);
  });
  expiredRows.reverse().forEach((row) => sessionsSheet.deleteRow(row));
}

function readState_(dataSheet, username) {
  const row = findRow_(dataSheet, 0, username);
  if (row === -1) return null;
  const raw = dataSheet.getRange(row, 2).getValue();
  if (!raw) return null;
  try {
    return JSON.parse(String(raw));
  } catch (error) {
    return null;
  }
}

function findRow_(sheet, columnIndex, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  const values = sheet.getRange(2, 1, lastRow - 1, Math.max(1, sheet.getLastColumn())).getValues();
  for (let index = 0; index < values.length; index++) {
    if (String(values[index][columnIndex]) === String(value)) return index + 2;
  }
  return -1;
}

function ok_(payload) {
  return Object.assign({ ok: true }, payload || {});
}

function fail_(message, code) {
  return { ok: false, error: String(message || 'เกิดข้อผิดพลาด'), code: code || 'error' };
}
