const SHEET_NAME = 'Reservations';
const SLOT_CAPACITY = 10;
const DEFAULT_ADMIN_USER = 'admin';
const DEFAULT_ADMIN_PASS = 'turquaz2026';
const DEFAULT_NOTIFICATION_EMAIL = 'sf@oklavacafe.com';
const DEFAULT_ADMIN_EMAIL = 'aziz@oklavacafe.com';
const TOKEN_VALID_HOURS = 72;
const DEFAULT_RESERVATION_DURATION_MINUTES = 90;
const DEFAULT_RESERVATION_PAGE_URL = 'https://www.turquazsf.com/#reservation';

/* ═══════════════════════════════════════════════════════════
   HTTP HANDLERS
   ═══════════════════════════════════════════════════════════ */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'manage') {
    return handleManageAction_(e);
  }

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

    if (action === 'contact') {
      const contactPayload = (body && typeof body.payload === 'object' && body.payload) ? body.payload : body;
      return handleContact_(contactPayload || {});
    }

    return json({ ok: false, error: 'Unsupported action' });
  } catch (error) {
    return json({ ok: false, error: String(error) });
  }
}

/* ═══════════════════════════════════════════════════════════
   SEED DATA
   ═══════════════════════════════════════════════════════════ */

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
        pattern.meal,
        '',
        '',
        '',
        'active',
        ''
      ]);
    }
  }

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 13).setValues(rows);
  }

  return json({ ok: true, inserted: rows.length, startDate: normalizeDateKey_(baseDate), days: safeDays });
}

/* ═══════════════════════════════════════════════════════════
   RESERVE
   ═══════════════════════════════════════════════════════════ */

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
  var token = Utilities.getUuid().replace(/-/g, '');
  var tokenExpiresAt = new Date(Date.now() + TOKEN_VALID_HOURS * 60 * 60 * 1000);

  sheet.appendRow([
    new Date(),
    payload.name,
    payload.phone,
    payload.date,
    payload.time,
    guests,
    payload.note || '',
    payload.meal || inferMeal_(payload.time),
    String(payload.email || '').trim(),
    token,
    tokenExpiresAt,
    'active',
    ''
  ]);

  var emailStatus = sendReservationEmails_(payload, token, tokenExpiresAt);

  return json({ ok: true, emailSent: emailStatus.ok });
}

function validatePayload(payload) {
  if (!payload.name || !payload.phone || !payload.email || !payload.date || !payload.time) {
    return { ok: false, error: 'Missing required fields' };
  }

  var email = String(payload.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Invalid email address' };
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

/* ═══════════════════════════════════════════════════════════
   CONTACT FORM
   ═══════════════════════════════════════════════════════════ */

function handleContact_(payload) {
  var name = String(payload.name || '').trim();
  var email = String(payload.email || '').trim();
  var phone = String(payload.phone || '').trim();
  var subject = String(payload.subject || '').trim();
  var message = String(payload.message || '').trim();

  if (!name || !email || !subject || !message) {
    return json({ ok: false, error: 'Missing required fields' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'Invalid email address' });
  }

  try {
    var properties = PropertiesService.getScriptProperties();
    var adminEmail = String(properties.getProperty('ADMIN_EMAIL') || DEFAULT_ADMIN_EMAIL).trim();
    var notificationEmail = String(properties.getProperty('NOTIFICATION_EMAIL') || DEFAULT_NOTIFICATION_EMAIL).trim();
    var recipients = uniqueEmails_([adminEmail, notificationEmail]);

    if (!recipients.length) {
      return json({ ok: false, error: 'No recipient configured' });
    }

    var htmlBody = '<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafafa;border:1px solid #e0e0e0;border-radius:8px;">'
      + '<h2 style="margin:0 0 16px;color:#2a4192;">New Contact Message</h2>'
      + '<table style="width:100%;border-collapse:collapse;font-size:14px;">'
      + '<tr><td style="padding:6px 12px 6px 0;color:#666;font-weight:600;white-space:nowrap;">Subject</td><td style="padding:6px 0;">' + subject + '</td></tr>'
      + '<tr><td style="padding:6px 12px 6px 0;color:#666;font-weight:600;white-space:nowrap;">Name</td><td style="padding:6px 0;">' + name + '</td></tr>'
      + '<tr><td style="padding:6px 12px 6px 0;color:#666;font-weight:600;white-space:nowrap;">Email</td><td style="padding:6px 0;"><a href="mailto:' + email + '">' + email + '</a></td></tr>'
      + (phone ? '<tr><td style="padding:6px 12px 6px 0;color:#666;font-weight:600;white-space:nowrap;">Phone</td><td style="padding:6px 0;">' + phone + '</td></tr>' : '')
      + '</table>'
      + '<div style="margin:16px 0 0;padding:12px;background:#fff;border:1px solid #eee;border-radius:6px;white-space:pre-wrap;font-size:14px;line-height:1.6;color:#333;">' + message + '</div>'
      + '<p style="margin:16px 0 0;font-size:12px;color:#999;">Sent from turquazsf.com contact form</p>'
      + '</div>';

    sendEmail_(
      recipients.join(','),
      'Turquaz Contact · ' + subject + ' · ' + name,
      htmlBody,
      properties
    );

    return json({ ok: true });
  } catch (error) {
    Logger.log('Contact email send failed: ' + error);
    return json({ ok: false, error: String(error) });
  }
}

/* ═══════════════════════════════════════════════════════════
   DATE / TIME HELPERS
   ═══════════════════════════════════════════════════════════ */

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

function formatDisplayDate_(dateText) {
  var date = new Date(String(dateText || '') + 'T00:00:00');
  if (isNaN(date.getTime())) {
    return String(dateText || '');
  }
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'EEE, MMM dd, yyyy');
}

function formatDateTimeDisplay_(value) {
  var date = Object.prototype.toString.call(value) === '[object Date]' ? value : new Date(value);
  if (isNaN(date.getTime())) {
    return String(value || '');
  }
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'EEE, MMM dd, yyyy HH:mm');
}

