# Duesk security review before launch (19/11/2026)

This covers the code, the database and the services Duesk runs on. Batch 12 fixes everything that can be fixed in code. What is left needs a setting changed in Supabase or Vercel, a decision from you, or a legal document.

## 1. Fixed in batch 12

| # | Gap | What was wrong | Fix |
|---|---|---|---|
| 1 | Password is the only lock | Anyone with a staff password could open all of that firm's data. | **Two-step sign-in** (a code from a phone app). It is checked in the database, not just the screens: a session without the code sees no firm data, even through the API directly. Firms can require it for administrators. Admins can reset it for a member who lost their phone. |
| 2 | Signed-out visitors had rights on every table | The default Supabase grants gave the public key rights on 51 tables and many functions. Row-level security hid the rows, so nothing leaked, but one wrong policy would have exposed data. | All table and function rights removed from signed-out visitors, now and for future tables. |
| 3 | S-09: activity log written by the browser | Most log entries came from the browser after the action, so they could be skipped. | The database now logs these itself: invoices (issue, cancel, edit), payments, team and role changes, client deletion, firm settings, payment keys, mailboxes, branches and support access. Secret values are never written to the log. |
| 4 | Full data export needed only a session | A stolen session could download the whole firm. | Export now asks for the admin's password again. |
| 5 | Email failures were invisible | Failed emails only went to the server log, so nobody knew. | An **email log**: firm admins see each email and why it failed, with "Send me a test email". The owner console shows email health per firm (counts and errors only, never content). |
| 6 | Support view crashed | Wrong column name (`059`). | Fixed. |
| 7 | Attendance rules didn't save | The browser wrote to a table only the server may change; the screen said "saved" anyway. | They now save through the server. |
| 8 | `/organisation` page not guarded by role | Only the page itself checked admin rights. | Added to the admin-only paths. |
| 9 | `default_branch()` | Any signed-in user could look up another firm's head-office ID. | Closed to the browser. |

## 2. Checked and safe

- **Row-level security** is on for every table. The isolation suite (now 37 checks) proves one firm can't read, change, approve, link to or report on another firm's records.
- **Database functions.** All 192 functions that run with raised rights fix their search path, so they can't be tricked into running someone else's code. A static checker found no broken database code.
- **Webhooks:**
  - Razorpay calls are checked against their signature.
  - Incoming email needs a 32+ character secret.
  - Scheduled jobs need `CRON_SECRET`.
- **Security headers.** A content security policy with a fresh nonce, no framing, HSTS, nosniff and a strict referrer policy.
- **Dependencies.** `npm audit` finds 0 known vulnerabilities.
- **Secrets.** `.env*` is ignored by git, and none are in the history. Mailbox passwords and Razorpay keys are kept in Supabase Vault.
- **Email:**
  - Incoming email is shown as text, never as live HTML.
  - Mail servers on private networks are refused.
  - Uploads are checked by their real file type.
- **Client portal.** Separate sign-in by email link. Sessions are server-only.
- **Admin actions on people** (password, email, delete, 2-step reset) need the admin's own password.

## 3. Your settings before launch (free, about 30 minutes)

**This is also why your emails didn't arrive.** Duesk sends two kinds of email:
- **Firm emails** (invoices, reminders, team invitations, portal links) go from each firm's connected mailbox. Batch 12 shows when these fail.
- **Sign-in emails** (invitations to create a login, password resets, confirm email) are sent by **Supabase itself**. Supabase's built-in sender only delivers to your own Supabase team members, a few per hour. Firms' staff therefore never receive them until you set your own SMTP.

| # | Where | Setting | Why |
|---|---|---|---|
| A | Supabase → Authentication → Emails → SMTP settings | Turn on **custom SMTP**: host, port, user and password of a mailbox you control (for example a Zoho or Google Workspace address, with an app password). Sender name "Duesk". | Without this, new users, new firm sign-ups and password resets don't get their emails. |
| B | Duesk owner console → Email | Connect a mailbox in the Oddlambda workspace's Inbox, then click **Use my workspace mailbox** and **Send me a test email**. | Support requests and support-access notices are sent from it. |
| C | Supabase → Authentication → Multi-factor | Make sure **TOTP (authenticator app)** is enabled. | Needed for two-step sign-in. |
| D | Supabase → Authentication → Sign in / providers | Turn **off** "Allow new users to sign up", then test one firm sign-up on the Duesk page. | Duesk creates every login on the server (after the robot check). With this on, someone could create logins straight from the Supabase API, skipping the check. |
| E | Supabase → Authentication → URL configuration | **Site URL** = your live address. **Redirect URLs** = only your own domains. | Stops sign-in links being sent elsewhere. |
| F | Supabase → Authentication → Policies | Minimum password length **10**. Require letters and digits. | Duesk's own screens ask for 8 or more. |
| G | Your own Duesk login (owner) | Turn on **two-step sign-in first**, before launch. | The owner account can change every firm's plan. |
| H | finetax | Ask their admins to turn on two-step sign-in, then tick **Require for administrators** on Sign-in security. | |
| I | Vercel → Environment variables | `CRON_SECRET` and `INBOUND_EMAIL_WEBHOOK_SECRET`: 32+ random characters. `SUPABASE_SERVICE_ROLE_KEY` must never have the `NEXT_PUBLIC_` prefix. | |
| J | Supabase → Project settings | Note the region. Mumbai (ap-south-1) keeps Indian firms' data in India. | Data residency, and speed. |
| K | Anywhere keys were ever pasted or shared | Rotate them: Supabase service role key, Razorpay keys, mailbox app passwords. | |

## 4. Decisions for you (these cost money, so I haven't assumed them)

1. **Backups.**
   - On Supabase's free plan there are no backups you can restore. If a table is deleted by mistake, it's gone.
   - Supabase Pro (about $25 a month) gives daily backups for 7 days.
   - Until then, each firm can use **Settings → Export everything**.
   - I'd treat this as required before taking paying firms.
2. **Hosting plan.** Vercel's free Hobby plan is for non-commercial use only. A paid product should be on Vercel Pro (about $20 a month), which also gives longer logs and more cron jobs.
3. **Leaked-password check** (refuses passwords known from breaches) and **session time limits** are Supabase Pro features.
4. **An outside penetration test** once you have a few paying firms.

## 5. Legal (DPDP Act 2023 and Rules 2025)

Firms put their clients' personal and financial data into Duesk. Under the Act, each firm is the **data fiduciary** and Duesk is their **data processor**. Before launch you need:
- A **privacy policy** and **terms of service** on the site, with a grievance contact.
- A short **data processing agreement** with each firm: what you store, where, who can see it (support only with their grant), how long, and deletion on exit.
- A **breach plan**: who checks, and how firms are told quickly so they can meet their own reporting duty.

I'm not a lawyer. Have these documents checked by one.

## 6. Still open (lower risk)

- **Sign-in attempts.** Supabase limits sign-in attempts per address, and the sign-in screen pauses after 5 failures. A robot check (CAPTCHA) on sign-in isn't added: turning on Supabase's CAPTCHA would break the "confirm your password" step that admin actions use. Two-step sign-in covers this risk better.
- **Browser log entries.** Other activity (task edits, notes) is still logged by the browser alongside the database entries. That's fine for history, but not proof.
