import sanitizeHtml from 'sanitize-html';

const STATIC_SITEMAP_PATHS = ['/', '/menu'];
const CONTENT_TYPES = new Set(['blog', 'local_page']);
const BLOCK_TYPES = new Set(['heading', 'paragraph', 'list', 'quote', 'image', 'html', 'gallery', 'video']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const RESERVATION_CAPACITY = 15;
const ADMIN_SESSION_SECONDS = 21600;

export default {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ ok: false, error: error.message }, error.status, {
          'Cache-Control': 'no-store'
        });
      }
      console.error(error);
      return responseHtml(renderErrorPage(env, 500, 'Something went wrong'), 500, {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex'
      });
    }
  }
};

async function routeRequest(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (url.hostname === 'turquazsf.com' || (url.hostname === 'www.turquazsf.com' && url.protocol !== 'https:')) {
    return Response.redirect(`https://www.turquazsf.com${url.pathname}${url.search}`, 308);
  }

  if (url.hostname === 'www.turquazsf.com' && url.pathname === '/blog') {
    return Response.redirect('https://www.turquazsf.com/blog/', 308);
  }

  if (path.startsWith('/api/reservations') || path === '/api/contact') {
    return handlePublicApiRequest(request, env, path);
  }

  if (path.startsWith('/api/admin/')) {
    return handleAdminRequest(request, env, path);
  }

  if (path.startsWith('/api/media/') && (request.method === 'GET' || request.method === 'HEAD')) {
    return serveMedia(request, env, path);
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ ok: false, error: 'Method not allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  if (path === '/robots.txt') {
    return responseText(renderRobots(env), 200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    });
  }

  if (path === '/sitemap.xml') {
    return responseText(await renderSitemap(env), 200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    });
  }

  if (path === '/blog') {
    return responseHtml(await renderBlogIndex(env), 200, publicHeaders());
  }

  const contentRoute = matchContentRoute(path);
  if (contentRoute) {
    const entry = await getPublishedEntry(env, contentRoute.type, contentRoute.slug);
    if (!entry) {
      return responseHtml(renderErrorPage(env, 404, 'Page not found'), 404, {
        'Cache-Control': 'public, max-age=60',
        'X-Robots-Tag': 'noindex'
      });
    }
    return responseHtml(renderContentPage(env, entry), 200, publicHeaders());
  }

  return responseHtml(renderErrorPage(env, 404, 'Page not found'), 404, {
    'Cache-Control': 'public, max-age=60',
    'X-Robots-Tag': 'noindex'
  });
}

async function handleAdminRequest(request, env, path) {
  if (path === '/api/admin/login' && request.method === 'POST') {
    return loginAdmin(request, env);
  }

  if (path === '/api/admin/session' && request.method === 'GET') {
    const session = await requireAdminSession(request, env, false);
    return json({ ok: Boolean(session), expiresAt: session?.expires_at || '' }, session ? 200 : 401, noStoreHeaders());
  }

  if (path === '/api/admin/logout' && request.method === 'POST') {
    const token = bearerToken(request);
    if (token) await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, noStoreHeaders());
  }

  const internalAuthorized = Boolean(env.CONTENT_API_TOKEN) && bearerToken(request) === env.CONTENT_API_TOKEN;
  const session = internalAuthorized ? { username: 'system' } : await requireAdminSession(request, env, false);
  if (!session) {
    return json({ ok: false, error: 'Unauthorized' }, 401, { 'Cache-Control': 'no-store' });
  }

  if (path.startsWith('/api/admin/reservations')) {
    return handleReservationRequest(request, env, path);
  }

  if (path === '/api/admin/media' && request.method === 'POST') {
    return uploadMedia(request, env);
  }

  if (path === '/api/admin/seo/audit' && request.method === 'GET') {
    const result = await env.DB.prepare('SELECT * FROM content_entries ORDER BY updated_at DESC').all();
    const pages = (result.results || []).map(auditContentEntry);
    const published = pages.filter((page) => page.status === 'published');
    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      summary: {
        pages: pages.length,
        published: published.length,
        drafts: pages.filter((page) => page.status === 'draft').length,
        averageScore: published.length
          ? Math.round(published.reduce((total, page) => total + page.score, 0) / published.length)
          : 0,
        criticalIssues: published.reduce((total, page) => total + page.checks.filter((check) => check.status === 'error').length, 0)
      },
      pages
    }, 200, noStoreHeaders());
  }

  if (path === '/api/admin/content' && request.method === 'GET') {
    const result = await env.DB.prepare(`
      SELECT id, type, slug, title, excerpt, status, seo_title, seo_description,
             social_image_url, social_image_alt, primary_query, author_name,
             published_at, created_at, updated_at
      FROM content_entries
      ORDER BY updated_at DESC
    `).all();
    return json({ ok: true, entries: result.results || [] });
  }

  if (path === '/api/admin/content' && request.method === 'POST') {
    const input = validateEntryInput(await readJson(request));
    await ensureSlugAvailable(env, input.type, input.slug);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    await env.DB.prepare(`
      INSERT INTO content_entries (
        id, type, slug, title, excerpt, body_json, status, seo_title,
        seo_description, social_image_url, social_image_alt, primary_query,
        author_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, input.type, input.slug, input.title, input.excerpt,
      JSON.stringify(input.blocks), input.seoTitle, input.seoDescription,
      input.socialImageUrl, input.socialImageAlt, input.primaryQuery,
      input.authorName, now, now
    ).run();

    await logEvent(env, id, 'created', input.actor);
    return json({ ok: true, id, status: 'draft' }, 201);
  }

  const match = path.match(/^\/api\/admin\/content\/([a-f0-9-]+)(?:\/(publish|archive))?$/);
  if (!match) {
    return json({ ok: false, error: 'Not found' }, 404);
  }

  const id = match[1];
  const action = match[2] || '';
  const existing = await env.DB.prepare('SELECT * FROM content_entries WHERE id = ?').bind(id).first();
  if (!existing) {
    return json({ ok: false, error: 'Content entry not found' }, 404);
  }

  if (!action && request.method === 'GET') {
    return json({ ok: true, entry: mapEntry(existing) });
  }

  if (!action && request.method === 'PUT') {
    const input = validateEntryInput(await readJson(request));
    await ensureSlugAvailable(env, input.type, input.slug, id);
    const now = new Date().toISOString();
    await saveRevision(env, existing, input.actor);
    await env.DB.prepare(`
      UPDATE content_entries
      SET type = ?, slug = ?, title = ?, excerpt = ?, body_json = ?,
          seo_title = ?, seo_description = ?, social_image_url = ?,
          social_image_alt = ?, primary_query = ?, author_name = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      input.type, input.slug, input.title, input.excerpt, JSON.stringify(input.blocks),
      input.seoTitle, input.seoDescription, input.socialImageUrl,
      input.socialImageAlt, input.primaryQuery, input.authorName, now, id
    ).run();
    await logEvent(env, id, 'updated', input.actor);
    return json({ ok: true, id });
  }

  if (action === 'publish' && request.method === 'POST') {
    const now = new Date().toISOString();
    const actor = String((await readJson(request)).actor || 'admin').slice(0, 80);
    await saveRevision(env, existing, actor);
    await env.DB.prepare(`
      UPDATE content_entries
      SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ?
      WHERE id = ?
    `).bind(now, now, id).run();
    await logEvent(env, id, 'published', actor);
    return json({ ok: true, id, status: 'published', publishedAt: existing.published_at || now });
  }

  if (action === 'archive' && request.method === 'POST') {
    const now = new Date().toISOString();
    const actor = String((await readJson(request)).actor || 'admin').slice(0, 80);
    await saveRevision(env, existing, actor);
    await env.DB.prepare("UPDATE content_entries SET status = 'archived', updated_at = ? WHERE id = ?")
      .bind(now, id).run();
    await logEvent(env, id, 'archived', actor);
    return json({ ok: true, id, status: 'archived' });
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}

