const DEFAULT_SENDER_EMAIL = 'sf@turquazsf.com';
const DEFAULT_SENDER_NAME = 'Turquaz Reservations';
const MAX_HTML_LENGTH = 100000;

function doGet() {
  return json_({ ok: true, message: 'Turquaz Gmail relay active' });
}

function doPost(event) {
  try {
    var body = JSON.parse(event.postData.contents || '{}');
    var properties = PropertiesService.getScriptProperties();
    var expectedToken = String(properties.getProperty('CONTENT_API_TOKEN') || '').trim();
    if (!expectedToken || !constantTimeEqual_(body.contentApiToken, expectedToken)) {
      return json_({ ok: false, error: 'Unauthorized' });
    }
    if (body.action !== 'sendEmail') {
      return json_({ ok: false, error: 'Unsupported action' });
    }

    var payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    var to = validateEmail_(payload.to, 'Recipient');
    var replyTo = payload.replyTo ? validateEmail_(payload.replyTo, 'Reply-To') : '';
    var subject = String(payload.subject || '').trim();
    var html = String(payload.html || '');
    if (!subject || subject.length > 200) throw new Error('Invalid subject');
    if (!html || html.length > MAX_HTML_LENGTH) throw new Error('Invalid email body');

    var senderEmail = String(properties.getProperty('SENDER_EMAIL') || DEFAULT_SENDER_EMAIL).trim();
    var senderName = String(properties.getProperty('MAIL_SENDER_NAME') || DEFAULT_SENDER_NAME).trim();
    var options = { htmlBody: html, name: senderName };
    if (replyTo) options.replyTo = replyTo;
    if (senderEmail) {
      ensureAuthorizedSender_(senderEmail);
      options.from = senderEmail;
    }

    GmailApp.sendEmail(to, subject, plainText_(html), options);
    return json_({ ok: true });
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function ensureAuthorizedSender_(senderEmail) {
  var primaryEmail = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var allowed = GmailApp.getAliases().map(function (value) { return String(value).toLowerCase(); });
  if (primaryEmail) allowed.push(primaryEmail);
  if (allowed.indexOf(String(senderEmail).toLowerCase()) === -1) {
    throw new Error('SENDER_EMAIL is not an authorized Gmail address or alias');
  }
}

function validateEmail_(value, label) {
  var email = String(value || '').trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Invalid ' + label + ' email');
  }
  return email;
}

function plainText_(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function constantTimeEqual_(left, right) {
  var leftValue = String(left || '');
  var rightValue = String(right || '');
  var length = Math.max(leftValue.length, rightValue.length);
  var difference = leftValue.length ^ rightValue.length;
  for (var index = 0; index < length; index += 1) {
    difference |= (leftValue.charCodeAt(index) || 0) ^ (rightValue.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}