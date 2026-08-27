# Gmail Relay

The Cloudflare Worker owns reservations, availability, admin sessions, content,
rate limits, and email templates. This Apps Script has one responsibility:
deliver an authenticated email through the existing Google account.

It does not access Google Sheets or D1 and does not implement reservation,
admin, or CMS actions.

## Script Properties

- `CONTENT_API_TOKEN`: the same server-only token stored as a Worker secret.
- `SENDER_EMAIL`: authorized Gmail address or alias, currently
  `sf@turquazsf.com`.
- `MAIL_SENDER_NAME`: optional display name; defaults to
  `Turquaz Reservations`.

The web app must execute as the owner and may be reachable by anyone because
the relay rejects requests without the token. Never put the token in source,
browser JavaScript, or chat.

Deploy changes with `scripts/deploy-apps-script.ps1`. The script updates the
existing Apps Script deployment rather than creating a new public URL.