async function handlePublicApiRequest(request, env, path) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: apiCorsHeaders(request, env) });

  if (path === '/api/reservations/availability' && request.method === 'GET') {
    const date = validateDate(new URL(request.url).searchParams.get('date'));
    const slots = await reservationAvailability(env, date);
    return json({ ok: true, date, slots }, 200, apiHeaders(request, env));
  }

  if (path === '/api/reservations' && request.method === 'POST') {
    await enforcePublicRateLimit(request, env, 'reserve', 6, 3600);
    const input = validateReservation(await readJson(request));
    const manageToken = randomToken();
    const tokenExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const created = await createReservation(env, { ...input, manageToken, tokenExpiresAt });
    const email = await sendReservationEmails(env, { ...input, token: manageToken, tokenExpiresAt }, 'confirmed');
    return json({
      ok: true,
      id: created.id,
      emailSent: email.ok,
      emailCustomerOk: Boolean(email.emailCustomerOk),
      emailTeamOk: Boolean(email.emailTeamOk)
    }, 201, apiHeaders(request, env));
  }

  if (path === '/api/reservations/cancel' && request.method === 'POST') {
    await enforcePublicRateLimit(request, env, 'cancel', 12, 3600);
    const token = String((await readJson(request)).token || '').trim();
    const reservation = await reservationByToken(env, token);
    if (!reservation) throw new HttpError(404, 'Reservation not found');
    if (reservation.status === 'canceled') throw new HttpError(409, 'Reservation already canceled');
    if (!reservation.token_expires_at || new Date(reservation.token_expires_at).getTime() < Date.now()) {
      throw new HttpError(410, 'Reservation link expired');
    }
    const canceledAt = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE reservations
      SET status = 'canceled', canceled_at = ?, manage_token = NULL, token_expires_at = NULL
      WHERE id = ?
    `).bind(canceledAt, reservation.id).run();
    const email = await sendReservationEmails(env, mapReservation(reservation), 'canceled');
    return json({
      ok: true,
      date: reservation.reservation_date,
      time: reservation.reservation_time,
      name: reservation.name,
      emailSent: email.ok
    }, 200, apiHeaders(request, env));
  }

  if (path === '/api/contact' && request.method === 'POST') {
    await enforcePublicRateLimit(request, env, 'contact', 5, 3600);
    const raw = await readJson(request);
    const payload = {
      name: boundedText(raw.name, 120, 'Name'),
      email: String(raw.email || '').trim().slice(0, 254),
      phone: String(raw.phone || '').trim().slice(0, 40),
      subject: boundedText(raw.subject, 160, 'Subject'),
      message: boundedText(raw.message, 4000, 'Message')
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) throw new HttpError(400, 'Invalid email address');
    const email = await sendContactEmail(env, payload);
    if (!email.ok) throw new HttpError(502, 'Unable to send message');
    return json({ ok: true }, 200, apiHeaders(request, env));
  }

  return json({ ok: false, error: 'Not found' }, 404, apiHeaders(request, env));
}

async function loginAdmin(request, env) {
  const clientKey = await clientFingerprint(request, 'admin-login');
  const now = Date.now();
  const attempt = await env.DB.prepare('SELECT * FROM admin_login_attempts WHERE client_key = ?').bind(clientKey).first();
  if (attempt?.blocked_until && new Date(attempt.blocked_until).getTime() > now) {
    return json({ ok: false, error: 'Too many login attempts. Try again later.' }, 429, noStoreHeaders());
  }

  const body = await readJson(request);
  const username = String(body.username || '').trim();
  const expectedUser = String(env.ADMIN_USER || 'admin');
  const valid = Boolean(env.ADMIN_PASSWORD) && timingSafeEqual(username, expectedUser) && timingSafeEqual(String(body.password || ''), env.ADMIN_PASSWORD);
  if (!valid) {
    const windowStarted = attempt?.window_started_at ? new Date(attempt.window_started_at).getTime() : 0;
    const attempts = now - windowStarted < 15 * 60 * 1000 ? Number(attempt?.attempts || 0) + 1 : 1;
    const blockedUntil = attempts >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : null;
    await env.DB.prepare(`
      INSERT INTO admin_login_attempts (client_key, attempts, window_started_at, blocked_until)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(client_key) DO UPDATE SET attempts = excluded.attempts,
        window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until
    `).bind(clientKey, attempts, new Date(now).toISOString(), blockedUntil).run();
    return json({ ok: false, error: 'Invalid credentials' }, 401, noStoreHeaders());
  }

  await env.DB.prepare('DELETE FROM admin_login_attempts WHERE client_key = ?').bind(clientKey).run();
  await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(new Date().toISOString()).run();
  const token = randomToken();
  const expiresAt = new Date(now + ADMIN_SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare('INSERT INTO admin_sessions (token_hash, username, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), username, expiresAt, new Date(now).toISOString()).run();
  return json({ ok: true, sessionToken: token, expiresAt }, 200, noStoreHeaders());
}

async function requireAdminSession(request, env, throwOnFailure = true) {
  const token = bearerToken(request);
  const session = token
    ? await env.DB.prepare('SELECT username, expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
      .bind(await sha256(token), new Date().toISOString()).first()
    : null;
  if (!session && throwOnFailure) throw new HttpError(401, 'Unauthorized');
  return session;
}

async function handleReservationRequest(request, env, path) {
  const url = new URL(request.url);

  if (path === '/api/admin/reservations/availability' && request.method === 'GET') {
    const date = validateDate(url.searchParams.get('date'));
    const slots = await reservationAvailability(env, date);
    return json({ ok: true, date, slots });
  }

  if (path === '/api/admin/reservations' && request.method === 'GET') {
    const date = validateDate(url.searchParams.get('date'));
    const result = await env.DB.prepare(`
      SELECT id, created_at, name, phone, email, reservation_date, reservation_time,
             guests, note, meal, status, canceled_at
      FROM reservations
      WHERE reservation_date = ?
      ORDER BY reservation_time, created_at
    `).bind(date).all();
    return json({ ok: true, rows: (result.results || []).map(mapReservation) });
  }

  if (path === '/api/admin/reservations' && request.method === 'POST') {
    const input = validateReservation(await readJson(request));
    const manageToken = randomToken();
    const tokenExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const created = await createReservation(env, { ...input, manageToken, tokenExpiresAt });
    const email = await sendReservationEmails(env, { ...input, token: manageToken, tokenExpiresAt }, 'confirmed');
    return json({ ok: true, ...created, emailSent: email.ok }, 201);
  }

  if (path === '/api/admin/reservations/delete' && request.method === 'POST') {
    const input = await readJson(request);
    const id = String(input.id || '').trim();
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new HttpError(400, 'Invalid reservation ID');
    const reservation = await env.DB.prepare('SELECT * FROM reservations WHERE id = ? LIMIT 1').bind(id).first();
    if (!reservation) throw new HttpError(404, 'Reservation not found');
    const result = await env.DB.prepare('DELETE FROM reservations WHERE id = ?').bind(reservation.id).run();
    if (!result.meta?.changes) throw new HttpError(404, 'Reservation not found');
    const email = await sendReservationEmails(env, mapReservation(reservation), 'canceled');
    return json({ ok: true, emailSent: email.ok });
  }

  if (path === '/api/admin/reservations/import' && request.method === 'POST') {
    const body = await readJson(request);
    if (!Array.isArray(body.reservations) || body.reservations.length === 0 || body.reservations.length > 250) {
      throw new HttpError(400, 'Import requires 1-250 reservations');
    }
    const inputs = body.reservations.map((value) => validateReservation(value, true));
    const statements = inputs.map((input) => env.DB.prepare(`
      INSERT OR IGNORE INTO reservations (
        id, source_key, created_at, name, phone, email, reservation_date,
        reservation_time, guests, note, meal, manage_token, token_expires_at,
        status, canceled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.id || crypto.randomUUID(), input.sourceKey, input.createdAt, input.name,
      input.phone, input.email, input.date, input.time, input.guests, input.note,
      input.meal, input.manageToken, input.tokenExpiresAt, input.status, input.canceledAt
    ));
    const results = await env.DB.batch(statements);
    const imported = results.reduce((total, result) => total + Number(result.meta?.changes || 0), 0);
    return json({ ok: true, imported, skipped: inputs.length - imported });
  }

  const tokenMatch = path.match(/^\/api\/admin\/reservations\/token\/([^/]+)(?:\/(cancel))?$/);
  if (tokenMatch) {
    const token = decodeURIComponent(tokenMatch[1]);
    if (!token || token.length > 200) throw new HttpError(400, 'Invalid reservation token');
    const existing = await env.DB.prepare('SELECT * FROM reservations WHERE manage_token = ? LIMIT 1').bind(token).first();
    if (!existing) throw new HttpError(404, 'Reservation not found');

    if (!tokenMatch[2] && request.method === 'GET') {
      return json({ ok: true, reservation: mapReservation(existing, true) });
    }

    if (tokenMatch[2] === 'cancel' && request.method === 'POST') {
      if (existing.status === 'canceled') throw new HttpError(409, 'Reservation already canceled');
      const canceledAt = new Date().toISOString();
      await env.DB.prepare(`
        UPDATE reservations
        SET status = 'canceled', canceled_at = ?, manage_token = NULL, token_expires_at = NULL
        WHERE id = ?
      `).bind(canceledAt, existing.id).run();
      const reservation = mapReservation({ ...existing, status: 'canceled', canceled_at: canceledAt });
      const email = await sendReservationEmails(env, reservation, 'canceled');
      return json({ ok: true, reservation, emailSent: email.ok });
    }
  }

  return json({ ok: false, error: 'Not found' }, 404);
}