/* ═══════════════════════════════════════════════════════════
   SHEET QUERIES
   ═══════════════════════════════════════════════════════════ */

function getReservationsByDate_(date) {
  const sheet = ensureSheet();
  const values = sheet.getDataRange().getValues();
  const output = [];
  const targetDate = normalizeDateKey_(date);

  for (let index = 1; index < values.length; index += 1) {
    const mapped = mapReservationRow_(values[index]);
    const rowDate = normalizeDateKey_(mapped.date);
    if (targetDate && rowDate !== targetDate) {
      continue;
    }

    output.push({
      createdAt: mapped.createdAt,
      name: String(mapped.name || ''),
      phone: String(mapped.phone || ''),
      email: String(mapped.email || ''),
      date: rowDate,
      time: normalizeTimeKey_(mapped.time),
      guests: Number(mapped.guests || 0),
      note: String(mapped.note || ''),
      meal: String(mapped.meal || inferMeal_(normalizeTimeKey_(mapped.time))),
      status: String(mapped.status || 'active').toLowerCase()
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
    const mapped = mapReservationRow_(values[index]);
    const status = String(mapped.status || 'active').toLowerCase();
    if (status === 'canceled') {
      continue;
    }

    const rowDate = normalizeDateKey_(mapped.date);
    const rowTime = normalizeTimeKey_(mapped.time);
    const rowGuests = Number(mapped.guests || 0);

    if (rowDate !== targetDate || !rowTime) {
      continue;
    }

    result[rowTime] = Number(result[rowTime] || 0) + rowGuests;
  }

  return result;
}

/* ═══════════════════════════════════════════════════════════
   SHEET SETUP
   ═══════════════════════════════════════════════════════════ */

function ensureSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.appendRow(['CreatedAt', 'Name', 'Phone', 'Date', 'Time', 'Guests', 'Note', 'Meal', 'Email', 'ManageToken', 'TokenExpiresAt', 'Status', 'CanceledAt']);
  }

  if (sheet.getLastRow() >= 1) {
    ensureHeader_(sheet, 1, 'CreatedAt');
    ensureHeader_(sheet, 2, 'Name');
    ensureHeader_(sheet, 3, 'Phone');
    ensureHeader_(sheet, 4, 'Date');
    ensureHeader_(sheet, 5, 'Time');
    ensureHeader_(sheet, 6, 'Guests');
    ensureHeader_(sheet, 7, 'Note');
    ensureHeader_(sheet, 8, 'Meal');
    ensureHeader_(sheet, 9, 'Email');
    ensureHeader_(sheet, 10, 'ManageToken');
    ensureHeader_(sheet, 11, 'TokenExpiresAt');
    ensureHeader_(sheet, 12, 'Status');
    ensureHeader_(sheet, 13, 'CanceledAt');
  }

  return sheet;
}

