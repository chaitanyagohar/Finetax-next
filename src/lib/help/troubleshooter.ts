/** No-AI problem matcher: understands the user's wording and finds the best known fix. SERVER ONLY. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROBLEMS, type Problem } from "@/lib/help/troubleshooting";

export type Option = { label: string; value: string };
export type MatchContext = { isAdmin: boolean; pagePath: string };

/** Everyday and Hinglish words mapped to one meaning. */
const SYNONYMS: Record<string, string> = {
  bill: "invoice", bills: "invoice", invoices: "invoice", inv: "invoice",
  quote: "quotation", quotes: "quotation", estimate: "quotation",
  clock: "timer", stopwatch: "timer", timers: "timer",
  mail: "email", mails: "email", emails: "email", gmail: "email",
  pwd: "password", pass: "password", passcode: "password",
  login: "signin", logon: "signin", signon: "signin",
  dikh: "see", dikha: "see", dikhta: "see", dikhra: "see", visible: "see", showing: "see", show: "see",
  nahi: "not", nhi: "not", nai: "not", na: "not",
  chal: "work", chala: "start", chalu: "start", shuru: "start",
  band: "stop", ruk: "stop", ruka: "stop",
  galat: "wrong", galti: "mistake", gayab: "missing", bhool: "forgot", bhul: "forgot",
  mila: "received", mili: "received", aaya: "received", aya: "received",
  kaam: "work", kam: "work", kaise: "how", kese: "how",
  customer: "client", customers: "client", party: "client", parties: "client",
  job: "task", jobs: "task", work: "task", tasks: "task",
  greyed: "locked", disabled: "locked", grey: "locked",
  approve: "review", approval: "review", checker: "review",
  reassign: "transfer", handover: "transfer",
  popups: "popup", alerts: "notification", alert: "notification", notifications: "notification",
  pdfs: "pdf", print: "pdf", printing: "pdf",
};