async function uploadMedia(request, env) {
  if (!env.MEDIA) throw new HttpError(503, 'Media storage is not configured');
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw new HttpError(400, 'Choose an image to upload');
  if (!IMAGE_TYPES.has(file.type)) throw new HttpError(400, 'Upload a JPEG, PNG, WebP or GIF image');
  if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image must be 8 MB or smaller');

  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
  const baseName = String(file.name || 'image').replace(/\.[^.]+$/, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image';
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}-${baseName}.${extension}`;
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
    customMetadata: { originalName: String(file.name || '').slice(0, 180), uploadedBy: 'admin' }
  });
  return json({ ok: true, url: siteUrl(env, `/api/media/${key}`), key, size: file.size, contentType: file.type }, 201, noStoreHeaders());
}

async function serveMedia(request, env, path) {
  if (!env.MEDIA) return json({ ok: false, error: 'Media storage is not configured' }, 503);
  const key = decodeURIComponent(path.slice('/api/media/'.length));
  if (!key || key.includes('..') || key.includes('\\')) return json({ ok: false, error: 'Invalid media path' }, 400);
  const object = request.method === 'HEAD' ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
  if (!object) return json({ ok: false, error: 'Image not found' }, 404, { 'Cache-Control': 'public, max-age=60' });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

async function reservationAvailability(env, date) {
  const result = await env.DB.prepare(`
    SELECT reservation_time AS time, SUM(guests) AS guests
    FROM reservations
    WHERE reservation_date = ? AND status = 'active'
    GROUP BY reservation_time
  `).bind(date).all();
  return Object.fromEntries((result.results || []).map((row) => [row.time, Number(row.guests || 0)]));
}

async function createReservation(env, input) {
  const id = input.id || crypto.randomUUID();
  const result = await env.DB.prepare(`
    INSERT INTO reservations (
      id, source_key, created_at, name, phone, email, reservation_date,
      reservation_time, guests, note, meal, manage_token, token_expires_at,
      status, canceled_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL
    WHERE ? + COALESCE((
      SELECT SUM(guests) FROM reservations
      WHERE reservation_date = ? AND reservation_time = ? AND status = 'active'
    ), 0) <= ?
  `).bind(
    id, input.sourceKey, input.createdAt, input.name, input.phone, input.email,
    input.date, input.time, input.guests, input.note, input.meal,
    input.manageToken, input.tokenExpiresAt, input.guests, input.date,
    input.time, RESERVATION_CAPACITY
  ).run();
  if (!result.meta?.changes) throw new HttpError(409, 'Timeslot capacity exceeded');
  return { id, manageToken: input.manageToken, tokenExpiresAt: input.tokenExpiresAt };
}

async function reservationByToken(env, token) {
  if (!token || token.length > 200) throw new HttpError(400, 'Invalid reservation token');
  return env.DB.prepare('SELECT * FROM reservations WHERE manage_token = ? LIMIT 1').bind(token).first();
}

async function sendReservationEmails(env, payload, status) {
  const date = String(payload.date || payload.reservation_date || '');
  const time = String(payload.time || payload.reservation_time || '');
  const guests = Number(payload.guests || 0);
  const name = String(payload.name || 'Guest');
  const customerEmail = String(payload.email || '').trim();
  const isCanceled = status === 'canceled';
  const subject = isCanceled
    ? `Turquaz reservation canceled - ${date} at ${time}`
    : `Turquaz reservation confirmed - ${date} at ${time}`;
  const heading = isCanceled ? 'Your reservation is canceled' : 'Your reservation is confirmed';
  const manageToken = String(payload.token || payload.manageToken || payload.manage_token || '');
  const manageUrl = manageToken
    ? `${String(env.SITE_URL || '').replace(/\/$/, '')}/?cancel=${encodeURIComponent(manageToken)}#reservation`
    : '';
  const html = reservationEmailHtml({ ...payload, date, time, guests, name }, heading, manageUrl, isCanceled);
  const teamEmail = String(env.NOTIFICATION_EMAIL || 'sf@oklavacafe.com').trim();
  const results = await Promise.all([
    sendTransactionalEmail(env, { to: customerEmail, subject, html }),
    sendTransactionalEmail(env, {
      to: teamEmail,
      subject: `${isCanceled ? 'Canceled' : 'New'} reservation: ${name}, ${date} at ${time}`,
      html,
      replyTo: customerEmail
    })
  ]);
  return { ok: results.some(Boolean), emailCustomerOk: results[0], emailTeamOk: results[1] };
}

async function sendContactEmail(env, payload) {
  const to = String(env.NOTIFICATION_EMAIL || 'sf@oklavacafe.com').trim();
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172126">`
    + `<h1>Website message</h1><p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>`
    + `<p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>`
    + `<p><strong>Phone:</strong> ${escapeHtml(payload.phone || 'Not provided')}</p>`
    + `<p><strong>Subject:</strong> ${escapeHtml(payload.subject)}</p>`
    + `<p style="white-space:pre-wrap">${escapeHtml(payload.message)}</p></body></html>`;
  const ok = await sendTransactionalEmail(env, {
    to,
    subject: `Website message: ${payload.subject}`,
    html,
    replyTo: payload.email
  });
  return { ok };
}

async function sendTransactionalEmail(env, { to, subject, html, replyTo = '' }) {
  if (!env.EMAIL_WEBHOOK_URL || !env.CONTENT_API_TOKEN || !to) {
    console.error('Gmail relay is not configured');
    return false;
  }
  try {
    const response = await fetch(env.EMAIL_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        action: 'sendEmail',
        contentApiToken: env.CONTENT_API_TOKEN,
        payload: { to, subject, html, replyTo }
      }),
      redirect: 'follow'
    });
    const result = await response.json();
    if (!response.ok || !result?.ok) console.error('Gmail relay failed', response.status, result?.error || 'Unknown error');
    return response.ok && Boolean(result?.ok);
  } catch (error) {
    console.error('Gmail relay failed', error);
    return false;
  }
}