function ensureHeader_(sheet, col, value) {
  if (String(sheet.getRange(1, col).getValue() || '') !== value) {
    sheet.getRange(1, col).setValue(value);
  }
}

function mapReservationRow_(row) {
  return {
    createdAt: row[0],
    name: row[1],
    phone: row[2],
    date: row[3],
    time: row[4],
    guests: row[5],
    note: row[6],
    meal: row[7],
    email: row[8],
    token: row[9],
    tokenExpiresAt: row[10],
    status: row[11],
    canceledAt: row[12]
  };
}

/* ═══════════════════════════════════════════════════════════
   EMAIL SENDING
   ═══════════════════════════════════════════════════════════ */

function sendReservationEmails_(payload, token, tokenExpiresAt) {
  try {
    var properties = PropertiesService.getScriptProperties();
    var adminEmail = String(properties.getProperty('ADMIN_EMAIL') || DEFAULT_ADMIN_EMAIL).trim();
    var notificationEmail = String(properties.getProperty('NOTIFICATION_EMAIL') || DEFAULT_NOTIFICATION_EMAIL).trim();
    var customerEmail = String(payload.email || '').trim();
    var cancelUrl = buildManageUrl_('cancel', token, properties);
    var modifyUrl = buildManageUrl_('modify', token, properties);
    var calendarBlob = buildCalendarInviteBlob_(payload, token);

    var displayDate = formatDisplayDate_(payload.date);
    var displayTime = normalizeTimeKey_(payload.time);
    var titleLine = payload.name + ' · ' + displayDate + ' · ' + displayTime;

    sendEmail_(
      customerEmail,
      'Turquaz reservation confirmed · ' + displayDate + ' at ' + displayTime,
      buildReservationEmailHtml_(payload, {
        heading: 'Your reservation is confirmed',
        lead: 'We look forward to hosting you at Turquaz. Here are your reservation details.',
        subLead: 'Manage links are valid for ' + TOKEN_VALID_HOURS + ' hours.',
        accent: '#2a4192',
        mode: 'customer',
        cancelUrl: cancelUrl,
        modifyUrl: modifyUrl,
        tokenExpiresAt: tokenExpiresAt
      }),
      properties,
      [calendarBlob]
    );

    var teamRecipients = uniqueEmails_([adminEmail, notificationEmail]);
    if (teamRecipients.length) {
      sendEmail_(
        teamRecipients.join(','),
        'New reservation · ' + titleLine,
        buildReservationEmailHtml_(payload, {
          heading: 'New reservation received',
          lead: 'A new booking has just been submitted from the website reservation form.',
          accent: '#0b3c47',
          mode: 'team'
        }),
        properties
      );
    }

    return { ok: true };
  } catch (error) {
    Logger.log('Reservation email send failed: ' + error);
    return { ok: false, error: String(error) };
  }
}

function sendEmail_(to, subject, htmlBody, properties, attachments) {
  var options = {
    to: to,
    subject: subject,
    htmlBody: htmlBody,
    body: 'Please view this reservation email in an HTML-capable mail client.',
    name: String(properties.getProperty('MAIL_SENDER_NAME') || 'Turquaz Reservations')
  };

  if (attachments && attachments.length) {
    options.attachments = attachments;
  }

  MailApp.sendEmail(options);
}

/* ═══════════════════════════════════════════════════════════
   EMAIL HTML TEMPLATE
   ═══════════════════════════════════════════════════════════ */

