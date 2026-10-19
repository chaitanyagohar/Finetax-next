/** Known problems: how people describe them, and the fix. Used by the support assistant. */
export type ProblemAsk = { question: string; options: { label: string; next: string }[] };
export type Problem = {
  id: string;
  title: string;
  area: string;
  /** The fix needs an administrator; staff see staffNote instead. */
  adminOnly?: boolean;
  staffNote?: string;
  /** Probably a fault: recommend talking to a person if the fix doesn't help. */
  escalate?: boolean;
  /** Only reachable from a follow-up question, never matched directly. */
  hidden?: boolean;
  pages?: string[];
  phrases: string[];
  keywords: string[];
  ask?: ProblemAsk;
  solution: string;
};

const ASK_ADMIN = "This needs an administrator. Ask an administrator in your firm, or click **Talk to a person**.";

export const PROBLEMS: Problem[] = [
  /* ---------------- Access & sign-in ---------------- */
  {
    id: "page-missing",
    title: "A page is missing, or I'm sent back to the Dashboard",
    area: "Access",
    phrases: ["page is missing", "cant see invoices", "menu option not showing", "sent back to dashboard", "redirects to dashboard", "not able to open page", "page nahi dikh raha", "option nahi aa raha", "access denied", "not allowed to open"],
    keywords: ["missing", "access", "permission", "module", "menu", "redirect", "dashboard", "hidden", "sidebar"],
    solution: `Each person only sees the modules an administrator has given them. Opening any other page sends you back to the Dashboard. That's expected, not an error.

1. Ask an administrator to open **Team Management** and give you the module you need (for example **Invoices** or **Documents**).
2. After they save, **sign out and sign in again**.
3. Open the page from the menu.

**Review Tasks** is only for reviewers. **Team Management, Service Packages, Logs and Firm Settings** are only for administrators.`,
  },
  {
    id: "sign-in-failed",
    title: "I can't sign in",
    area: "Access",
    pages: ["/login"],
    phrases: ["cant login", "cannot sign in", "wrong password", "forgot password", "login nahi ho raha", "password bhool gaya", "invalid login credentials"],
    keywords: ["login", "signin", "password", "forgot", "credentials", "invalid"],
    solution: `1. Check you're using your **work email** and that Caps Lock is off.
2. On the sign-in page, click **Forgot password** and enter your email.
3. Open the email (check **Spam**) and click the link, then choose a new password.
4. If no email arrives within a few minutes, ask an administrator to reset your password from **Team Management**.`,
  },
  {
    id: "reset-link",
    title: "The password reset link doesn't work",
    area: "Access",
    phrases: ["reset link invalid", "link expired", "reset link not working", "didnt get reset email", "reset email not received", "link_invalid"],
    keywords: ["reset", "link", "expired", "invalid", "recovery"],
    solution: `1. Reset links work **once** and only for a short time. Request a **new** link from **Forgot password**.
2. Open only the **latest** email. Older links stop working.
3. Open the link in the **same browser** you'll sign in with.
4. Still not working? An administrator can set a new password for you from **Team Management**.`,
  },
  {
    id: "deactivated",
    title: "It says my account is deactivated",
    area: "Access",
    phrases: ["account deactivated", "access disabled", "account blocked", "account band ho gaya"],
    keywords: ["deactivated", "disabled", "blocked", "inactive"],
    solution: `Your access has been switched off by an administrator, for example when someone leaves the firm. Ask an administrator to reactivate you in **Team Management**, then sign in again.`,
  },
  {
    id: "blank-page",
    title: "A page is blank, stuck loading or looks wrong",
    area: "General",
    escalate: true,
    phrases: ["page blank", "white screen", "stuck loading", "not loading", "keeps loading", "page hang", "page khul nahi raha", "screen is empty"],
    keywords: ["blank", "white", "loading", "stuck", "hang", "frozen", "empty", "slow"],
    solution: `1. Refresh the page (**F5**, or pull down on a phone).
2. **Sign out and sign in again.**
3. Try another browser, or a private/incognito window.
4. Check your internet connection.`,
  },
  {
    id: "error-on-save",
    title: "I get an error message when saving",
    area: "General",
    escalate: true,
    phrases: ["error while saving", "error message", "something went wrong", "failed to save", "could not save", "error aa raha hai", "save nahi ho raha", "not saving"],
    keywords: ["error", "failed", "save", "saving", "message", "problem"],
    solution: `Most messages explain a rule, not a fault. Common ones:
- **"The reviewer must be a different person"**: choose another reviewer (maker-checker rule).
- **"The internal deadline must be on or before the statutory deadline"**: move the internal date earlier.
- **"Please write reviewer feedback"**: add feedback before sending a task back.
- **"Entries older than 7 days are locked"**: ask an administrator to change old time.
- **"This would exceed 24 hours"**: a day can't have more than 24 hours logged.

If your message isn't listed, copy it exactly or attach a screenshot.`,
  },

  /* ---------------- Tasks ---------------- */
  {
    id: "task-locked",
    title: "I can't edit a task's details",
    area: "Tasks",
    pages: ["/tasks"],
    phrases: ["cant edit task", "fields are greyed out", "cannot change deadline", "details are managed by the reviewer", "task edit nahi ho raha", "cant change assignee", "cant change due date"],
    keywords: ["edit", "locked", "greyed", "disabled", "change", "deadline", "assignee", "task", "lock"],
    solution: `People doing the work can change the **stage** and their **Execution Notes**. The other details (deadlines, client, assignee, reviewer) are managed by the task's **reviewer** or an **administrator**.

1. Write what needs changing in **Execution Notes**, or message your reviewer.
2. The reviewer or an administrator opens the task and changes it.`,
  },
  {
    id: "no-add-task",
    title: "I don't see the Add Task button",
    area: "Tasks",
    adminOnly: true,
    staffNote: "Only administrators create tasks. Ask an administrator to create it and assign it to you.",
    pages: ["/tasks"],
    phrases: ["add task button missing", "how to create task", "cant create task", "new task kaise banaye", "add task nahi dikh raha"],
    keywords: ["add", "create", "new", "task", "button"],
    solution: `1. Open **Tasks & Compliance** and click **Add Task**.
2. Choose the work in **Task**, enter the **Period**, and choose the **Client**.
3. Deadlines and the estimate fill in from the Task List. Choose the assignee and reviewer.
4. Click **Create Task**.`,
  },
  {
    id: "task-not-in-list",
    title: "The task I need isn't in the Task list",
    area: "Tasks",
    adminOnly: true,
    staffNote: "Task names come from the firm's Task List, which only administrators can change. Ask an administrator to add it.",
    pages: ["/tasks"],
    phrases: ["task not in list", "cant find task title", "task name not available", "custom task title", "task list mein nahi hai"],
    keywords: ["task", "list", "title", "name", "dropdown", "missing", "type"],
    solution: `1. In **Tasks & Compliance**, click **Task List**.
2. Add the task: name, category, recurrence and, if it has a fixed due date, **Statutory Day**, **Of Which Month** and **Internal Buffer**.
3. Click **Add to List**. It now appears in the **Task** dropdown.`,
  },
  {
    id: "cant-submit",
    title: "I can't submit a task for review",
    area: "Tasks",
    pages: ["/tasks"],
    phrases: ["submit for review button missing", "cant submit task", "submit nahi ho raha", "how to submit task", "submit button not showing"],
    keywords: ["submit", "review", "button", "send", "complete", "done", "finish"],
    solution: `**Submit for Review** appears when:
- the task is **assigned to you**, and
- it's **Assigned**, **In Progress** or **Changes Required**.

1. Open the task from **My Work**.
2. Click **Submit for Review** at the bottom.

If it's already **Submitted for Review**, it's waiting for the reviewer. If it's **Approved**, nothing more is needed.`,
  },
  {
    id: "reviewer-same",
    title: "It says the reviewer must be a different person",
    area: "Tasks",
    phrases: ["reviewer must be different", "reviewer same as assignee", "maker checker error", "reviewer cannot also do the work"],
    keywords: ["reviewer", "same", "different", "maker", "checker", "assignee"],
    solution: `The person who does the work can't also approve it (maker-checker). Choose a **different reviewer**, or a different person in **Assign Execution To**, then save again.`,
  },
  {
    id: "deadline-order",
    title: "It says the internal deadline must be before the statutory deadline",
    area: "Tasks",
    phrases: ["internal deadline must be on or before", "deadline error", "statutory deadline error", "internal date after due date"],
    keywords: ["internal", "statutory", "deadline", "before", "date"],
    solution: `Your team's deadline can't be later than the legal due date. Set the **Internal Team Deadline** on or before the **Statutory Deadline**, then save.`,
  },
  {
    id: "feedback-required",
    title: "I can't send a task back for changes",
    area: "Tasks",
    phrases: ["request changes not working", "please write reviewer feedback", "send back task", "changes required error", "return task to staff"],
    keywords: ["request", "changes", "feedback", "return", "reject", "send", "back"],
    solution: `1. Open the task.
2. Write what needs fixing in **Reviewer Feedback / Required Changes**.
3. Click **Request Changes**. The person gets your feedback and a notification.`,
  },
  {
    id: "recurring-missing",
    title: "The next recurring task wasn't created",
    area: "Tasks",
    phrases: ["next month task not created", "recurring task missing", "repeat task not generated", "agle mahine ka task nahi bana", "next period task missing"],
    keywords: ["recurring", "repeat", "next", "month", "period", "generate", "monthly", "quarterly"],
    solution: `The next occurrence is created **when the current one is Approved**, not when it's submitted.

1. Check the current task's stage. If it's **Submitted for Review**, the reviewer needs to approve it.
2. Check its **Recurrence** isn't "None".
3. After approval, look in **All Tasks** for the next period (for example Nov 2026).`,
  },
  {
    id: "transfer-task",
    title: "I need to hand a task to someone else",
    area: "Tasks",
    pages: ["/tasks"],
    phrases: ["transfer task", "reassign task", "give task to colleague", "going on leave", "task kisi aur ko dena", "handover task"],
    keywords: ["transfer", "reassign", "handover", "leave", "colleague", "move"],
    solution: `1. Open the task and click **Request transfer**.
2. Give a **reason**, write **handover notes** (what's done and what's pending) and, if you like, suggest who should take it.
3. Click **Send request**. An administrator, the reviewer or whoever assigned it decides, and you're notified.

Administrators and reviewers can use **Transfer** to move it straight away. Approved tasks can't be transferred.`,
  },
  {
    id: "transfer-blocked",
    title: "My transfer isn't going through",
    area: "Tasks",
    phrases: ["transfer request pending", "transfer not approved", "cant transfer approved task", "transfer error reviewer", "transfer already pending"],
    keywords: ["transfer", "pending", "approved", "blocked", "request"],
    solution: `- **Waiting:** a request stays pending until an administrator, the reviewer or the assigner decides. They've been notified.
- **"Already pending":** only one request per task at a time. Withdraw the old one in the task's **Transfers** section first.
- **"Approved tasks cannot be transferred":** the work is finished.
- **"The reviewer cannot also do the work":** choose someone other than the reviewer.`,
  },
  {
    id: "work-order",
    title: "Which task should I do first?",
    area: "Tasks",
    pages: ["/tasks"],
    phrases: ["which task first", "work order", "my queue", "priority order", "pehle kaunsa task", "what should i do next"],
    keywords: ["queue", "order", "first", "priority", "next"],
    solution: `1. In **Tasks & Compliance**, click **Queue**.
2. Work from **#1** downwards. The order is either set by your administrator or follows the nearest deadline.
3. Click **Start** on a task to begin. The timer starts automatically.`,
  },
  {
    id: "task-missing",
    title: "I can't find a task that's assigned to me",
    area: "Tasks",
    pages: ["/tasks"],
    phrases: ["cant find my task", "task disappeared", "task not showing", "assigned task not visible", "mera task nahi dikh raha", "task gayab"],
    keywords: ["find", "missing", "disappeared", "task", "visible", "lost", "search"],
    solution: `1. In **Tasks & Compliance**, choose **My Work**.
2. Click **Clear filters** if any filters are set.
3. Search by the task name, period (e.g. "Oct 2026") or client.
4. Check your notifications. The task may have been **transferred** to someone else.

Approved tasks show with the Approved stage. If it's still missing, it may have been deleted by an administrator.`,
  },
  {
    id: "reminders",
    title: "I keep getting reminder popups",
    area: "Notifications",
    phrases: ["too many reminders", "popup keeps coming", "stop reminders", "remind me later", "snooze popup", "overdue reminder", "baar baar popup"],
    keywords: ["reminder", "popup", "snooze", "later", "overdue", "notification", "alert"],
    solution: `Reminders stop by themselves once the work moves forward: **start** a task to stop "not started" reminders, and **submit** it to stop "overdue" reminders.

To come back to a popup later, click **Remind me later** and choose **In 1 hour**, **In 3 hours** or **Tomorrow 10 AM**.

Administrators can change the reminder rules under **Tasks & Compliance → Reminders**.`,
  },

  /* ---------------- Time ---------------- */
  {
    id: "timer-not-started",
    title: "The timer didn't start",
    area: "Time",
    pages: ["/tasks", "/time-tracking", "/"],
    phrases: ["timer didnt start", "timer not starting", "clock not running", "time not recording", "timer nahi chala", "start work timer not working", "timer bar not showing"],
    keywords: ["timer", "start", "clock", "running", "record", "tracking", "stopwatch"],
    ask: {
      question: "Did you click **Start Work** (or **Start** / **Start now**) yourself, on a task that's assigned to you?",
      options: [
        { label: "Yes, I did", next: "timer-not-started-bug" },
        { label: "Someone else changed the stage", next: "timer-not-mine" },
        { label: "I'm not sure how to start it", next: "timer-how-start" },
      ],
    },
    solution: `Open a task assigned to you and click **Start Work**. A green timer bar appears at the bottom left.`,
  },
  {
    id: "timer-not-started-bug",
    title: "The timer didn't start after I clicked Start",
    area: "Time",
    hidden: true,
    escalate: true,
    phrases: [],
    keywords: [],
    solution: `1. Refresh the page. The timer bar at the **bottom left** may simply not have updated yet.
2. If there's still no bar, open **Time Tracking** and start a timer for the task manually.
3. Note the task name and roughly when you clicked Start.`,
  },
  {
    id: "timer-not-mine",
    title: "The timer only starts for your own action",
    area: "Time",
    hidden: true,
    phrases: [],
    keywords: [],
    solution: `The timer starts only when **the assigned person** starts the task. If an administrator or reviewer changed the stage, no timer starts for you.

1. Open **Time Tracking** and start the timer for the task yourself, or
2. Add the time later with **Manual Entry** (or in **Review my day**).`,
  },
  {
    id: "timer-how-start",
    title: "How to start the timer",
    area: "Time",
    hidden: true,
    phrases: [],
    keywords: [],
    solution: `1. Open **Tasks & Compliance → My Work** (or **Queue**).
2. Open a task assigned to you and click **Start Work**. In the Queue, click **Start**.
3. A green bar appears at the **bottom left** with the task and running time.
4. When you finish, click **Submit for Review**. The time is saved automatically.`,
  },
  {
    id: "timer-forgot",
    title: "I forgot to stop the timer",
    area: "Time",
    phrases: ["forgot to stop timer", "timer running all night", "timer still running", "wrong hours from timer", "timer band karna bhool gaya", "timer kept running"],
    keywords: ["forgot", "stop", "running", "night", "timer", "wrong", "hours"],
    solution: `1. Click **Stop** on the timer bar (bottom left).
2. Open **Time Tracking → Review my day**, correct the minutes on that entry, and click **Save**.

You're also protected automatically: the timer pauses after **30 minutes** with no activity, and anything left running is stopped overnight and marked **Check** for you to review.`,
  },
  {
    id: "correct-time",
    title: "How do I correct time I logged?",
    area: "Time",
    pages: ["/time-tracking"],
    phrases: ["edit time entry", "wrong time logged", "change hours", "delete time entry", "correct timesheet", "time galat hai", "fix my hours"],
    keywords: ["edit", "correct", "change", "delete", "time", "entry", "hours", "timesheet", "wrong"],
    solution: `**Today's entries:**
1. Open **Time Tracking** and click **Review my day**.
2. Change the hours, minutes or description, then click **Save** on that row (or the bin icon to delete).
3. Click **Confirm my day** when everything is right.

**Earlier entries (last 7 days):** edit or delete them from the time log list in **Time Tracking**. Entries changed this way are marked **Edited**.`,
  },
  {
    id: "time-locked",
    title: "It says entries older than 7 days are locked",
    area: "Time",
    adminOnly: true,
    staffNote: "Time older than 7 days is locked so timesheets stay reliable. Ask an administrator to make the change for you.",
    phrases: ["older than 7 days are locked", "cant edit old time", "time locked", "old entry locked", "purani entry"],
    keywords: ["locked", "old", "seven", "days", "week", "time"],
    solution: `Administrators can still change older entries. Open **Time Tracking**, find the entry in the log, and edit or delete it.`,
  },
  {
    id: "time-24h",
    title: "It says this would exceed 24 hours",
    area: "Time",
    phrases: ["exceed 24 hours", "24 hours error", "more than 24 hours"],
    keywords: ["24", "hours", "exceed", "limit", "day"],
    solution: `A single day can't have more than 24 hours logged, usually because of a forgotten timer.

1. Open **Time Tracking → Review my day** (or the time log for that date).
2. Fix or delete the entry that's too long.
3. Add your new entry again.`,
  },
  {
    id: "welcome-back",
    title: "What is the 'Welcome back' popup?",
    area: "Time",
    phrases: ["welcome back popup", "timer paused by itself", "away time", "idle popup", "timer paused automatically", "you were away"],
    keywords: ["welcome", "paused", "idle", "away", "automatically"],
    solution: `Your timer pauses after **10 minutes** without mouse or keyboard activity, so idle time isn't counted by mistake. When you come back, choose:
- **Keep this time:** you were working away from the screen (a call, reading, a visit).
- **Discard the away time:** you weren't working, and the timer continues.
- **Stop the timer:** saves the time up to when you went away.`,
  },
  {
    id: "day-review",
    title: "What is the 'Your day' window?",
    area: "Time",
    phrases: ["your day popup", "confirm my day", "review my day", "day review popup", "evening popup"],
    keywords: ["day", "review", "confirm", "evening", "timesheet"],
    solution: `After **6:30 PM** you're asked once to check today's time: fix any minutes, delete mistakes, add work you forgot, then click **Confirm my day**. You can also open it anytime from **Time Tracking → Review my day**.`,
  },

  /* ---------------- Performance ---------------- */
  {
    id: "performance-score",
    title: "My performance score looks wrong or low",
    area: "Performance",
    pages: ["/performance"],
    phrases: ["performance score low", "kpi wrong", "score unfair", "on leave score", "my score", "score galat"],
    keywords: ["score", "performance", "kpi", "low", "unfair", "rating", "leave"],
    solution: `Your score combines **Timeliness** (submitted by the internal deadline), **Quality** (approved without changes), **Volume** (completed work by estimated hours) and **Activeness** (days active in the app).

- Check the **period** at the top. A new month starts with little data.
- Leave isn't tracked yet, so days off lower Activeness. Mention leave to your administrator for your review notes.
- Open your scorecard to see each figure. If a number looks wrong, tell support which one.`,
  },

  /* ---------------- Clients ---------------- */
  {
    id: "duplicate-client",
    title: "It warns that the client may be a duplicate",
    area: "Clients",
    pages: ["/clients"],
    phrases: ["duplicate client", "client already exists", "same pan warning", "merge clients", "similar client found"],
    keywords: ["duplicate", "exists", "same", "pan", "gstin", "merge", "similar"],
    solution: `The system found a client with the same PAN, GSTIN or phone, or a very similar name.

1. Check the matches shown. If it's the same client, open that one instead of creating a new one.
2. If it's genuinely different (e.g. a group company), you can still save.
3. Administrators can merge duplicates from the Clients page. Tasks, invoices and documents move to the client you keep.`,
  },
  {
    id: "client-not-found",
    title: "I can't find a client in the client list",
    area: "Clients",
    phrases: ["client not in list", "cant find client", "client search not working", "client nahi mil raha", "client missing from dropdown"],
    keywords: ["client", "find", "search", "missing", "dropdown", "picker"],
    solution: `1. Type part of the **organisation name**, the **person's name**, the **PAN**, **GSTIN** or **phone number**. All of them work in the client search.
2. Clients that were **merged** into another no longer appear; search for the remaining one.
3. Inactive clients may be hidden in some lists.
4. If the client doesn't exist, someone with the **Clients** module can add them.`,
  },

  /* ---------------- Invoices & documents ---------------- */
  {
    id: "pdf-not-opening",
    title: "A PDF doesn't open",
    area: "Documents",
    phrases: ["pdf not opening", "invoice pdf blank", "quotation pdf not working", "print not working", "pdf nahi khul raha", "pdf preview"],
    keywords: ["pdf", "open", "preview", "print", "blank", "download"],
    solution: `1. PDFs open in a **new tab**. If nothing happens, allow **pop-ups** for this site (the icon at the right of the address bar).
2. If you're asked to sign in, sign in and open it again.
3. Refresh the page and try once more.
4. Use your browser's own print and download buttons in the PDF tab.`,
  },
  {
    id: "email-not-received",
    title: "The client didn't receive an email",
    area: "Email",
    phrases: ["client didnt get email", "email not received", "mail not delivered", "invoice email not received", "mail nahi gaya", "client ko mail nahi mila"],
    keywords: ["email", "mail", "received", "delivered", "spam", "client", "send"],
    solution: `1. Ask the client to check **Spam / Junk / Promotions**.
2. Check the **email address** on the client record for typos.
3. Look for the **emailed** date on the invoice or quotation to confirm it was sent.
4. Send it again.

If no emails are going out at all, an administrator can check the firm's email account.`,
  },
  {
    id: "invoice-edit",
    title: "I can't edit an invoice",
    area: "Invoices",
    pages: ["/invoices"],
    phrases: ["cant edit invoice", "invoice locked", "change issued invoice", "wrong invoice amount", "invoice edit nahi ho raha"],
    keywords: ["invoice", "edit", "locked", "change", "issued", "amount"],
    solution: `Once an invoice is **issued**, its amounts are locked. That's a GST requirement, not a fault.

- **Draft** invoices can be edited freely.
- For an issued invoice with a mistake, **cancel** it and create a corrected one (or a credit note if your firm uses them).`,
  },
  {
    id: "invoice-delete",
    title: "I want to delete an invoice, or there's a gap in invoice numbers",
    area: "Invoices",
    phrases: ["delete invoice", "invoice number gap", "missing invoice number", "cancel invoice", "invoice series", "invoice number skipped"],
    keywords: ["delete", "invoice", "number", "gap", "series", "cancel", "skipped"],
    solution: `Issued invoices can't be deleted. GST needs a continuous series, so a wrong invoice is **cancelled** and stays in the list marked Cancelled.

Numbers are given only when an invoice is **issued**, so drafts don't use up numbers. A cancelled invoice keeps its number, which is correct.`,
  },
  {
    id: "payment-status",
    title: "The invoice still shows unpaid after the client paid",
    area: "Invoices",
    pages: ["/invoices"],
    phrases: ["payment not updated", "invoice still unpaid", "mark invoice paid", "partial payment", "record payment", "payment aa gaya but unpaid"],
    keywords: ["payment", "paid", "unpaid", "record", "partial", "received", "balance"],
    solution: `The system knows about a payment only when it's recorded.

1. Open the invoice in **Invoices**.
2. Record the payment: amount, date, mode and reference.
3. The status changes to **Partially Paid** or **Paid** automatically, and reminders stop.`,
  },
  {
    id: "doc-open",
    title: "I can't open or download a document",
    area: "Documents",
    pages: ["/documents"],
    phrases: ["document not opening", "cant download file", "share link expired", "file not opening", "document nahi khul raha"],
    keywords: ["document", "file", "download", "open", "link", "expired", "share"],
    solution: `1. Documents are private. Opening one creates a **temporary** secure link, so open it again from **Documents** if an old link stopped working.
2. Shared links expire. Create a fresh share link for the client.
3. Allow **pop-ups** for this site if nothing opens.`,
  },

  /* ---------------- Packages & billing (admin) ---------------- */
  {
    id: "proposal-link",
    title: "The client's engagement link doesn't work",
    area: "Packages",
    adminOnly: true,
    staffNote: ASK_ADMIN,
    phrases: ["engagement link not working", "client cant accept proposal", "proposal expired", "accept link invalid", "engagement letter link"],
    keywords: ["engagement", "proposal", "link", "accept", "expired", "invalid"],
    solution: `1. Open **Service Packages → Proposals & Engagement Letters** and check the status.
2. **Expired**, **Withdrawn** or **Declined** letters can't be accepted. Create a new proposal.
3. For a valid letter, click the **email** icon to resend, or the **WhatsApp** icon to send the link again.
4. If the client changed even one character of the link, it shows "This link isn't valid", so ask them to use the original link.`,
  },
  {
    id: "bill-not-generated",
    title: "A monthly bill wasn't generated",
    area: "Packages",
    adminOnly: true,
    staffNote: ASK_ADMIN,
    phrases: ["bill not generated", "monthly bill missing", "subscription invoice not created", "billing not working", "auto bill nahi bana"],
    keywords: ["bill", "billing", "monthly", "subscription", "generate", "missing", "auto"],
    solution: `1. Open **Service Packages → Billing**.
2. Check the client's **Billing** switch is **On**. Older subscriptions start Off.
3. Check the **Next bill** date. Bills are created on the bill day after the period ends (e.g. 5 Nov for October).
4. Look under **Subscription bills**. New bills are **drafts** until you click **Approve & send**.
5. Click **Run billing now** to check immediately.`,
  },
  {
    id: "unassigned-tasks",
    title: "Onboarded tasks have nobody assigned",
    area: "Packages",
    adminOnly: true,
    staffNote: ASK_ADMIN,
    phrases: ["unassigned tasks", "package tasks no one assigned", "onboarding tasks unassigned"],
    keywords: ["unassigned", "assign", "onboard", "package", "nobody"],
    solution: `Tasks are assigned to the service's default person, otherwise to the client's relationship manager.

1. Open **Tasks & Compliance**, choose the **Unassigned** filter in the staff dropdown, and assign each task.
2. To prevent it next time, set a relationship manager on the client, or a default person on each package service.`,
  },
  {
    id: "calendar-bulk",
    title: "How do I create a task for many clients at once?",
    area: "Calendar",
    adminOnly: true,
    staffNote: ASK_ADMIN,
    pages: ["/calendar"],
    phrases: ["create tasks for all clients", "bulk tasks", "calendar create client tasks", "same task many clients"],
    keywords: ["bulk", "many", "all", "clients", "calendar", "create"],
    solution: `1. Open **Compliance Calendar** and click the statutory event.
2. Click **Create client tasks**.
3. Tick the clients (search by name or GSTIN), check the dates, and confirm.`,
  },

  /* ---------------- Inbox & notifications ---------------- */
  {
    id: "inbox-missing",
    title: "Emails aren't showing in the Unified Inbox",
    area: "Inbox",
    escalate: true,
    pages: ["/inbox"],
    phrases: ["emails not showing", "inbox not updating", "mail not coming in inbox", "inbox delay", "mail nahi aa raha", "new emails missing"],
    keywords: ["inbox", "email", "mail", "sync", "showing", "delay", "missing"],
    solution: `1. New mail arrives automatically about every **5 minutes**. Click **Sync** for an immediate fetch, then refresh the page.
2. If mail stopped completely, the mailbox password may have changed. Gmail needs an **App Password**, not your normal password.
3. An administrator can check the account with **Test connection**.`,
  },
  {
    id: "no-notifications",
    title: "I'm not getting notifications",
    area: "Notifications",
    phrases: ["not getting notifications", "bell not showing", "notification nahi aa raha", "no alerts", "didnt get notified"],
    keywords: ["notification", "bell", "alert", "notified", "popup"],
    solution: `1. Click the **bell** at the top. Every notification is listed there, even ones you missed.
2. Important ones also pop up on the **Dashboard**.
3. Refresh the page if the bell hasn't updated.
4. You're only notified about things that involve you: your tasks, your reviews, and announcements.`,
  },
];