function reservationEmailHtml(payload, heading, manageUrl, isCanceled) {
  const rows = [
    ['Name', payload.name],
    ['Date', payload.date],
    ['Time', payload.time],
    ['Guests', payload.guests],
    ['Meal', payload.meal],
    ['Phone', payload.phone],
    ['Email', payload.email],
    ['Special request', payload.note || 'None']
  ].map(([label, value]) => `<tr><td style="padding:8px 12px;color:#60717a">${escapeHtml(label)}</td>`
    + `<td style="padding:8px 12px"><strong>${escapeHtml(String(value || ''))}</strong></td></tr>`).join('');
  const action = !isCanceled && manageUrl
    ? `<p style="margin-top:24px"><a href="${escapeHtml(manageUrl)}" style="background:#2a4192;color:#fff;padding:11px 18px;text-decoration:none;border-radius:4px">Manage reservation</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f3f6f8;font-family:Arial,sans-serif;color:#172126">`
    + `<div style="max-width:620px;margin:24px auto;background:#fff;padding:28px;border:1px solid #d9e2e8">`
    + `<p style="color:#2a4192;font-weight:bold">TURQUAZ</p><h1>${escapeHtml(heading)}</h1>`
    + `<table style="width:100%;border-collapse:collapse;background:#f7fafb">${rows}</table>${action}`
    + `<p style="margin-top:28px;color:#60717a">Turquaz, San Francisco</p></div></body></html>`;
}

async function enforcePublicRateLimit(request, env, action, maximum, windowSeconds) {
  const key = await clientFingerprint(request, action);
  const now = Date.now();
  const existing = await env.DB.prepare('SELECT requests, window_started_at FROM public_rate_limits WHERE client_key = ?').bind(key).first();
  const windowStart = existing?.window_started_at ? new Date(existing.window_started_at).getTime() : 0;
  const withinWindow = now - windowStart < windowSeconds * 1000;
  const requests = withinWindow ? Number(existing?.requests || 0) + 1 : 1;
  if (withinWindow && requests > maximum) throw new HttpError(429, 'Too many requests. Try again later.');
  await env.DB.prepare(`
    INSERT INTO public_rate_limits (client_key, requests, window_started_at)
    VALUES (?, ?, ?)
    ON CONFLICT(client_key) DO UPDATE SET requests = excluded.requests, window_started_at = excluded.window_started_at
  `).bind(key, requests, withinWindow ? existing.window_started_at : new Date(now).toISOString()).run();
}

async function clientFingerprint(request, purpose) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return sha256(`${purpose}:${ip}`);
}

function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(String(left));
  const rightBytes = new TextEncoder().encode(String(right));
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

