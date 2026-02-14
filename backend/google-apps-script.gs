const SHEET_NAME = 'Reservations';
const SLOT_CAPACITY = 10;
const DEFAULT_ADMIN_USER = 'admin';
const DEFAULT_ADMIN_PASS = 'turquaz2026';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'availability') {
    const date = e.parameter.date;
    const slots = getAvailabilityByDate(date);
    return json({ ok: true, date, slots });
  }

  return json({ ok: true, message: 'Turquaz reservation endpoint active' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;

    if (action === 'reserve') {
      const requestPayload = (body && typeof body.payload === 'object' && body.payload) ? body.payload : body;
      return reserve_(requestPayload || {});
    }

    if (action === 'adminLogin') {
      const auth = isAdminAuthorized_(body.username, body.password);
      return json({ ok: auth });
    }

    if (action === 'adminList') {
      if (!isAdminAuthorized_(body.username, body.password)) {
        return json({ ok: false, error: 'Unauthorized' });
      }

      const date = String(body.date || '');
      const rows = getReservationsByDate_(date);
      return json({ ok: true, rows });
    }

    if (action === 'seedData') {
      if (!isAdminAuthorized_(body.username, body.password)) {
        return json({ ok: false, error: 'Unauthorized' });
      }

      const days = Number(body.days || 15);
      const startDate = String(body.startDate || normalizeDateKey_(new Date()));
      return seedData_(startDate, days);
    }

    return json({ ok: false, error: 'Unsupported action' });
  } catch (error) {
    return json({ ok: false, error: String(error) });
  }
}

function seedData_(startDate, days) {
  const safeDays = Math.max(1, Math.min(60, Number(days || 15)));
  const baseDate = new Date(startDate + 'T00:00:00');
  if (isNaN(baseDate.getTime())) {
    return json({ ok: false, error: 'Invalid startDate' });
  }

  const sheet = ensureSheet();
  const rows = [];
  const patterns = [
    { time: '08:30', guests: 8, meal: 'breakfast', label: 'BF Limited' },
    { time: '10:00', guests: 10, meal: 'breakfast', label: 'BF Full' },
    { time: '12:30', guests: 3, meal: 'lunch', label: 'LU Open' },
    { time: '13:30', guests: 8, meal: 'lunch', label: 'LU Limited' },
    { time: '19:00', guests: 10, meal: 'dinner', label: 'DI Full' },
    { time: '20:00', guests: 8, meal: 'dinner', label: 'DI Limited' }
  ];

  for (var dayOffset = 0; dayOffset < safeDays; dayOffset += 1) {
    var targetDate = new Date(baseDate);
    targetDate.setDate(baseDate.getDate() + dayOffset);
    var dateKey = normalizeDateKey_(targetDate);

    for (var idx = 0; idx < patterns.length; idx += 1) {
      var pattern = patterns[idx];
      rows.push([
        new Date(),
        pattern.label + ' Day' + dayOffset,
        '+1415' + ('0000000' + ((dayOffset + 1) * 100 + idx)).slice(-7),
        dateKey,
        pattern.time,
        pattern.guests,
        'seeded via seedData',
        pattern.meal
      ]);
    }
  }

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
  }

  return json({ ok: true, inserted: rows.length, startDate: normalizeDateKey_(baseDate), days: safeDays });
}

function reserve_(payload) {
  const validation = validatePayload(payload);
  if (!validation.ok) {
    return json(validation);
  }

  const availability = getAvailabilityByDate(payload.date);
  const used = Number(availability[payload.time] || 0);
  const guests = Number(payload.guests || 0);

  if (used + guests > SLOT_CAPACITY) {
    return json({ ok: false, error: 'Timeslot capacity exceeded' });
  }

  const sheet = ensureSheet();
  sheet.appendRow([
    new Date(),
    payload.name,
    payload.phone,
    payload.date,
    payload.time,
    guests,
    payload.note || '',
    payload.meal || inferMeal_(payload.time)
  ]);

  return json({ ok: true });
}

function validatePayload(payload) {
  if (!payload.name || !payload.phone || !payload.date || !payload.time) {
    return { ok: false, error: 'Missing required fields' };
  }

  const guests = Number(payload.guests || 0);
  if (guests < 1 || guests > SLOT_CAPACITY) {
    return { ok: false, error: 'Invalid guest count' };
  }

  return { ok: true };
}

function inferMeal_(time) {
  if (time >= '08:00' && time <= '11:00') return 'breakfast';
  if (time >= '12:00' && time <= '15:30') return 'lunch';
  return 'dinner';
}

function normalizeDateKey_(value) {
  if (!value) {
    return '';
  }

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  return text;
}

function normalizeTimeKey_(value) {
  if (!value) {
    return '';
  }

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  }

  var text = String(value).trim();
  if (/^\d{2}:\d{2}$/.test(text)) {
    return text;
  }

  var matched = text.match(/(\d{1,2}):(\d{2})/);
  if (matched) {
    var hh = ('0' + matched[1]).slice(-2);
    var mm = matched[2];
    return hh + ':' + mm;
  }

  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'HH:mm');
  }

  return text;
}

function getReservationsByDate_(date) {
  const sheet = ensureSheet();
  const values = sheet.getDataRange().getValues();
  const output = [];
  const targetDate = normalizeDateKey_(date);

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    const rowDate = normalizeDateKey_(row[3]);
    if (targetDate && rowDate !== targetDate) {
      continue;
    }

    output.push({
      createdAt: row[0],
      name: String(row[1] || ''),
      phone: String(row[2] || ''),
      date: rowDate,
      time: normalizeTimeKey_(row[4]),
      guests: Number(row[5] || 0),
      note: String(row[6] || ''),
      meal: String(row[7] || inferMeal_(normalizeTimeKey_(row[4])))
    });
  }

  return output;
}

function isAdminAuthorized_(username, password) {
  const properties = PropertiesService.getScriptProperties();
  const adminUser = properties.getProperty('ADMIN_USER') || DEFAULT_ADMIN_USER;
  const adminPass = properties.getProperty('ADMIN_PASS') || DEFAULT_ADMIN_PASS;
  return String(username || '') === adminUser && String(password || '') === adminPass;
}

function getAvailabilityByDate(date) {
  const sheet = ensureSheet();
  const values = sheet.getDataRange().getValues();
  const headerOffset = 1;
  const result = {};
  const targetDate = normalizeDateKey_(date);

  for (let index = headerOffset; index < values.length; index += 1) {
    const row = values[index];
    const rowDate = normalizeDateKey_(row[3]);
    const rowTime = normalizeTimeKey_(row[4]);
    const rowGuests = Number(row[5] || 0);

    if (rowDate !== targetDate || !rowTime) {
      continue;
    }

    result[rowTime] = Number(result[rowTime] || 0) + rowGuests;
  }

  return result;
}

function ensureSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.appendRow(['CreatedAt', 'Name', 'Phone', 'Date', 'Time', 'Guests', 'Note', 'Meal']);
  }

  if (sheet.getLastRow() >= 1) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (String(headers[2] || '') !== 'Phone') {
      sheet.getRange(1, 3).setValue('Phone');
    }
    if (headers.length < 8 || String(headers[7] || '') !== 'Meal') {
      sheet.getRange(1, 8).setValue('Meal');
    }
  }

  return sheet;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
