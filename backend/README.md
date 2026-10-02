# Gmail Relay

The Cloudflare Worker owns reservations, availability, admin sessions, content,
rate limits, and email templates. This Apps Script has one responsibility:
deliver an authenticated email through the `sf@turquazsf.com` Google account.

It does not access Google Sheets or D1 and does not implement reservation,
admin, or CMS actions.

## Script Properties

- `CONTENT_API_TOKEN`: the same server-only token stored as a Worker secret.
- `SENDER_EMAIL`: authorized Gmail address or alias, currently
  `sf@turquazsf.com`.
- `MAIL_SENDER_NAME`: optional display name; defaults to
  `Turquaz Reservations`.

The web app must execute as `sf@turquazsf.com` and may be reachable by anyone because
the relay rejects requests without the token. Never put the token in source,
browser JavaScript, or chat.

Deploy changes with `scripts/deploy-apps-script.ps1 -ScriptId <script-id>`,
authenticated as the new account. Copy the Script ID from the new project's
Project Settings, not from the old account or the Web app deployment ID.
The script updates the new account's existing Apps Script deployment rather
than creating a new public URL.

## Moving the mailbox to another Google Workspace account

1. Deploy the relay from the new account as a Web app, executing as
   `sf@turquazsf.com`, with access set to Anyone if Workspace policy permits.
2. Set `SENDER_EMAIL` to `sf@turquazsf.com` and copy the existing
   `CONTENT_API_TOKEN` into the new project's Script Properties securely.
   An editor test uses the script's own token and does not verify that it
   matches the Worker secret.
3. Set `EMAIL_WEBHOOK_URL` in `worker/wrangler.toml` to the new deployment's
   `/exec` URL and redeploy the Worker with its existing production routes.
4. If relay source changes after deployment, update the deployment to a new
   version. Saving the editor alone does not update the deployed Web app.
5. Verify a website reservation's `emailCustomerOk` and `emailTeamOk` results
   and check delivery and authentication in the received messages.

Primary-mailbox sending omits Gmail's `from` option; sending from an authorized
alias sets it explicitly. Restaurant notifications still go to
`NOTIFICATION_EMAIL` in the Worker configuration, independently of the sender.