function noStoreHeaders() {
  return { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
}

function apiHeaders(request, env) {
  return { ...noStoreHeaders(), ...apiCorsHeaders(request, env) };
}

function apiCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = new Set([String(env.SITE_URL || '').replace(/\/$/, ''), 'https://turquazsf.com']);
  return {
    ...(allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
  };
}

function validateReservation(value, importing = false) {
  const name = boundedText(value.name, 120, 'Name');
  const phone = boundedText(value.phone, 40, 'Phone');
  const email = String(value.email || '').trim().slice(0, 254);
  const date = validateDate(value.date);
  const time = validateTime(value.time);
  const guests = Number(value.guests);
  const meal = String(value.meal || inferMeal(time)).toLowerCase();
  const manageToken = String(value.manageToken || '').trim() || null;
  const tokenExpiresAt = String(value.tokenExpiresAt || '').trim() || null;
  const status = importing ? String(value.status || 'active').toLowerCase() : 'active';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Invalid email address');
  if (!Number.isInteger(guests) || guests < 1 || guests > RESERVATION_CAPACITY) throw new HttpError(400, 'Invalid guest count');
  if (!['breakfast', 'lunch', 'dinner'].includes(meal)) throw new HttpError(400, 'Invalid meal');
  if (!['active', 'canceled'].includes(status)) throw new HttpError(400, 'Invalid reservation status');
  if (manageToken && manageToken.length > 200) throw new HttpError(400, 'Invalid reservation token');

  return {
    id: String(value.id || '').trim() || null,
    sourceKey: String(value.sourceKey || '').trim() || null,
    createdAt: validTimestamp(value.createdAt) || new Date().toISOString(),
    name,
    phone,
    email,
    date,
    time,
    guests,
    note: String(value.note || '').trim().slice(0, 2000),
    meal,
    manageToken,
    tokenExpiresAt: validTimestamp(tokenExpiresAt),
    status,
    canceledAt: validTimestamp(value.canceledAt)
  };
}

function validateDate(value) {
  const date = String(value || '').trim();
  if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new HttpError(400, 'Invalid reservation date');
  return date;
}

function validateTime(value) {
  const time = String(value || '').trim();
  if (!TIME_PATTERN.test(time)) throw new HttpError(400, 'Invalid reservation time');
  const [hour, minute] = time.split(':').map(Number);
  if (hour > 23 || minute > 59) throw new HttpError(400, 'Invalid reservation time');
  return time;
}

function validTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inferMeal(time) {
  if (time >= '08:00' && time <= '11:30') return 'breakfast';
  if (time >= '12:00' && time <= '16:30') return 'lunch';
  return 'dinner';
}

function mapReservation(row, includeToken = false) {
  return {
    id: row.id,
    createdAt: row.created_at,
    name: row.name,
    phone: row.phone,
    email: row.email,
    date: row.reservation_date,
    time: row.reservation_time,
    guests: Number(row.guests || 0),
    note: row.note || '',
    meal: row.meal,
    status: row.status,
    canceledAt: row.canceled_at || '',
    ...(includeToken ? { manageToken: row.manage_token || '', tokenExpiresAt: row.token_expires_at || '' } : {})
  };
}

function validateEntryInput(value) {
  const type = String(value.type || '').trim();
  const slug = String(value.slug || '').trim().toLowerCase();
  const title = String(value.title || '').trim();
  const excerpt = String(value.excerpt || '').trim();
  const seoTitle = String(value.seoTitle || '').trim();
  const seoDescription = String(value.seoDescription || '').trim();
  const socialImageUrl = optionalHttpsUrl(value.socialImageUrl);
  const socialImageAlt = String(value.socialImageAlt || '').trim();
  const primaryQuery = String(value.primaryQuery || '').trim();
  const authorName = String(value.authorName || 'Turquaz').trim();
  const actor = String(value.actor || 'admin').trim().slice(0, 80);
  const blocks = validateBlocks(value.blocks);

  if (!CONTENT_TYPES.has(type)) throw new HttpError(400, 'Invalid content type');
  if (!SLUG_PATTERN.test(slug) || slug.length > 100) throw new HttpError(400, 'Invalid slug');
  if (title.length < 3 || title.length > 120) throw new HttpError(400, 'Title must be 3-120 characters');
  if (excerpt.length > 320) throw new HttpError(400, 'Excerpt must be 320 characters or fewer');
  if (seoTitle.length > 70) throw new HttpError(400, 'SEO title must be 70 characters or fewer');
  if (seoDescription.length > 170) throw new HttpError(400, 'SEO description must be 170 characters or fewer');
  if (socialImageUrl && !socialImageAlt) throw new HttpError(400, 'Social image alt text is required');
  if (authorName.length > 80) throw new HttpError(400, 'Author name is too long');

  return {
    type, slug, title, excerpt, blocks, seoTitle, seoDescription,
    socialImageUrl, socialImageAlt, primaryQuery, authorName, actor
  };
}

function validateBlocks(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new HttpError(400, 'Content requires 1-200 structured blocks');
  }

  return value.map((raw, index) => {
    const type = String(raw?.type || '');
    if (!BLOCK_TYPES.has(type)) throw new HttpError(400, `Unsupported block at position ${index + 1}`);

    if (type === 'image') {
      const url = requiredHttpsUrl(raw.url, `Image URL at position ${index + 1}`);
      const alt = String(raw.alt || '').trim();
      if (!alt || alt.length > 180) throw new HttpError(400, `Image alt text is required at position ${index + 1}`);
      return { type, url, alt, caption: String(raw.caption || '').trim().slice(0, 240) };
    }

    if (type === 'gallery') {
      if (!Array.isArray(raw.images) || raw.images.length < 2 || raw.images.length > 20) {
        throw new HttpError(400, `Gallery at position ${index + 1} requires 2-20 images`);
      }
      return {
        type,
        images: raw.images.map((image, imageIndex) => ({
          url: requiredHttpsUrl(image?.url, `Gallery image ${imageIndex + 1}`),
          alt: boundedText(image?.alt, 180, `Gallery image ${imageIndex + 1} alt text`),
          caption: String(image?.caption || '').trim().slice(0, 240)
        }))
      };
    }

    if (type === 'video') {
      return {
        type,
        url: safeVideoUrl(raw.url, index + 1),
        title: boundedText(raw.title, 160, `Video title at position ${index + 1}`),
        caption: String(raw.caption || '').trim().slice(0, 240)
      };
    }

    if (type === 'html') {
      const html = cleanRichHtml(raw.html);
      if (!html || html.length > 100000) throw new HttpError(400, `Rich content at position ${index + 1} is empty or too long`);
      return { type, html };
    }

    if (type === 'list') {
      if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > 40) {
        throw new HttpError(400, `List at position ${index + 1} requires 1-40 items`);
      }
      return {
        type,
        ordered: Boolean(raw.ordered),
        items: raw.items.map((item) => boundedText(item, 500, `List item at position ${index + 1}`))
      };
    }

    const text = boundedText(raw.text, 5000, `Text at position ${index + 1}`);
    if (type === 'heading') {
      const level = Number(raw.level || 2);
      if (![2, 3].includes(level)) throw new HttpError(400, 'Heading level must be 2 or 3');
      return { type, level, text };
    }
    return { type, text };
  });
}