function buildReservationEmailHtml_(payload, config) {
  var safeName = escapeHtml_(String(payload.name || 'Guest'));
  var safePhone = escapeHtml_(String(payload.phone || '-'));
  var safeEmail = escapeHtml_(String(payload.email || '-'));
  var safeDate = escapeHtml_(formatDisplayDate_(payload.date));
  var safeTime = escapeHtml_(normalizeTimeKey_(payload.time));
  var safeGuests = escapeHtml_(String(payload.guests || '-'));
  var safeMeal = escapeHtml_(String(payload.meal || inferMeal_(payload.time)));
  var safeNote = escapeHtml_(String(payload.note || 'No special request'));
  var safeAccent = escapeHtml_(String(config.accent || '#0b3c47'));
  var safeHeading = escapeHtml_(String(config.heading || 'Reservation update'));
  var safeLead = escapeHtml_(String(config.lead || 'Your reservation details are below.'));
  var safeSubLead = escapeHtml_(String(config.subLead || ''));
  var detailsTitle = config.mode === 'customer' ? 'Reservation Details' : 'Booking Details';
  var actionHtml = '';
  var expiresCopy = '';

  if (config.mode === 'customer') {
    if (config.modifyUrl) {
      actionHtml += '<a href="' + escapeHtml_(String(config.modifyUrl)) + '" style="display:inline-block;margin:0 10px 10px 0;padding:10px 16px;border-radius:999px;border:1px solid #2a4192;background:#2a4192;color:#ffffff;text-decoration:none;font-size:13px;">Modify</a>';
    }
    if (config.cancelUrl) {
      actionHtml += '<a href="' + escapeHtml_(String(config.cancelUrl)) + '" style="display:inline-block;margin:0 10px 10px 0;padding:10px 16px;border-radius:999px;border:1px solid #d85c55;background:#ffffff;color:#d85c55;text-decoration:none;font-size:13px;">Cancel Reservation</a>';
    }
    if (config.tokenExpiresAt) {
      expiresCopy = '<p style="margin:4px 0 0 0;font-size:12px;line-height:1.6;color:#73828a;">Links expire: ' + escapeHtml_(formatDateTimeDisplay_(config.tokenExpiresAt)) + '</p>';
    }
  }

  return ''
    + '<!doctype html>'
    + '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Turquaz Reservation</title></head>'
    + '<body style="margin:0;padding:0;background:#f3f6f8;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1d1f;">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;background:linear-gradient(180deg,#f3f6f8 0%,#eaf1f4 100%);">'
    + '<tr><td align="center">'
    + '<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #d9e2e8;border-radius:18px;overflow:hidden;box-shadow:0 14px 40px rgba(13,39,54,0.08);">'
    + '<tr><td style="padding:0;">'
    + '<div style="height:8px;background:linear-gradient(90deg,' + safeAccent + ' 0%,#3c5c8d 45%,#c9a96e 100%);"></div>'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">'
    + '<tr><td style="padding:28px 32px 18px 32px;">'
    + '<p style="margin:0 0 6px 0;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#5f7280;">Turquaz</p>'
    + '<h1 style="margin:0;font-size:31px;line-height:1.18;font-weight:600;color:#101214;">' + safeHeading + '</h1>'
    + '<p style="margin:10px 0 0 0;font-size:16px;line-height:1.55;color:#44525b;">' + safeLead + '</p>'
    + (safeSubLead ? '<p style="margin:8px 0 0 0;font-size:13px;line-height:1.6;color:#5f7078;">' + safeSubLead + '</p>' : '')
    + '</td></tr>'
    + '<tr><td style="padding:0 24px 26px 24px;">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;background:#f7fafb;border:1px solid #e3ebf0;border-radius:14px;">'
    + '<tr><td colspan="2" style="padding:16px 18px 10px 18px;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:#60717a;">' + detailsTitle + '</td></tr>'
    + rowHtml_('Name', safeName)
    + rowHtml_('Date', safeDate)
    + rowHtml_('Time', safeTime)
    + rowHtml_('Guests', safeGuests)
    + rowHtml_('Meal', capitalize_(safeMeal))
    + rowHtml_('Phone', safePhone)
    + rowHtml_('Email', safeEmail)
    + rowHtml_('Special Request', safeNote)
    + '</table>'
    + '</td></tr>'
    + (actionHtml ? '<tr><td style="padding:0 24px 20px 24px;"><div style="padding:0 2px;">' + actionHtml + '</div>' + expiresCopy + '</td></tr>' : '')
    + '<tr><td style="padding:0 32px 30px 32px;">'
    + '<p style="margin:0;font-size:13px;line-height:1.7;color:#5e6a71;">1198 Mission St, San Francisco, CA 94102<br>+1 415-791-0770 · sf@oklavacafe.com</p>'
    + '</td></tr>'
    + '</table>'
    + '</td></tr>'
    + '</table>'
    + '</td></tr>'
    + '</table>'
    + '</body></html>';
}

