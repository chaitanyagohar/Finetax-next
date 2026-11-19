/** Help guides. Shown in the Help Center and given to the support assistant as its knowledge. */
export type HelpArticle = { id: string; title: string; area: string; adminOnly?: boolean; keywords: string; body: string };

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "getting-around",
    title: "Finding your way around",
    area: "Basics",
    keywords: "menu sidebar navigation search jump ctrl k bell notifications",
    body: `The menu on the left lists only the modules you have access to. On a phone, open it with the menu icon at the top left.

1. Press **Ctrl + K** (or click **Jump to...** at the top) to search for any page and open it.
2. The **bell** at the top shows your notifications. A red number means unread items.
3. When a task timer is running, a bar at the **bottom left** shows the task and time with **Pause**, **Resume** and **Stop** buttons.
4. The **Help** button at the bottom right opens this help centre from any page.`,
  },
  {
    id: "sign-in",
    title: "Signing in and resetting your password",
    area: "Basics",
    keywords: "login sign in password forgot reset locked email link",
    body: `1. On the sign-in page, click **Forgot password**.
2. Enter your work email and send the link.
3. Open the email (check **Spam/Promotions** if it isn't in your inbox) and click the link.
4. Choose a new password and save it.

The reset link must be opened soon after it's sent. If it says the link is invalid, request a new one. If you never receive the email, an administrator can reset your password from **Team management**.`,
  },
  {
    id: "access",
    title: "A page is missing, or I'm sent back to the Dashboard",
    area: "Basics",
    keywords: "access permission module missing page redirect dashboard can't see not allowed",
    body: `Each person only sees the modules an administrator has given them. Opening a page you don't have access to sends you back to the **Dashboard**. This is expected, not an error.

1. Ask an administrator to give you the module in **Team management** (for example Invoices or Documents).
2. After they save it, **sign out and sign in again** so the change applies.

**Review tasks** is only for reviewers and administrators. **Team management, Service packages, Logs and Firm settings** are for administrators only.`,
  },
  {
    id: "task-create",
    title: "Creating a task",
    area: "Tasks",
    adminOnly: true,
    keywords: "add task new task create assign deadline statutory period",
    body: `1. Open [Tasks & compliance](/tasks) and click **Add Task**.
2. In **Task**, choose the work from the Task List (for example GSTR-3B Return).
3. Enter the **Period** (for example "Oct 2026"). If the Task List entry has a statutory rule, the **Statutory Deadline**, **Internal Team Deadline** and **Estimate** fill in automatically.
4. Choose the **Client** (search by name, organisation, PAN, GSTIN or phone).
5. Choose **Assign Execution To** and, if it needs checking, a **Reviewer**. The reviewer must be a different person (maker-checker rule).
6. Set **Recurrence** if it repeats, then click **Create Task**.

The internal deadline can't be later than the statutory deadline.`,
  },
  {
    id: "task-workflow",
    title: "Working on a task: Start, Submit, Review",
    area: "Tasks",
    keywords: "start work submit for review approve request changes stage workflow reviewer feedback",
    body: `Stages: **Assigned → In Progress → Submitted for Review → Approved**, or back to **Changes Required**.

For the person doing the work:
1. Open the task and click **Start Work**. The timer starts automatically.
2. Add notes in **Execution Notes** (ARN, documents pending and so on).
3. When done, click **Submit for Review**. The timer stops and the time is saved.

For the reviewer:
1. Open the task from **Review Queue** (or [Review tasks](/reviewer-queue)).
2. Click **Approve**, or write feedback in **Reviewer Feedback** and click **Request Changes**. Feedback is required when sending back.

Staff can change the stage and their notes. Other task details are managed by the reviewer or an administrator.`,
  },
  {
    id: "task-recurring",
    title: "Recurring tasks and periods",
    area: "Tasks",
    keywords: "recurring daily weekly monthly quarterly next occurrence period repeat working day",
    body: `When a recurring task is **approved**, the next occurrence is created automatically, with both deadlines and the period moved forward (for example Oct 2026 → Nov 2026).

A **Daily** task repeats on the firm's next working day. Working days are set under **Performance → Weights → Working days** (Monday to Saturday, or Monday to Friday). A daily task approved late continues from today, so no backlog of past days is created.

If the next one doesn't appear, check that the task's **Recurrence** isn't "None" and that it was **Approved** (not just submitted).`,
  },
  {
    id: "task-list",
    title: "Managing the Task List and categories",
    area: "Tasks",
    adminOnly: true,
    keywords: "task list task types statutory day buffer estimate categories rename merge archive",
    body: `1. In [Tasks & compliance](/tasks), click **Task List**.
2. Add or edit an entry: name, category, recurrence, **Statutory Day** and **Of Which Month** (for example day 20 of the next month), **Internal Buffer** and **Default Estimate**.
3. Use **Archive** to hide entries no longer used, or the merge icon to combine duplicates.

Click **Categories** to add, rename or recolour categories. Renaming updates every task that uses it.`,
  },
  {
    id: "work-queue",
    title: "Your work queue (order of work)",
    area: "Tasks",
    keywords: "queue order priority drag next what to do first",
    body: `In [Tasks & compliance](/tasks), click **Queue** to see your open tasks in the order to do them.

- By default the order is automatic: nearest statutory deadline first, then priority.
- Administrators can drag tasks into a custom order and click **Save order**. You get a notification when your order changes.
- New tasks appear at the top with a **New** badge until they're placed.
- Use **Start** on a task to begin it.`,
  },
  {
    id: "task-transfer",
    title: "Handing a task to someone else",
    area: "Tasks",
    keywords: "transfer reassign handover leave request transfer",
    body: `If you're assigned the task:
1. Open the task and click **Request transfer**.
2. Give a **reason**, write **handover notes** (what's done, what's pending), and optionally suggest who should take it.
3. Click **Send request**. You'll be notified when it's approved or declined.

Administrators, the task's reviewer, or whoever assigned it can approve the request in the task's **Transfers** section, or move it straight away with **Transfer**.

Approved tasks can't be transferred, and the reviewer can't be made the person doing the work.`,
  },
  {
    id: "reminders",
    title: "Reminders, escalations and 'Remind me later'",
    area: "Notifications",
    keywords: "reminder overdue not started escalation remind me later snooze popup",
    body: `The system checks every 15 minutes during working hours and reminds people when a task hasn't been started, when an internal deadline is close or has passed, and when a statutory deadline is at risk.

On any reminder popup, click **Remind me later** and choose **In 1 hour**, **In 3 hours** or **Tomorrow 10 AM**. The popup comes back then.

Administrators change the rules and working hours in [Tasks & compliance](/tasks) → **Reminders**.`,
  },
  {
    id: "timer",
    title: "How the automatic timer works",
    area: "Time",
    keywords: "timer start stop pause idle away welcome back running clock",
    body: `- The timer **starts** when you click **Start Work** on a task assigned to you, or **Start now** on a popup.
- It **stops and saves** when you submit the task for review, or when the task is approved, sent back or transferred.
- Only **one** timer runs at a time. Starting another task saves the first.
- Use the bar at the bottom left to **Pause** (breaks aren't counted), **Resume** or **Stop**.
- After **10 minutes** without mouse or keyboard activity the timer pauses. When you return, choose **keep** the time, **discard** it, or **stop** the timer from when you left.
- If the timer didn't start, check the task is **assigned to you** and that you clicked Start yourself (an admin changing the stage doesn't start your timer).`,
  },
  {
    id: "time-correct",
    title: "Logging or correcting time",
    area: "Time",
    keywords: "manual entry time log correct edit review my day confirm locked 7 days",
    body: `1. Open [Time tracking](/time-tracking).
2. Click **Manual Entry** to add time you worked without the timer.
3. Click **Review my day** to check today's entries: correct minutes or descriptions, delete mistakes, add missed work, then **Confirm my day**. After 6:30 PM this opens by itself once.

Rules:
- Entries older than **7 days are locked**. Ask an administrator to change them.
- A day can't exceed **24 hours** in total.
- Labels: **Auto** or **Timer** (recorded automatically), **Edited** (hours changed later), **Check** (needs your review).`,
  },
  {
    id: "performance",
    title: "Understanding your performance score",
    area: "Performance",
    keywords: "score kpi performance timeliness quality volume activeness review rating",
    body: `Open [Performance](/performance) and pick a period. Your score out of 100 combines:
- **Timeliness:** tasks submitted by the internal deadline, minus points for statutory breaches.
- **Quality:** tasks approved without being sent back.
- **Volume:** completed work weighted by estimated hours.
- **Activeness:** days active in the app versus working days.

Areas with no data are left out rather than counted as zero. Only you and administrators can see your scorecard and reviews.`,
  },
  {
    id: "clients",
    title: "Adding clients and avoiding duplicates",
    area: "Clients",
    keywords: "client add new duplicate merge pan gstin phone organisation search",
    body: `1. Open [Clients](/clients) and add the client with name, organisation, PAN, GSTIN, phone and email.
2. When you save, the system checks for possible duplicates (same PAN, GSTIN, phone or a very similar name) and warns you.
3. Administrators can find and merge duplicates from the duplicates screen on the Clients page. Merging moves tasks, invoices and documents to the client you keep.

Everywhere in the app, clients show as **Organisation — Contact name**, and the client picker searches by name, organisation, PAN, GSTIN or phone.`,
  },
  {
    id: "leads-quotations",
    title: "Leads and quotations",
    area: "Sales",
    keywords: "lead enquiry convert quotation quote pdf email convert to invoice",
    body: `- Record enquiries in [Enquiries & leads](/leads) and convert a lead to a client when it's won.
- In [Quotations](/quotations), create a quotation, then open its **PDF** (it opens in a new tab, where you can print or download it) or **email** it to the client.
- A quotation can be converted into an invoice.

If the PDF doesn't open, allow pop-ups for this site in your browser.`,
  },
  {
    id: "invoices",
    title: "Invoices, payments and invoice numbers",
    area: "Finance",
    keywords: "invoice issue draft number payment partial cancel delete email pdf upi",
    body: `- An invoice starts as a **draft**. Its number is given when it's **issued**, so the series has no gaps.
- Open the invoice's PDF to view or print it. Emailing it sends the PDF with the amount, due date and payment details (UPI and bank).
- Record each payment against the invoice. Part-payments are fine: the status changes to **Partially Paid** and then **Paid** automatically.
- A wrong issued invoice must be **cancelled**, not deleted, so the GST series stays continuous. Issued invoices can't be edited.`,
  },
  {
    id: "packages",
    title: "Service packages, proposals and engagement letters",
    area: "Packages",
    adminOnly: true,
    keywords: "package retainer proposal engagement letter accept onboard contract scope exclusions",
    body: `1. In [Service packages](/packages), click **Create Package**. Add services (link each to a **Task List** entry for proper deadlines), the fee, engagement text and billing defaults.
2. Click **Engagement Terms** once to set the signatory, FRN, jurisdiction and standard clauses.
3. On a package, click **Send Proposal**, choose the client, adjust terms if needed, and click **Save & email**. The client gets the letter as a PDF with an **accept online** link.
4. When the client accepts online, or you click **Accepted** to record a signed copy, the client is onboarded automatically: subscription, tasks and monthly billing. A start date in the past moves to the acceptance date.

If tasks are created without a person, you get an **Unassigned tasks** alert.`,
  },
  {
    id: "billing",
    title: "Automatic monthly billing",
    area: "Packages",
    adminOnly: true,
    keywords: "billing subscription monthly bill late fee approve send auto reminder pro-rated",
    body: `- Every morning, bills are created for subscriptions whose bill date has arrived (for example period 01/09–30/09, bill dated 05/10, due 10/10).
- By default a bill is a **draft**: open [Service packages](/packages) → **Billing** and click **Approve & send**. Turn on **Auto** for a client to send automatically.
- Clients get reminders 2 days before, on, and 3 days after the due date. Late fees are added to the next bill.
- Subscriptions that existed before billing was added start with billing **Off**. Switch them on in the Billing tab.
- **Run billing now** runs the check immediately.`,
  },
  {
    id: "inbox",
    title: "Unified inbox and email",
    area: "Inbox",
    keywords: "inbox email sync not showing missing delay gmail imap app password",
    body: `- New emails are fetched automatically about every **5 minutes**. Click **Sync** to fetch immediately, then refresh the page.
- Emails are linked to clients by the sender's address. You can link an email to a client yourself and log it as a discussion.

If emails stop arriving, the mailbox password may have changed. For Gmail you need an **App Password**, not your normal password. An administrator can check the account with **Test connection**.`,
  },
  {
    id: "documents",
    title: "Documents",
    area: "Documents",
    keywords: "document upload file share link private email attachment",
    body: `- Upload files in [Documents](/documents) and link them to a client or task.
- Files are private. Opening one creates a temporary secure link.
- You can share a time-limited link or email a document as an attachment.`,
  },
  {
    id: "calendar",
    title: "Compliance calendar",
    area: "Calendar",
    keywords: "calendar statutory deadline event create client tasks",
    body: `- [Compliance calendar](/calendar) shows statutory due dates in month or list view.
- Administrators can add deadlines and use **Create client tasks** on an event to create that task for many clients at once.`,
  },
  {
    id: "notifications",
    title: "Notifications, popups and announcements",
    area: "Notifications",
    keywords: "notification bell popup important announcement acknowledge",
    body: `- The **bell** lists everything. Click an item to open the related task or page.
- **Important** items also appear as popups on the Dashboard, with actions like **Start now** or **Remind me later**.
- Announcements from administrators may ask you to confirm you've read them.`,
  },
  {
    id: "discussions",
    title: "Client discussions and follow-ups",
    area: "Clients",
    keywords: "discussion call meeting follow up note client",
    body: `Record calls and meetings in [Client discussions](/client-discussions) with a follow-up date. Mark follow-ups complete when done.`,
  },
  {
    id: "team-settings",
    title: "Team, firm settings and security",
    area: "Administration",
    adminOnly: true,
    keywords: "team add user modules reviewer password settings bank gstin logs support agent",
    body: `- **Team management:** add people, set their role and modules, mark reviewers, reset passwords. Security actions ask for your own password.
- **Firm settings:** firm details, GSTIN/PAN, invoice numbering and bank/UPI details. Changing bank details needs your password, and other administrators are alerted.
- **Logs:** a full history of actions, with filters and CSV export.`,
  },
  {
    id: "troubleshooting",
    title: "Quick fixes for common problems",
    area: "Basics",
    keywords: "not working error blank page refresh slow stuck didn't save",
    body: `1. **Page looks wrong or a change isn't showing:** refresh the page (F5).
2. **Something worked yesterday but not today:** sign out and sign in again.
3. **"Not allowed" or sent back to the Dashboard:** you may not have that module. See "A page is missing".
4. **A PDF or link doesn't open:** allow pop-ups for this site.
5. **A client didn't receive an email:** ask them to check Spam, and confirm the email address on the client record.
6. **An error message appears:** note the exact message (or take a screenshot) and share it here. That makes it much faster to fix.`,
  },
  {
    id: "attendance",
    title: "Attendance, time away and leave",
    area: "Time",
    keywords: "attendance away question idle quiet break tally portal call leave holiday late office remote approval",
    body: `Your day is worked out from your activity in Duesk. Nothing on your screen is recorded.

1. If there is no activity for **15 minutes** (your firm can change this), the next time you move the mouse Duesk asks **what were you doing**: Tally or Excel, a government portal, a call, other office work, or a break. A running timer pauses meanwhile.
2. Pick the answer. Work counts as **away for work**; a break counts as a break. Closing the question marks the time as **not answered**.
3. Away-for-work time above **2 hours in a day** goes to someone who can approve time. Until then it shows as waiting.
4. Use **Start my day** and **End my day** on the Attendance page if you want exact times. Otherwise the first and last activity are used.
5. **Apply for leave** from the Attendance page. You can cancel it until it starts.

Days are marked **In office** when you open Duesk from your branch's office internet address; otherwise **Remote**. This is only recorded, it never stops you working.`,
  },
  {
    id: "attendance-admin",
    title: "Attendance reports, approvals and workload",
    area: "Time",
    adminOnly: true,
    keywords: "attendance report team absent late capacity workload approve time leave holidays rules export csv",
    body: `Open **Attendance**.

1. **Team report**: present, leave, absent, late, office and remote days, active hours and away-for-work hours for any period up to three months. A high share of away time is worth a look next to the work finished. Download it with **CSV**.
2. **Workload**: open work for the next 7, 14 or 30 days against each person's hours, after holidays and approved leave. The same line appears under **Assign execution to** when you create a task.
3. **Approvals**: away time above the daily limit, and leave requests.
4. **Holidays and rules**: holidays (for every branch or one), the quiet time before the question, the daily limit before approval, and the grace before someone counts as late.

Roles with **See attendance and capacity** or **Approve time and leave** can do the same for the people they can see.`,
  },
  {
    id: "branches-roles",
    title: "Branches and firm roles",
    area: "Administration",
    adminOnly: true,
    keywords: "branch office gstin numbering prefix role scope own branch firm permission article manager",
    body: `Open **Branches and roles**.

**Branches**: every firm has a head office. Add a branch with its address, working hours and office internet address. For billing, either leave GSTIN and numbering empty (the branch bills under the firm) or give it its own **GSTIN** and **own invoice numbering** with a prefix such as PV/{FY}/. A client's invoices follow the client's branch.

**Roles**: make roles such as Article, Senior or Branch manager. Each role decides:
1. **Sees**: own work only, their branch, or the whole firm.
2. **Sections** in the menu.
3. **Can**: review work, approve time and leave, see attendance, see fees and profitability, export data.

Give people their branch and role on **Team management**. Changing a role updates everyone who has it.`,
  },
  {
    id: "must-read",
    title: "Must-read announcements and escalations",
    area: "Administration",
    adminOnly: true,
    keywords: "announcement must read acknowledge pinned reminder export escalation level partner list overdue statutory",
    body: `**Announcements**: tick **Must read** to pin it above every page until each person confirms. Choose how often to remind those who haven't read it, and whether it is for one branch. Open **x of y acknowledged** to see who has read it, remind the rest, or export the list.

**Escalations** (Tasks, **Reminders & escalations**):
1. Level 1 is the person doing the work.
2. Level 2: when overdue by the days you choose, the reviewer and the person who assigned it are told.
3. Level 3: when overdue longer, or the statutory date is close, the task goes on the **partners' list**, sent once a day at the time you choose and shown on the Dashboard as **Needs a partner**.`,
  },
];

export function knowledgeBaseText(): string {
  return HELP_ARTICLES.map((a) => `## ${a.title}${a.adminOnly ? " (administrators only)" : ""}\n${a.body}`).join("\n\n");
}