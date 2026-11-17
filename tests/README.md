# Duesk tests

Two kinds of automated checks:

- **SQL isolation checks** (`tests/sql`) load the live database structure into a scratch local database, add two test firms, and prove that one firm can't read or change the other's data.
- **Browser checks** (`tests/e2e`) open the app in Chrome and click through it with [Playwright](https://playwright.dev).

Neither touches live data. The SQL checks run on a copy of the *structure* only, on your own computer. The browser checks are read-only.

## SQL isolation checks

### What they check

| Check | What it proves |
|---|---|
| S1–S3 | Every table with an `org_id` has row-level security on and a RESTRICTIVE `org_isolation` policy. The two per-person tables (`memberships`, `user_active_org`) and tables nobody can read from the app are the exceptions. The seed really put firm B rows into the tables. |
| R1–R4 | Firm A's admin, firm A's staff and a signed-out visitor see **no** firm B row in **any** firm table. The list of tables is read from the database, so new tables are covered automatically. |
| W1–W4 | Firm A can't edit or delete firm B rows, plant a client in firm B, link its task to a firm B client, or assign work to firm B staff. |
| T1–T3 | The dashboard totals and client balances count only your own firm. Firm B's people are invisible to firm A. |
| F1–F2 | Billing, reminder and scheduling jobs and trigger functions can't be called by signed-in users or visitors. |

### What you need

- A local PostgreSQL 15 or newer, running. PostgreSQL 17 matches Supabase.
- `psql` and `pg_dump`. On your PC, `pg_dump` is in `C:\Program Files\PostgreSQL\18\pgAdmin 4\runtime\`; `psql` is in the same folder. If you install the PostgreSQL server, both are also in `C:\Program Files\PostgreSQL\<version>\bin\`.

### Run it (Windows PowerShell)

1. Dump the live **structure** only (no data). Don't paste the connection string into a chat:

   ```powershell
   $pg = "C:\Program Files\PostgreSQL\18\pgAdmin 4\runtime"
   & "$pg\pg_dump.exe" "PASTE-YOUR-CONNECTION-STRING-HERE" --schema-only --schema=public --no-owner --file "$HOME\Downloads\duesk-schema.sql"
   ```

2. Run the checks against your local PostgreSQL. It creates or replaces a database called `duesk_test`:

   ```powershell
   .\tests\sql\run.ps1 -Dump "$HOME\Downloads\duesk-schema.sql" -Psql "$pg\psql.exe"
   ```

   It asks for your local `postgres` password. Every line should start with `ok`, and the last line should say `all isolation checks passed`. A failure stops the run and names the check.

On Mac or Linux: `tests/sql/run.sh ~/duesk-schema.sql duesk_test -U postgres`.

Run it after every migration, using a fresh dump.

### Files

- `00_supabase_stubs.sql`: stand-ins for the Supabase parts a plain PostgreSQL doesn't have. `auth.uid()` returns whoever the test says is signed in.
- `01_two_firms.sql`: two firms, each with an admin, a staff member and the same kinds of rows.
- `10_isolation.sql`: the checks.

## Browser checks (Playwright)

### What they check

- `e2e/public.spec.ts`: needs no account.
  - The login page works under the strict security policy: every script carries this request's nonce and nothing is blocked.
  - Each request gets a new nonce.
  - Security headers are set.
  - Signed-out visitors are sent to the login page.
  - The API refuses signed-out requests.
  - The email webhook ignores a secret passed in the URL.
- `e2e/signed-in.spec.ts`: needs a login for a **test** firm's administrator, such as Sharma and Associates.
  - Every main page opens with no errors and no blocked scripts.
  - The dashboard shows the database totals.
  - Tasks offers older completed tasks.
  - Manual time entry opens.
  - The Inbox attachment search box is there.
  - Dialogs close with Escape and return focus.

  These checks only read; they create, change and delete nothing.

### Run it (Windows PowerShell)

Once, to download the browser Playwright uses:

```powershell
npx playwright install chromium
```

Then start the app in one PowerShell window:

```powershell
npm run dev
```

and run the checks in a second one:

```powershell
npm run test:e2e
```

Add the signed-in checks by setting a test admin's login first, in the same window:

```powershell
$env:E2E_EMAIL = "admin-of-the-test-firm@example.com"
$env:E2E_PASSWORD = "their password"
npm run test:e2e
```

To check a deployed site instead of your computer, set `$env:E2E_BASE_URL = "https://your-preview-url.vercel.app"`. Only use a **test** firm's login: one Supabase project serves both preview and production.

If `npx playwright install` can't download, point the tests at your own Chrome: `$env:E2E_CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"`.

Results: `list` output in the window, plus an HTML report in `playwright-report\`. Run `npx playwright show-report playwright-report` to open it.

### Status

The public checks pass against a production build. The signed-in checks were written against the code but haven't been run against a real account yet. On their first run, a label that reads differently on screen may need adjusting in the test.