function rowHtml_(label, value) {
  return ''
    + '<tr>'
    + '<td style="padding:10px 18px 11px 18px;width:38%;font-size:13px;color:#61727b;border-top:1px solid #e5edf2;">' + label + '</td>'
    + '<td style="padding:10px 18px 11px 18px;font-size:14px;color:#182026;border-top:1px solid #e5edf2;">' + value + '</td>'
    + '</tr>';
}

/* ═══════════════════════════════════════════════════════════
   MANAGE (CANCEL / MODIFY) VIA SECURE TOKEN
   ═══════════════════════════════════════════════════════════ */

function buildManageUrl_(mode, token, properties) {
  var baseUrl = String(properties.getProperty('WEB_APP_URL') || ScriptApp.getService().getUrl() || '').trim();
  if (!baseUrl || !token) {
    return '';
  }

  return baseUrl
    + '?action=manage&mode=' + encodeURIComponent(mode)
    + '&token=' + encodeURIComponent(token);
}

function findReservationByToken_(token) {
  var sheet = ensureSheet();
  var values = sheet.getDataRange().getValues();

  for (var rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    var mapped = mapReservationRow_(values[rowIndex]);
    if (String(mapped.token || '') === String(token || '')) {
      return {
        sheet: sheet,
        rowIndex: rowIndex + 1,
        row: mapped
      };
    }
  }

  return null;
}

function handleManageAction_(e) {
  var token = String((e && e.parameter && e.parameter.token) || '').trim();
  var mode = String((e && e.parameter && e.parameter.mode) || '').trim().toLowerCase();

  if (!token || (mode !== 'cancel' && mode !== 'modify')) {
    return htmlPage_('Link is invalid', 'This reservation link is malformed or missing required details.', '#9e4d48');
  }

  var found = findReservationByToken_(token);
  if (!found) {
    return htmlPage_('Link not found', 'This reservation link is no longer valid.', '#9e4d48');
  }

  var status = String(found.row.status || 'active').toLowerCase();
  if (status === 'canceled') {
    return htmlPage_('Already canceled', 'This reservation has already been canceled.', '#5f7280');
  }

  var expiresAt = new Date(found.row.tokenExpiresAt);
  if (isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return htmlPage_('Link expired', 'This secure link has expired. Please call us at +1 415-791-0770 for assistance.', '#9e4d48');
  }

  if (mode === 'cancel') {
    found.sheet.getRange(found.rowIndex, 12).setValue('canceled');
    found.sheet.getRange(found.rowIndex, 13).setValue(new Date());
    found.sheet.getRange(found.rowIndex, 10).setValue('');
    found.sheet.getRange(found.rowIndex, 11).setValue('');

    return htmlPage_(
      'Reservation canceled',
      'Your reservation for ' + escapeHtml_(formatDisplayDate_(found.row.date)) + ' at ' + escapeHtml_(normalizeTimeKey_(found.row.time)) + ' has been canceled successfully.',
      '#2a4192'
    );
  }

  var properties = PropertiesService.getScriptProperties();
  var reservationUrl = String(properties.getProperty('RESERVATION_PAGE_URL') || DEFAULT_RESERVATION_PAGE_URL).trim();
  var cancelUrl = buildManageUrl_('cancel', token, properties);
  var message = ''
    + 'To modify your reservation, create a new reservation first, then cancel this one using the secure button below.'
    + '<br><br><a href="' + escapeHtml_(reservationUrl) + '" style="display:inline-block;margin:0 10px 10px 0;padding:10px 16px;border-radius:999px;border:1px solid #2a4192;background:#2a4192;color:#ffffff;text-decoration:none;font-size:13px;">Create New Reservation</a>'
    + '<a href="' + escapeHtml_(cancelUrl) + '" style="display:inline-block;margin:0 10px 10px 0;padding:10px 16px;border-radius:999px;border:1px solid #d85c55;background:#ffffff;color:#d85c55;text-decoration:none;font-size:13px;">Cancel Current Reservation</a>';

  return htmlPage_('Modify reservation', message, '#2a4192');
}

