# Turquaz Worker

Cloudflare Worker + D1 service for reservations, admin sessions, editorial
content, server-rendered pages, and email templates.

## Setup

1. Run `npm install` in this directory.
2. Authenticate with `npx wrangler login`.
3. Apply migrations with `npm run db:migrate:remote`.
4. Store `CONTENT_API_TOKEN` and `ADMIN_PASSWORD` with `wrangler secret put`.
5. Store the same `CONTENT_API_TOKEN` in the Gmail relay's Script Properties.
6. Run `npm run check`, then deploy with `npm run deploy`.

Secrets must never be added to `wrangler.toml`, browser JavaScript, D1 content,
or source control.

## Email

The Worker renders all email subjects and HTML, then sends a narrowly scoped,
authenticated request to the Apps Script Gmail relay. The relay only validates
and delivers the message with `GmailApp.sendEmail`.

The system sends:

- guest and restaurant notifications when a reservation is created;
- guest and restaurant notifications when a reservation is canceled or deleted;
- website contact messages to the restaurant, with Reply-To set to the guest.

Email failure never removes a successfully stored reservation or reverses a
cancellation. API responses expose `emailSent` so failures can be observed
without corrupting reservation state.

## Public Routes

- `GET /blog/`
- `GET /blog/:slug`
- `GET /san-francisco/:slug`
- `GET /sitemap.xml`
- `GET /robots.txt`
- `GET /api/reservations/availability?date=YYYY-MM-DD`
- `POST /api/reservations`
- `POST /api/reservations/cancel`
- `POST /api/contact`

## Admin Routes

Browser admin routes accept the D1-backed session token returned by
`POST /api/admin/login`. `CONTENT_API_TOKEN` also authorizes private maintenance
and one-time imports.

- `POST /api/admin/login`
- `GET /api/admin/session`
- `POST /api/admin/logout`
- `GET /api/admin/content`
- `GET /api/admin/content/:id`
- `POST /api/admin/content`
- `PUT /api/admin/content/:id`
- `POST /api/admin/content/:id/publish`
- `POST /api/admin/content/:id/archive`
- `GET /api/admin/reservations/availability?date=YYYY-MM-DD`
- `GET /api/admin/reservations?date=YYYY-MM-DD`
- `POST /api/admin/reservations`
- `POST /api/admin/reservations/delete`
- `POST /api/admin/reservations/import`
- `GET /api/admin/reservations/token/:token`
- `POST /api/admin/reservations/token/:token/cancel`

New reservations enforce the 15-guest slot capacity atomically in D1. Imports
use deterministic source keys and can be retried without duplicating rows.