async function getPublishedEntry(env, type, slug) {
  return env.DB.prepare(`
    SELECT * FROM content_entries
    WHERE type = ? AND slug = ? AND status = 'published'
    LIMIT 1
  `).bind(type, slug).first();
}

async function renderBlogIndex(env) {
  const result = await env.DB.prepare(`
    SELECT slug, title, excerpt, author_name, published_at, social_image_url, social_image_alt
    FROM content_entries
    WHERE type = 'blog' AND status = 'published'
    ORDER BY published_at DESC
  `).all();
  const entries = result.results || [];
  const cards = entries.length
    ? entries.map((entry) => `
        <article class="content-card">
          ${entry.social_image_url ? `<img src="${escapeAttr(entry.social_image_url)}" alt="${escapeAttr(entry.social_image_alt)}" loading="lazy" decoding="async">` : ''}
          <div>
            <p class="eyebrow">Turquaz Journal</p>
            <h2><a href="/blog/${escapeAttr(entry.slug)}">${escapeHtml(entry.title)}</a></h2>
            <p>${escapeHtml(entry.excerpt)}</p>
            <p class="meta">${escapeHtml(entry.author_name)} · ${formatDate(entry.published_at)}</p>
          </div>
        </article>`).join('')
    : '<p class="empty-state">New stories from the Turquaz kitchen are coming soon.</p>';

  return pageShell(env, {
    title: 'Turquaz Journal | Turkish Food and Culture in San Francisco',
    description: 'Stories about Turkish food, coffee, ingredients and dining in San Francisco from the team at Turquaz.',
    canonicalPath: '/blog/',
    body: `<main class="journal"><header class="journal-head"><p class="eyebrow">From the kitchen</p><h1>Turquaz Journal</h1><p>Turkish food, coffee and gathering in San Francisco.</p></header><section class="content-grid" aria-label="Articles">${cards}</section></main>`
  });
}

function renderContentPage(env, entry) {
  const typePath = entry.type === 'blog' ? 'blog' : 'san-francisco';
  const canonicalPath = `/${typePath}/${entry.slug}`;
  const blocks = parseBlocks(entry.body_json);
  const articleBody = blocks.map(renderBlock).join('');
  const title = entry.seo_title || entry.title;
  const description = entry.seo_description || entry.excerpt;
  const pageSchema = {
    '@type': entry.type === 'blog' ? 'BlogPosting' : 'WebPage',
    '@id': `${siteUrl(env, canonicalPath)}#${entry.type === 'blog' ? 'article' : 'webpage'}`,
    headline: entry.title,
    description,
    url: siteUrl(env, canonicalPath),
    datePublished: entry.published_at,
    dateModified: entry.updated_at,
    author: { '@id': `${siteUrl(env, '/')}#restaurant` },
    publisher: { '@id': `${siteUrl(env, '/')}#restaurant` }
  };
  if (entry.social_image_url) pageSchema.image = entry.social_image_url;
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      pageSchema,
      {
        '@type': 'Restaurant',
        '@id': `${siteUrl(env, '/')}#restaurant`,
        name: 'Turquaz',
        url: siteUrl(env, '/'),
        telephone: '+1-415-791-0770',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '1198 Mission St',
          addressLocality: 'San Francisco',
          addressRegion: 'CA',
          postalCode: '94102',
          addressCountry: 'US'
        }
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: entry.type === 'blog'
          ? [
              { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl(env, '/') },
              { '@type': 'ListItem', position: 2, name: 'Journal', item: siteUrl(env, '/blog/') },
              { '@type': 'ListItem', position: 3, name: entry.title, item: siteUrl(env, canonicalPath) }
            ]
          : [
              { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl(env, '/') },
              { '@type': 'ListItem', position: 2, name: entry.title, item: siteUrl(env, canonicalPath) }
            ]
      }
    ]
  };

  const breadcrumbs = entry.type === 'blog'
    ? '<a href="/">Home</a><span>/</span><a href="/blog/">Journal</a>'
    : '<a href="/">Home</a><span>/</span><span>San Francisco</span>';

  return pageShell(env, {
    title,
    description,
    canonicalPath,
    ogType: entry.type === 'blog' ? 'article' : 'website',
    image: entry.social_image_url,
    imageAlt: entry.social_image_alt,
    schema,
    body: `<main class="article-shell"><article><nav class="breadcrumbs" aria-label="Breadcrumb">${breadcrumbs}</nav><header class="article-head"><p class="eyebrow">${entry.type === 'blog' ? 'Turquaz Journal' : 'San Francisco dining'}</p><h1>${escapeHtml(entry.title)}</h1><p class="dek">${escapeHtml(entry.excerpt)}</p><p class="meta">${escapeHtml(entry.author_name)} · ${formatDate(entry.published_at)}</p></header>${articleBody}<aside class="article-cta"><h2>Join us at Turquaz</h2><p>Explore our Turkish and Mediterranean menu or reserve a table in San Francisco.</p><div><a class="button" href="/menu">View menu</a><a class="text-link" href="/#reservation">Reserve a table</a></div></aside></article></main>`
  });
}