function htmlPage_(title, message, accent) {
  var safeTitle = escapeHtml_(String(title || 'Reservation'));
  var safeAccent = escapeHtml_(String(accent || '#2a4192'));
  var bodyHtml = ''
    + '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + safeTitle + '</title></head>'
    + '<body style="margin:0;padding:0;background:#f2f5f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1d1f;">'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">'
    + '<tr><td align="center">'
    + '<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #d9e1e7;border-radius:16px;overflow:hidden;">'
    + '<tr><td style="height:6px;background:' + safeAccent + ';"></td></tr>'
    + '<tr><td style="padding:24px;">'
    + '<h1 style="margin:0 0 8px 0;font-size:30px;line-height:1.2;font-weight:600;">' + safeTitle + '</h1>'
    + '<p style="margin:0;font-size:15px;line-height:1.7;color:#4f5e67;">' + message + '</p>'
    + '</td></tr></table></td></tr></table></body></html>';

  return HtmlService.createHtmlOutput(bodyHtml).setTitle('Turquaz Reservation');
}

/* ═══════════════════════════════════════════════════════════
   ICS CALENDAR INVITE
   ═══════════════════════════════════════════════════════════ */

function buildCalendarInviteBlob_(payload, token) {
  var startDate = toReservationDateTime_(payload.date, payload.time);
  var endDate = new Date(startDate.getTime() + DEFAULT_RESERVATION_DURATION_MINUTES * 60 * 1000);
  var uid = (token || Utilities.getUuid()) + '@turquaz-reservation';
  var summary = 'Turquaz Reservation';
  var location = '1198 Mission St, San Francisco, CA 94102';
  var description = 'Reservation for ' + payload.name + ' (' + payload.guests + ' guests).';
  var ics = ''
    + 'BEGIN:VCALENDAR\r\n'
    + 'VERSION:2.0\r\n'
    + 'PRODID:-//Turquaz//Reservation//EN\r\n'
    + 'CALSCALE:GREGORIAN\r\n'
    + 'METHOD:PUBLISH\r\n'
    + 'BEGIN:VEVENT\r\n'
    + 'UID:' + sanitizeIcsText_(uid) + '\r\n'
    + 'DTSTAMP:' + toUtcIcs_(new Date()) + '\r\n'
    + 'DTSTART:' + toUtcIcs_(startDate) + '\r\n'
    + 'DTEND:' + toUtcIcs_(endDate) + '\r\n'
    + 'SUMMARY:' + sanitizeIcsText_(summary) + '\r\n'
    + 'LOCATION:' + sanitizeIcsText_(location) + '\r\n'
    + 'DESCRIPTION:' + sanitizeIcsText_(description) + '\r\n'
    + 'END:VEVENT\r\n'
    + 'END:VCALENDAR\r\n';

  return Utilities.newBlob(ics, 'text/calendar', 'turquaz-reservation.ics');
}

function toReservationDateTime_(dateText, timeText) {
  var dateKey = normalizeDateKey_(dateText);
  var timeKey = normalizeTimeKey_(timeText) || '19:00';
  var date = new Date(dateKey + 'T' + timeKey + ':00');
  if (!isNaN(date.getTime())) {
    return date;
  }

  var fallback = new Date();
  fallback.setHours(19, 0, 0, 0);
  return fallback;
}

function sanitizeIcsText_(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function toUtcIcs_(date) {
  return Utilities.formatDate(date, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
}

/* ═══════════════════════════════════════════════════════════
   TEXT UTILITIES
   ═══════════════════════════════════════════════════════════ */

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function capitalize_(value) {
  var text = String(value || '');
  if (!text) {
    return '';
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function uniqueEmails_(emails) {
  var seen = {};
  var output = [];
  for (var idx = 0; idx < emails.length; idx += 1) {
    var value = String(emails[idx] || '').trim().toLowerCase();
    if (!value || seen[value]) {
      continue;
    }
    seen[value] = true;
    output.push(value);
  }
  return output;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
