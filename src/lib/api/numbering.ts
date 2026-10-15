/**
 * Atomic document numbering (invoices, quotations). SERVER ONLY.
 * Uses the public.next_document_number() database function so two people
 * creating documents at the same moment can never get the same number.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Highest numeric suffix already used for this prefix (paginated scan, first use only). */
async function findMaxExisting(admin: SupabaseClient, table: string, column: string, prefix: string): Promise<number> {
  const pageSize = 1000;
  let from = 0;
  let max = 0;

  while (true) {
    const query: any = admin.from(table);
    const { data, error } = await query
      .select(column)
      .like(column, `${escapeLike(prefix)}%`)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);

    for (const row of data || []) {
      const suffix = String(row[column] || "").slice(prefix.length);
      if (/^\d+$/.test(suffix)) max = Math.max(max, parseInt(suffix, 10));
    }

    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return max;
}

export async function allocateDocumentNumber(
  admin: SupabaseClient,
  opts: { table: "invoices" | "quotations"; column: string; prefix: string; pad: number }
): Promise<string> {
  const scope = `${opts.table}:${opts.prefix}`;

  // Seed the counter from existing documents the first time a prefix is used
  const { data: counter } = await admin
    .from("document_counters")
    .select("last_value")
    .eq("scope", scope)
    .maybeSingle();

  const seed = counter ? 0 : await findMaxExisting(admin, opts.table, opts.column, opts.prefix);

  const { data: next, error } = await admin.rpc("next_document_number", { p_scope: scope, p_seed: seed });

  let value: number;
  if (error || typeof next !== "number") {
    // Fallback if the SQL migration has not been run yet
    console.warn("[numbering] next_document_number unavailable, using scan fallback:", error?.message);
    value = (await findMaxExisting(admin, opts.table, opts.column, opts.prefix)) + 1;
  } else {
    value = next;
  }

  return `${opts.prefix}${String(value).padStart(opts.pad, "0")}`;
}