function renderBlock(block) {
  if (block.type === 'heading') return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
  if (block.type === 'paragraph') return `<p>${escapeHtml(block.text)}</p>`;
  if (block.type === 'quote') return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
  if (block.type === 'list') {
    const tag = block.ordered ? 'ol' : 'ul';
    return `<${tag}>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
  }
  if (block.type === 'image') {
    return `<figure><img src="${escapeAttr(block.url)}" alt="${escapeAttr(block.alt)}" loading="lazy" decoding="async">${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''}</figure>`;
  }
  if (block.type === 'gallery') {
    return `<div class="article-gallery">${block.images.map((image) => `<figure><img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.alt)}" loading="lazy" decoding="async">${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`;
  }
  if (block.type === 'video') {
    return `<figure class="article-video"><iframe src="${escapeAttr(block.url)}" title="${escapeAttr(block.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''}</figure>`;
  }
  if (block.type === 'html') return `<div class="rich-content">${cleanRichHtml(block.html)}</div>`;
  return '';
}

function pageShell(env, options) {
  const canonical = siteUrl(env, options.canonicalPath);
  const image = options.image || siteUrl(env, '/assets/images/hero.jpeg');
  const imageAlt = options.imageAlt || 'Turquaz Turkish restaurant in San Francisco';
  const schema = options.schema ? `<script type="application/ld+json">${safeJson(options.schema)}</script>` : '';
  const analyticsId = String(env.GA_MEASUREMENT_ID || '').trim();
  const analytics = /^G-[A-Z0-9]+$/.test(analyticsId) ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${analyticsId}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${analyticsId}');</script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeAttr(options.description)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta name="theme-color" content="#2a4192">
  <meta property="og:type" content="${escapeAttr(options.ogType || 'website')}">
  <meta property="og:site_name" content="Turquaz">
  <meta property="og:title" content="${escapeAttr(options.title)}">
  <meta property="og:description" content="${escapeAttr(options.description)}">
  <meta property="og:url" content="${escapeAttr(canonical)}">
  <meta property="og:image" content="${escapeAttr(image)}">
  <meta property="og:image:alt" content="${escapeAttr(imageAlt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttr(options.title)}">
  <meta name="twitter:description" content="${escapeAttr(options.description)}">
  <meta name="twitter:image" content="${escapeAttr(image)}">
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <title>${escapeHtml(options.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Manrope:wght@400;500;600&display=swap" rel="stylesheet">
  <style>${pageStyles()}</style>
  <style>.article-gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:48px 0}.article-gallery figure{margin:0}.article-gallery img{width:100%;aspect-ratio:4/3;object-fit:cover}.article-video iframe{width:100%;aspect-ratio:16/9;border:0}.rich-content{font-size:18px}.rich-content a{color:var(--blue)}.rich-content table{display:block;width:100%;overflow-x:auto;border-collapse:collapse}.rich-content th,.rich-content td{padding:10px;border:1px solid #dedbd2;text-align:left}.rich-content hr{margin:48px 0;border:0;border-top:1px solid #dedbd2}@media(max-width:620px){.article-gallery{grid-template-columns:1fr}.article-video{margin-inline:0}}</style>
  ${schema}
  ${analytics}
</head>
<body>
  <header class="site-nav"><a class="brand" href="/">turquaz</a><nav aria-label="Main navigation"><a href="/menu">Menu</a><a href="/blog/">Journal</a><a class="reserve" href="/#reservation">Reserve</a></nav></header>
  ${options.body}
  <footer><strong>turquaz</strong><p>1198 Mission St, San Francisco, CA 94102 · <a href="tel:+14157910770">+1 415-791-0770</a></p></footer>
</body>
</html>`;
}

function pageStyles() {
  return `:root{--ink:#14252a;--blue:#2a4192;--gold:#b8944e;--paper:#fbfaf7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Manrope,sans-serif;line-height:1.75}.site-nav{min-height:72px;padding:16px clamp(20px,5vw,72px);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dedbd2;background:#fff}.brand{font:600 32px/1 "Cormorant Garamond",serif;color:var(--blue);text-decoration:none}.site-nav nav{display:flex;align-items:center;gap:24px}.site-nav nav a{color:var(--ink);text-decoration:none;font-size:14px}.site-nav .reserve,.button{background:var(--blue);color:#fff;padding:10px 18px;text-decoration:none}.journal,.article-shell{width:min(1120px,calc(100% - 40px));margin:0 auto}.journal-head,.article-head{padding:clamp(64px,10vw,120px) 0 48px;max-width:780px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:12px;color:var(--gold);font-weight:600}h1,h2,h3{font-family:"Cormorant Garamond",serif;line-height:1.08;letter-spacing:0}h1{font-size:clamp(46px,8vw,82px);margin:8px 0 20px}h2{font-size:36px;margin-top:56px}h3{font-size:28px;margin-top:40px}.content-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;padding-bottom:96px}.content-card{border-top:3px solid var(--blue);background:#fff}.content-card img{width:100%;aspect-ratio:16/9;object-fit:cover}.content-card>div{padding:24px}.content-card h2{font-size:31px;margin:8px 0}.content-card h2 a{color:var(--ink);text-decoration:none}.meta{font-size:13px;color:#66777c}.article-shell article{max-width:780px;margin:0 auto;padding-bottom:96px}.breadcrumbs{padding-top:32px;display:flex;gap:10px;font-size:13px}.breadcrumbs a,.text-link{color:var(--blue)}.dek{font-size:20px;color:#4e6269}.article-shell article>p,.article-shell article>ul,.article-shell article>ol,.article-shell article>blockquote{font-size:18px}.article-shell figure{margin:48px 0}.article-shell figure img{width:100%;height:auto}.article-shell figcaption{font-size:13px;color:#66777c}.article-shell blockquote{margin:40px 0;padding:18px 28px;border-left:3px solid var(--gold);font-family:"Cormorant Garamond",serif;font-size:27px}.article-cta{margin-top:64px;padding:32px;border-top:3px solid var(--blue);background:#fff}.article-cta h2{margin:0 0 8px}.article-cta div{display:flex;gap:20px;align-items:center;margin-top:20px}footer{padding:40px clamp(20px,5vw,72px);background:#102f38;color:#fff}footer a{color:#fff}@media(max-width:600px){.site-nav nav a:not(.reserve){display:none}.article-head{padding-top:52px}.article-cta div{align-items:flex-start;flex-direction:column}}`;
}

async function renderSitemap(env) {
  const result = await env.DB.prepare(`
    SELECT type, slug, updated_at
    FROM content_entries
    WHERE status = 'published'
    ORDER BY updated_at DESC
  `).all();
  const staticUrls = STATIC_SITEMAP_PATHS.map((path) => ({ loc: siteUrl(env, path), lastmod: '' }));
  staticUrls.push({ loc: siteUrl(env, '/blog/'), lastmod: '' });
  const contentUrls = (result.results || []).map((entry) => ({
    loc: siteUrl(env, `/${entry.type === 'blog' ? 'blog' : 'san-francisco'}/${entry.slug}`),
    lastmod: String(entry.updated_at || '').slice(0, 10)
  }));
  const urls = [...staticUrls, ...contentUrls].map((entry) => `  <url><loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

function renderRobots(env) {
  return `User-agent: *\nAllow: /\nDisallow: /check-res.html\nDisallow: /api/\n\nSitemap: ${siteUrl(env, '/sitemap.xml')}\n`;
}

function renderErrorPage(env, status, message) {
  return pageShell(env, {
    title: `${status} | Turquaz`,
    description: message,
    canonicalPath: '/',
    body: `<main class="article-shell"><article class="article-head"><p class="eyebrow">${status}</p><h1>${escapeHtml(message)}</h1><p><a class="button" href="/">Return home</a></p></article></main>`
  });
}

function matchContentRoute(path) {
  const blog = path.match(/^\/blog\/([a-z0-9-]+)$/);
  if (blog) return { type: 'blog', slug: blog[1] };
  const local = path.match(/^\/san-francisco\/([a-z0-9-]+)$/);
  if (local) return { type: 'local_page', slug: local[1] };
  return null;
}

function normalizePath(path) {
  const normalized = path.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return normalized || '/';
}

function mapEntry(row) {
  return {
    ...row,
    blocks: parseBlocks(row.body_json),
    body_json: undefined
  };
}

function parseBlocks(value) {
  try {
    const blocks = JSON.parse(value || '[]');
    return Array.isArray(blocks) ? blocks : [];
  } catch {
    return [];
  }
}

async function saveRevision(env, row, actor) {
  await env.DB.prepare(`
    INSERT INTO content_revisions (entry_id, snapshot_json, created_at, created_by)
    VALUES (?, ?, ?, ?)
  `).bind(row.id, JSON.stringify(mapEntry(row)), new Date().toISOString(), actor || 'admin').run();
}

async function ensureSlugAvailable(env, type, slug, excludedId = '') {
  const existing = await env.DB.prepare(`
    SELECT id FROM content_entries
    WHERE type = ? AND slug = ? AND id != ?
    LIMIT 1
  `).bind(type, slug, excludedId).first();
  if (existing) {
    throw new HttpError(409, 'That slug is already used by another page');
  }
}

async function logEvent(env, entryId, action, actor, detail = '') {
  await env.DB.prepare(`
    INSERT INTO publish_events (entry_id, action, actor, detail, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(entryId, action, actor || 'admin', detail, new Date().toISOString()).run();
}

async function readJson(request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    if (request.headers.get('Content-Length') === '0') return {};
  }
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function boundedText(value, max, label) {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw new HttpError(400, `${label} is required and must be ${max} characters or fewer`);
  return text;
}

function optionalHttpsUrl(value) {
  const text = String(value || '').trim();
  return text ? requiredHttpsUrl(text, 'URL') : '';
}

function requiredHttpsUrl(value, label) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    return url.toString();
  } catch {
    throw new HttpError(400, `${label} must be a valid HTTPS URL`);
  }
}

function cleanRichHtml(value) {
  return sanitizeHtml(String(value || ''), {
    allowedTags: [
      'h2', 'h3', 'p', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
      'blockquote', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      th: ['scope'],
      td: ['colspan', 'rowspan']
    },
    allowedSchemes: ['https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attributes) => ({
        tagName,
        attribs: {
          ...attributes,
          ...(attributes.target === '_blank' ? { rel: 'noopener noreferrer' } : {})
        }
      })
    }
  }).trim();
}

function safeVideoUrl(value, position) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) throw new Error('Invalid YouTube ID');
      return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)) {
      const id = url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : url.searchParams.get('v');
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(id || '')) throw new Error('Invalid YouTube ID');
      return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(url.hostname)) {
      const id = url.pathname.split('/').filter(Boolean).pop();
      if (!/^\d{5,12}$/.test(id || '')) throw new Error('Invalid Vimeo ID');
      return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    throw new HttpError(400, `Video at position ${position} must be a valid YouTube or Vimeo URL`);
  }
  throw new HttpError(400, `Video at position ${position} must be a YouTube or Vimeo URL`);
}

