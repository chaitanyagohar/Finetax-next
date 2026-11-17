/**
 * Guided tour content for every module.
 * target: CSS selector to spotlight. If it isn't on the page, the step is shown as a centred card.
 * Page elements are tagged with data-tour="..." (added page by page).
 */
export type TourStep = {
  target?: string;
  title: string;
  body: string;
  points?: string[];
  module?: string; // only for people with this module (admins see everything)
  adminOnly?: boolean;
  reviewerOnly?: boolean;
  tryIt?: string; // the person clicks the highlighted control and the tour moves on
};

export type Tour = { title: string; steps: TourStep[] };

const nav = (href: string) => `aside a[href="${href}"], nav a[href="${href}"]`;
const tag = (name: string) => `[data-tour="${name}"]`;

export const TOURS: Record<string, Tour> = {
  welcome: {
    title: "Duesk in 2 minutes",
    steps: [
      { title: "Welcome to Duesk", body: "Here's a quick look at where everything lives. Use the arrow keys or the buttons, and press Esc to leave the tour any time." },
      { target: nav("/"), title: "Dashboard", body: "Your firm at a glance: work due, revenue and receivables, compliance at risk and how busy each person is." },
      { target: nav("/tasks"), module: "tasks", title: "Tasks", body: "The heart of Duesk. Every compliance job is a task with an internal deadline before the statutory one, a reviewer, and automatic reminders." },
      { target: nav("/calendar"), module: "calendar", title: "Calendar", body: "Every due date in one calendar: statutory compliance dates and your team's internal deadlines." },
      { target: nav("/clients"), module: "leads", title: "Clients", body: "All client details in one place, with PAN and GSTIN checks, duplicate detection and spreadsheet import." },
      { target: nav("/leads"), module: "leads", title: "Leads", body: "Track enquiries, follow-up dates and who is handling each one, and turn them into quotations and clients." },
      { target: nav("/quotations"), module: "quotations", title: "Quotations", body: "GST-correct quotations as PDFs on your letterhead, emailed from your own mailbox." },
      { target: nav("/invoices"), module: "invoices", title: "Invoices", body: "Tax invoices with place of supply worked out for you, a UPI QR code, payment recording and one continuous number series." },
      { target: nav("/packages"), adminOnly: true, title: "Packages & engagement letters", body: "Bundle recurring services with a fee. Send an engagement letter; when the client accepts online, tasks and monthly bills start automatically." },
      { target: nav("/time-tracking"), module: "time_tracking", title: "Time tracking", body: "Timers follow your task stages, idle time is caught, and a short daily review keeps timesheets honest." },
      { target: nav("/performance"), title: "Performance", body: "KPI scorecards built from real task and time data, so reviews and appraisals are fair." },
      { target: nav("/inbox"), module: "dashboard", title: "Inbox", body: "Your firm's mailboxes in one inbox. Mail from clients is linked to them automatically." },
      { target: nav("/documents"), module: "documents", title: "Document vault", body: "A private vault for client documents, with secure 7-day share links and email attachments." },
      { target: nav("/chat"), title: "Team chat", body: "Channels, direct messages and a thread on every task, so discussions stay with the work." },
      { target: nav("/help"), title: "Help & support", body: "Step-by-step guides, a troubleshooter, and a chat with the Duesk team if you get stuck." },
      { title: "You're ready", body: "Open Getting started (bottom-left) for your checklist. Every page also has a short tour: open the checklist and choose \"Tour this page\"." },
    ],
  },

  "/": {
    title: "Dashboard",
    steps: [
      { title: "Your dashboard", body: "Everything that needs attention today, without opening each module. It updates live as work moves." },
      {
        target: tag("dash-kpis"),
        title: "Key numbers",
        body: "Click any card to drill in.",
        points: [
          "Admins: billed, collected, receivables and overdue work for the period you pick",
          "Everyone: your pending and overdue tasks, reviews and hours logged this week",
        ],
      },
      { target: tag("dash-compliance"), title: "Statutory deadlines, next 14 days", body: "Each day shows how many statutory deadlines fall on it. Click a day to see exactly what's due and its stage." },
      { target: tag("dash-capacity"), adminOnly: true, title: "Team capacity", body: "Active, overdue and to-review work for each person, so new work goes to whoever has room." },
      { target: tag("dash-stream"), title: "Work in motion", body: "The open tasks that matter most right now, with internal due dates and stages." },
    ],
  },

  "/tasks": {
    title: "Tasks",
    steps: [
      { title: "Tasks & compliance", body: "Every piece of client work is a task with an internal deadline, a statutory deadline and a clear stage." },
      { target: tag("tasks-kpis"), title: "Your numbers at a glance", body: "Open work, overdue tasks, statutory deadlines in the next 7 days and work awaiting review. Click a card to filter the list." },
      { target: tag("tasks-views"), tryIt: "Click Board to see every stage side by side.", title: "List, board or queue", body: "The list to filter and search, the board to see every stage at once, and the queue to see each person's work in priority order." },
      { target: tag("tasks-scope"), tryIt: "Click Review Queue to see what's waiting for your review.", title: "Mine, review, everything", body: "Switch between your own work, what's waiting for your review, and (for admins) every task in the firm." },
      {
        target: tag("tasks-new"),
        adminOnly: true,
        title: "Create a task",
        body: "Choose from your Task List. The statutory deadline, an internal deadline a few days earlier and a time estimate fill in from its rule.",
      },
      {
        title: "Stages and maker-checker review",
        body: "Open any task to move it forward.",
        points: [
          "Start Work, then Submit for Review when done",
          "The reviewer Approves, or Requests Changes with written feedback",
          "Emails go to the assignee, the reviewer and (optionally) the client at each step",
        ],
      },
      { title: "Recurring work schedules itself", body: "When a recurring task is approved, the next occurrence is created with both deadlines and the period moved forward." },
      { title: "Time, transfers and discussion", body: "Time is tracked as you work (and can be logged by hand), tasks can be transferred with handover notes, and every task has its own discussion with @mentions." },
      { target: tag("tasks-toolbar"), adminOnly: true, title: "Task list, categories and reminders", body: "Define compliance task types with due-date rules, colour categories, and when reminders and escalations go out." },
    ],
  },

  "/calendar": {
    title: "Calendar",
    steps: [
      { title: "One calendar for every deadline", body: "Statutory compliance dates and your team's internal deadlines in one place." },
      { target: tag("cal-grid"), title: "Month at a glance", body: "Open a day to see what's due and who is working on it." },
    ],
  },

  "/clients": {
    title: "Clients",
    steps: [
      { title: "Your client master", body: "One verified record per client, used everywhere: tasks, invoices, quotations, documents and discussions." },
      { target: tag("clients-kpis"), title: "At a glance", body: "Total and active clients, how many are GST-registered, and the receivables still due from them." },
      {
        target: tag("clients-new"),
        title: "Add a client",
        body: "Mistakes are caught before they reach an invoice.",
        points: [
          "PAN and GSTIN are checked as you type, and must belong together",
          "A valid GSTIN fills in the state and the PAN for you",
          "Possible duplicates (same PAN, mobile, email or a similar name) are flagged before saving",
        ],
      },
      { target: tag("clients-import"), title: "Bring your existing list", body: "Download the template and fill it in; columns are matched by name. A preview marks each row Ready, Warning or Skip, and nothing is saved until you click Import." },
      { target: tag("clients-duplicates"), adminOnly: true, title: "Find and merge duplicates", body: "Duesk scans for likely duplicates. Merging moves every task, invoice, payment, document and email to the record you keep, and the other is retired, not lost." },
      { target: tag("clients-filters"), title: "Search, filter, export", body: "Search by name, PAN, GSTIN, email or phone, filter by status, type or relationship manager, and export exactly what you see to CSV." },
      { title: "Client snapshot", body: "Open any client to see billed, received and due amounts, recent invoices, open tasks and pending quotations side by side." },
    ],
  },

  "/leads": {
    title: "Leads",
    steps: [
      { title: "Never lose an enquiry", body: "Every enquiry with its service, contact details, owner and follow-up date." },
      { target: tag("leads-new"), title: "Capture a lead", body: "Assign it to a colleague and they get an email with the details." },
      { title: "Send a document checklist", body: "Send the list of documents needed for a service by WhatsApp or email in one click." },
    ],
  },

  "/quotations": {
    title: "Quotations",
    steps: [
      { title: "Professional quotations", body: "On your letterhead, with GST worked out for you." },
      { target: tag("quotes-tabs"), title: "Every quotation by status", body: "See what's still a draft, what's been sent and waiting for a decision, and what has been won." },
      { title: "Send from your own mailbox", body: "Email the PDF straight to the client from your firm's address. Every send is recorded." },
    ],
  },

  "/invoices": {
    title: "Invoices",
    steps: [
      { title: "GST-correct invoicing", body: "Serial GST invoices, a full payments ledger and receivables tracking in one place." },
      { target: tag("invoices-kpis"), title: "Your money at a glance", body: "Billed and collected this financial year, what's outstanding and what's overdue. Click a card to filter the list." },
      {
        target: tag("invoices-new"),
        title: "Create an invoice",
        body: "Pick the client and add your services; Duesk does the tax work.",
        points: [
          "CGST + SGST or IGST follows the place of supply: the client's GSTIN, or their state",
          "The due date comes from your payment terms",
          "Bank and UPI details are filled into the notes",
        ],
      },
      { title: "Issued means locked", body: "A draft has no number. Issuing it (or emailing it) gives it the next number in your series and locks its amounts, client and buyer details. A wrong invoice is cancelled, and its number stays reserved so your GST series has no gaps." },
      { target: tag("invoices-tabs"), tryIt: "Click Overdue to see who owes you.", title: "Every invoice by status", body: "Draft, Sent, Partially Paid, Paid, Overdue and Cancelled, each with a count." },
      { target: tag("invoices-actions"), title: "Act from the list", body: "Record a payment, email the PDF from your firm's mailbox, or open the PDF with its UPI QR code." },
      { title: "Chase dues in one click", body: "Inside an invoice: send a WhatsApp reminder with the balance and your UPI and bank details, and see every payment with its mode and UTR." },
    ],
  },

  "/packages": {
    title: "Packages & engagement letters",
    steps: [
      { title: "From proposal to payment", body: "Retainer packages, engagement letters and automatic recurring billing work together, so the paperwork runs itself." },
      { target: tag("pkg-kpis"), title: "Your recurring revenue", body: "Active packages, clients on retainers, and monthly and annual recurring revenue at a glance." },
      {
        target: tag("pkg-new"),
        title: "Create a package",
        body: "One package can serve many clients.",
        points: [
          "Services linked to your Task List, so deadlines follow the statutory rule",
          "A default assignee per service, or the client's relationship manager",
          "Fee, billing cycle, engagement-letter text and billing defaults (bill day, due days, late fee, pro-rating)",
        ],
      },
      { target: tag("pkg-tab-proposals"), tryIt: "Open the Proposals tab.", title: "Proposals & engagement letters", body: "Compose a letter from a package, then email it or share a WhatsApp link. The client reviews and accepts online, or you record a signed copy." },
      { title: "What acceptance does", body: "The year's tasks are scheduled with statutory and internal dates, the subscription starts billing, and admins are told about any task without an assignee." },
      { target: tag("pkg-tab-billing"), title: "Recurring billing", body: "On the bill day Duesk drafts each client's invoice, pro-rates the first period and adds late fees with GST. Approve and send, or let trusted clients' bills go automatically. Reminders go before, on and after the due date." },
      { target: tag("pkg-card-actions"), title: "Already working with a client?", body: "Onboard them directly without a proposal. You'll see every task with its deadlines and assignee before anything is created." },
      { target: tag("pkg-actions"), title: "Engagement terms", body: "Firm-wide clauses used in every letter: signatory, registration number, standard terms and jurisdiction." },
    ],
  },

  "/time-tracking": {
    title: "Time tracking",
    steps: [
      { title: "Time that tracks itself", body: "Most time is recorded without anyone filling a timesheet." },
      { target: tag("time-timer"), title: "Live timer", body: "Runs on the server, so it survives refreshes and closed tabs. Pick a task or client, then Stop & Save. Admins see who is clocked in right now." },
      {
        title: "Automatic time from tasks",
        body: "Starting work on a task starts its timer, and submitting stops it.",
        points: ["Idle time pauses the timer", "Forgotten timers are stopped overnight and marked Check for your review"],
      },
      { target: tag("time-review"), title: "Review my day", body: "A quick end-of-day check to confirm or fix your hours before they become final." },
      { target: tag("time-period"), tryIt: "Click This Month.", title: "Periods, export and manual entries", body: "Switch between today, this week or month, export a CSV timesheet, or add a manual entry. Staff entries lock after 7 days." },
      { target: tag("time-kpis"), title: "Your numbers", body: "Total and billable hours, the billable ratio and the average per working day." },
      { target: tag("time-attendance"), adminOnly: true, title: "Attendance", body: "Which days each person worked and for how long, built from real activity." },
      { target: tag("time-entries"), title: "Every entry, labelled", body: "Timer, Auto, Edited and Check labels show how each entry was made, so timesheets stay honest." },
    ],
  },

  "/performance": {
    title: "Performance",
    steps: [
      { title: "Fair, data-based scorecards", body: "Scores are calculated from real tasks and time logs, not impressions." },
      { target: tag("perf-scores"), title: "Scorecards", body: "Each person's weighted score, with the parts that make it up." },
      { adminOnly: true, title: "Monthly reviews", body: "Admins add review notes each month and can change the weights in the KPI settings." },
    ],
  },

  "/documents": {
    title: "Document vault",
    steps: [
      { title: "A private vault for client documents", body: "Files are private to your firm and filed by client and category." },
      { target: tag("docs-upload"), title: "Upload", body: "Upload several files at once and file them under a client." },
      { title: "Share safely", body: "Create a 7-day download link, or email a file as an attachment from your firm's mailbox." },
    ],
  },

  "/inbox": {
    title: "Inbox",
    steps: [
      { title: "One inbox for the firm", body: "All your firm's mailboxes in one place, linked to your clients." },
      { target: tag("inbox-tab-settings"), tryIt: "Open Connected Accounts.", adminOnly: true, title: "Connect mailboxes", body: "Gmail, Microsoft 365, Zoho, Hostinger, Titan or any mail server. Passwords are encrypted immediately and can be tested any time." },
      { target: tag("inbox-mailbox"), title: "One mailbox or all", body: "Read every firm mailbox together, or pick one." },
      { target: tag("inbox-sync"), title: "Mail arrives by itself", body: "New mail syncs automatically every few minutes. Use Sync when you can't wait." },
      { title: "Linked to clients", body: "Mail from a client's address is linked to them automatically. Change the link any time, or save an email to the client's discussion history in one click." },
      { target: tag("inbox-compose"), title: "Compose with attachments", body: "Send from any firm mailbox, attach invoices and quotations as PDFs, and start from templates for acknowledgements, document requests and payment reminders." },
    ],
  },

  "/chat": {
    title: "Team chat",
    steps: [
      { title: "Talk where the work is", body: "Channels for topics, direct messages for quick questions, and a thread on every task." },
      { title: "Mentions and files", body: "@mention someone to notify them, and share files right in the conversation." },
    ],
  },

  "/client-discussions": {
    title: "Client discussions",
    steps: [{ title: "Client history in one place", body: "Log calls, meetings and notes against each client, so everyone knows what was agreed." }],
  },

  "/reviewer-queue": {
    title: "Review queue",
    steps: [{ reviewerOnly: true, title: "Everything waiting for your review", body: "Approve work, or send it back as Changes Required with clear notes. The person is notified either way." }],
  },

  "/team": {
    title: "Team",
    steps: [
      { adminOnly: true, title: "Your team", body: "Add people and give them exactly the access they need." },
      {
        adminOnly: true,
        target: tag("team-add"),
        title: "Roles and modules",
        body: "Each person gets a role and a set of modules.",
        points: ["Admins manage the firm, staff do the work, reviewers approve it", "Turn modules on or off per person", "Deactivating someone keeps all their history"],
      },
    ],
  },

  "/settings": {
    title: "Settings",
    steps: [{ adminOnly: true, title: "Firm settings", body: "Letterhead details, numbering and GST rate. Bank details need your password to change, and other admins are alerted." }],
  },

  "/audit-page": {
    title: "Audit trail",
    steps: [{ adminOnly: true, title: "Who did what, and when", body: "Every important action is recorded. Filter by person or action and export to CSV." }],
  },

  "/help": {
    title: "Help & support",
    steps: [{ title: "Help when you need it", body: "Guides for every module, a troubleshooter that understands plain English and Hinglish, and a chat with the Duesk team." }],
  },
};