const STOP = new Set([
  "the", "a", "an", "i", "im", "my", "me", "is", "am", "are", "was", "to", "of", "and", "in", "on", "it", "its", "for", "when", "what",
  "do", "does", "did", "can", "please", "pls", "plz", "this", "that", "with", "from", "at", "be", "have", "has", "there", "not", "any", "some",
  "hai", "ho", "ka", "ki", "ke", "se", "mai", "main", "mera", "meri", "mere", "kya", "ye", "yeh", "to", "bhi", "raha", "rahi", "rha", "rhi", "hua", "hui", "kar", "karo", "koi",
  "sir", "maam", "hello", "hi", "help", "issue", "problem", "getting", "get", "got", "how",
]);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokens(text: string): string[] {
  const prepared = String(text || "")
    .toLowerCase()
    .replace(/can't|cannot|can not|cant/g, " cant ")
    .replace(/didn't|did not|doesn't|does not|don't|do not|isn't|is not|not able|unable|wasn't|won't/g, " not ")
    .replace(/sign in|log in|sign-in|log-in/g, " signin ")
    .replace(/e-mail/g, " email ");
  const raw = prepared.match(/[\p{L}\p{N}]+/gu) || [];
  const out: string[] = [];
  for (const w of raw) {
    const s = SYNONYMS[w] || w;
    if (STOP.has(s) || s.length < 2) continue;
    out.push(stem(SYNONYMS[stem(s)] || s));
  }
  return out;
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

type Entry = { p: Problem; w: Map<string, number>; phrases: string[][] };
let cachedIndex: { list: Problem[]; entries: Entry[]; idf: Map<string, number> } | null = null;

function getIndex(list: Problem[]) {
  if (cachedIndex && cachedIndex.list === list) return cachedIndex;
  const entries: Entry[] = list.map((p) => {
    const w = new Map<string, number>();
    const add = (text: string, weight: number) => tokens(text).forEach((t) => w.set(t, Math.max(w.get(t) || 0, weight)));
    add(p.title, 1.2);
    p.phrases.forEach((ph) => add(ph, 1));
    p.keywords.forEach((k) => add(k, 1.5));
    return { p, w, phrases: p.phrases.map(tokens).filter((x) => x.length >= 2) };
  });
  const df = new Map<string, number>();
  entries.forEach((e) => e.w.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
  const idf = new Map<string, number>();
  df.forEach((count, t) => idf.set(t, Math.log(1 + entries.length / count)));
  cachedIndex = { list, entries, idf };
  return cachedIndex;
}

/** Built-in problems plus answers saved from the Support Inbox (refreshed every minute). */
let dbCache: { at: number; list: Problem[] } | null = null;
export async function loadProblems(admin: SupabaseClient): Promise<Problem[]> {
  if (!dbCache || Date.now() - dbCache.at > 60_000) {
    const { data } = await admin.from("support_kb").select("*").eq("is_active", true);
    const custom: Problem[] = (data || []).map((r: any) => ({
      id: `kb:${r.id}`,
      title: r.title,
      area: r.area || "Other",
      adminOnly: !!r.admin_only,
      staffNote: r.staff_note || undefined,
      escalate: !!r.escalate,
      pages: r.pages || [],
      phrases: r.phrases || [],
      keywords: r.keywords || [],
      solution: r.solution,
    }));
    dbCache = { at: Date.now(), list: [...PROBLEMS, ...custom] };
  }
  return dbCache.list;
}

export function findProblem(list: Problem[], id: string): Problem | undefined {
  return list.find((p) => p.id === id);
}

/** Score every known problem against what the user wrote. */
export function rank(list: Problem[], text: string, ctx: MatchContext): { p: Problem; score: number }[] {
  const q = Array.from(new Set(tokens(text)));
  if (!q.length) return [];
  const qs = new Set(q);
  const { entries, idf } = getIndex(list);

  return entries
    .filter((e) => !e.p.hidden)
    .map((e) => {
      let score = 0;
      for (const t of q) {
        const direct = e.w.get(t);
        if (direct) {
          score += direct * (idf.get(t) || 1);
          continue;
        }
        if (t.length >= 5) {
          for (const [k, v] of e.w) {
            if (k.length >= 5 && withinOneEdit(k, t)) {
              score += 0.6 * v * (idf.get(k) || 1);
              break;
            }
          }
        }
      }
      if (e.phrases.some((ph) => ph.every((t) => qs.has(t)))) score += 2.5;
      if (ctx.pagePath && e.p.pages?.some((pg) => (pg === "/" ? ctx.pagePath === "/" : ctx.pagePath.startsWith(pg)))) score *= 1.15;
      return { p: e.p, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** The message (and buttons) for one problem. */
export function present(p: Problem, ctx: MatchContext): { body: string; options: Option[] } {
  if (p.ask) {
    return {
      body: `**${p.title}**\n\n${p.ask.question}`,
      options: [...p.ask.options.map((o) => ({ label: o.label, value: `p:${o.next}` })), { label: "Talk to a person", value: "person" }],
    };
  }
  const needsAdmin = p.adminOnly && !ctx.isAdmin;
  let body = `**${p.title}**\n\n${needsAdmin ? p.staffNote || "This needs an administrator. Ask an administrator, or click **Talk to a person**." : p.solution}`;
  if (p.escalate && !needsAdmin) body += `\n\nIf this doesn't fix it, it may be a fault. Click **Talk to a person** and the support team will check it.`;
  else body += `\n\nDid that solve it?`;
  return {
    body,
    options: needsAdmin
      ? [
          { label: "Talk to a person", value: "person" },
          { label: "OK, I'll ask an administrator", value: `solved:${p.id}` },
        ]
      : [
          { label: "✅ That solved it", value: `solved:${p.id}` },
          { label: "Didn't work", value: `notsolved:${p.id}` },
          { label: "Talk to a person", value: "person" },
        ],
  };
}

export async function bumpStat(admin: SupabaseClient, id: string, field: "shown" | "solved" | "not_solved") {
  try {
    await admin.rpc("bump_answer_stat", { p_id: id, p_field: field });
  } catch {
    /* statistics are best effort */
  }
}

/** Summary for the support agent, built from the conversation. */
export function buildSummary(subject: string, history: any[], flow: any, list: Problem[], pagePath: string): string {
  const userMsgs = history.filter((m) => m.role === "user").map((m) => String(m.body || "").trim()).filter(Boolean);
  const triedIds: string[] = [...(flow?.tried || [])];
  if (flow?.current && !triedIds.includes(flow.current)) triedIds.push(flow.current);
  const tried = triedIds.map((id) => findProblem(list, id)?.title).filter(Boolean);
  return [
    `Problem: "${(userMsgs[0] || subject).slice(0, 300)}"`,
    pagePath ? `Page: ${pagePath}` : "",
    tried.length ? `Answers already shown (not solved): ${tried.join("; ")}` : "No saved answer matched.",
    userMsgs.length > 1 ? `Latest message: "${userMsgs[userMsgs.length - 1].slice(0, 300)}"` : "",
  ]
    .filter(Boolean)
    .join("\n");
}