function auditContentEntry(row) {
  const blocks = parseBlocks(row.body_json);
  const blockText = blocks.map((block) => {
    if (block.type === 'html') return sanitizeHtml(block.html || '', { allowedTags: [], allowedAttributes: {} });
    if (block.type === 'list') return (block.items || []).join(' ');
    return block.text || block.caption || '';
  }).join(' ');
  const text = `${row.excerpt || ''} ${blockText}`.replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  const query = String(row.primary_query || '').trim().toLowerCase();
  const headings = blocks.reduce((total, block) => {
    if (block.type === 'heading') return total + 1;
    if (block.type === 'html') return total + ((block.html || '').match(/<h[23]\b/gi) || []).length;
    return total;
  }, 0);
  const images = blocks.flatMap((block) => block.type === 'gallery' ? block.images || [] : block.type === 'image' ? [block] : []);
  const editorialInternalLinks = (blocks.map((block) => block.type === 'html' ? block.html || '' : '').join(' ').match(/href=["']\/(?!\/)/gi) || []).length;
  const internalLinks = editorialInternalLinks + 2;
  const ageDays = Math.floor((Date.now() - new Date(row.updated_at || 0).getTime()) / 86400000);
  const checks = [
    seoCheck('SEO title', row.seo_title?.length >= 30 && row.seo_title?.length <= 60, row.seo_title ? 'Keep the title near 30-60 characters.' : 'Add a unique SEO title.', 15),
    seoCheck('Meta description', row.seo_description?.length >= 120 && row.seo_description?.length <= 160, row.seo_description ? 'Keep the description near 120-160 characters.' : 'Add a persuasive meta description.', 15),
    seoCheck('Primary query', Boolean(query), 'Assign one specific visitor query.', 10),
    seoCheck('Query in title', Boolean(query) && `${row.title} ${row.seo_title}`.toLowerCase().includes(query), 'Use the primary query naturally in the page or SEO title.', 10),
    seoCheck('Useful depth', words >= 450, `${words} words; aim for at least 450 useful, original words when the topic warrants it.`, 15),
    seoCheck('Heading structure', headings >= 2, `${headings} section headings; use descriptive H2/H3 sections.`, 10),
    seoCheck('Internal links', internalLinks >= 2, `${internalLinks} internal links; connect readers to the menu, reservations and related content.`, 10),
    seoCheck('Image accessibility', Boolean(row.social_image_url) && Boolean(row.social_image_alt) && images.every((image) => image.alt), 'Add a social image and descriptive alt text for every image.', 10),
    seoCheck('Freshness', Number.isFinite(ageDays) && ageDays <= 365, `${ageDays} days since update; review facts at least yearly.`, 5, true)
  ];
  return {
    id: row.id,
    type: row.type,
    slug: row.slug,
    title: row.title,
    status: row.status,
    score: checks.reduce((total, check) => total + (check.passed ? check.points : 0), 0),
    words,
    updatedAt: row.updated_at,
    checks
  };
}

function seoCheck(label, passed, guidance, points, warningOnly = false) {
  return { label, passed: Boolean(passed), status: passed ? 'pass' : warningOnly ? 'warning' : 'error', guidance, points };
}

function siteUrl(env, path) {
  const base = String(env.SITE_URL || 'https://www.turquazsf.com').replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeXml(value) {
  return escapeHtml(value);
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function publicHeaders() {
  return {
    'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  };
}

function responseHtml(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });
}

function responseText(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
