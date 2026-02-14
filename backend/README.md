# Google Sheets Reservation Backend (Google Workspace Friendly)

Yes — Google Workspace + Google Sheets is a good simple database for this website.

## What this backend gives you

- Stores reservations in Google Sheets
- Returns daily timeslot occupancy
- Enforces `SLOT_CAPACITY = 10`
- Supports meal segmentation (`breakfast`, `lunch`, `dinner`)
- Supports admin login + reservation listing by day
- Works with your current website frontend

## Setup Steps

1. Create a new Google Sheet (name it `Turquaz Reservations`).
2. Open `Extensions > Apps Script`.
3. Copy/paste code from `backend/google-apps-script.gs` into `Code.gs`.
4. Save.
5. Deploy as Web App:
   - `Deploy > New deployment`
   - Type: `Web app`
   - Execute as: `Me`
   - Who has access: `Anyone`
6. Copy the Web App URL.
7. In `scripts/main.js`, set:

   `const APPS_SCRIPT_URL = 'YOUR_WEB_APP_URL_HERE';`

8. Refresh the website.

## Admin Login Setup (recommended)

In Apps Script, set Script Properties:

- `ADMIN_USER` (example: `admin`)
- `ADMIN_PASS` (choose a strong password)

If not set, defaults are:

- user: `admin`
- pass: `turquaz2026`

## Data Columns

- CreatedAt
- Name
- Phone
- Date (YYYY-MM-DD)
- Time (HH:mm)
- Guests
- Note
- Meal

## API Behavior

- `GET ?action=availability&date=YYYY-MM-DD`
  - returns per-slot occupied guest counts
- `POST` with `{ action: 'reserve', payload }`
  - validates input
  - rejects over-capacity slot
  - saves reservation row
- `POST` with `{ action: 'adminLogin', username, password }`
   - validates admin credentials
- `POST` with `{ action: 'adminList', username, password, date }`
   - returns reservation rows for selected date
