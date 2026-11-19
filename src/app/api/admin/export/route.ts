export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, assertSameOrigin, errorResponse, getAdminClient, requireAdmin, writeAuditLog } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { verifyCallerPassword } from "@/lib/api/reauth";
import { istDate } from "@/lib/format";
import { toCsv, zipFiles } from "@/lib/zip";

// What a firm can take with it. Secrets (mailbox passwords, payment keys) are never included.
const TABLES: { table: string; file: string; columns: string }[] = [
  { table: "clients", file: "clients.csv", columns: "id, name, organization_name, type, pan, gstin, tan, gst_scheme, email, phone, state, address, status, notes, created_at" },
  { table: "leads", file: "enquiries.csv", columns: "*" },
  { table: "quotations", file: "quotations.csv", columns: "*" },
  { table: "invoices", file: "invoices.csv", columns: "*" },
  { table: "invoice_payments", file: "payments.csv", columns: "*" },
  { table: "tasks", file: "tasks.csv", columns: "*" },
  { table: "task_checklist_items", file: "task_checklists.csv", columns: "*" },
  { table: "time_logs", file: "time_logs.csv", columns: "*" },
  { table: "documents", file: "documents_index.csv", columns: "id, client_id, task_id, title, category, description, file_name, size_bytes, created_at" },
  { table: "discussions", file: "client_discussions.csv", columns: "*" },
  { table: "task_types", file: "task_list.csv", columns: "*" },
  { table: "client_packages", file: "client_packages.csv", columns: "*" },
  { table: "service_packages", file: "service_packages.csv", columns: "*" },
];

const PAGE = 1000;
const MAX_ROWS = 100_000;

/** Every record of the firm as CSV files in one ZIP, for the firm's own records or to move elsewhere. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const caller = await requireAdmin();
    if (!(await checkRateLimit(`export:${caller.orgId}`, 3, 60 * 60 * 1000))) {
      throw new ApiError(429, "An export can be made 3 times an hour.");
    }
    // A full copy of the firm leaves Duesk: confirm it is really the administrator
    const body = (await request.json().catch(() => ({}))) as { adminPassword?: unknown };
    await verifyCallerPassword(caller.email, body.adminPassword);
    const admin = getAdminClient();
    const files: { name: string; data: Buffer }[] = [];
    const counts: Record<string, number> = {};

    for (const t of TABLES) {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const { data, error } = await admin.from(t.table).select(t.columns).eq("org_id", caller.orgId).order("id").range(from, from + PAGE - 1);
        if (error) throw new ApiError(500, `Could not read ${t.file}.`);
        rows.push(...((data || []) as unknown as Record<string, unknown>[]));
        if (!data || data.length < PAGE) break;
      }
      counts[t.file] = rows.length;
      files.push({ name: t.file, data: toCsv(rows) });
    }

    files.unshift({
      name: "README.txt",
      data: Buffer.from(
        `Duesk export for ${caller.orgName}, ${istDate()}.\r\n\r\n` +
          Object.entries(counts).map(([f, n]) => `${f}: ${n} rows`).join("\r\n") +
          `\r\n\r\nUploaded files are not inside this ZIP; documents_index.csv lists them. Ask Duesk support for a copy of the files themselves.\r\n`,
        "utf8",
      ),
    });

    await writeAuditLog({ actor: caller, action: "EXPORT_FIRM_DATA", entity: "SETTINGS", metadata: counts });
    const zip = zipFiles(files);
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="duesk-export-${istDate()}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
