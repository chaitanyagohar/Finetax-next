import type { PostgrestError } from "@supabase/supabase-js";

// Supabase returns at most this many rows per request (Project Settings -> API -> Max rows).
const PAGE_SIZE = 1000;
// Stops a runaway loop; 50,000 rows is far beyond any single list in the app.
const MAX_PAGES = 50;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: PostgrestError | null }>;

/**
 * Reads every row of a query, one page at a time, so lists are never cut off at 1,000.
 * The query must have a stable order (end it with .order("id")) so pages do not overlap.
 *
 *   fetchAll((from, to) => supabase.from("clients").select("id, name").order("name").order("id").range(from, to))
 */
export async function fetchAll<T>(page: (from: number, to: number) => PageResult<T>): Promise<{ data: T[]; error: PostgrestError | null }> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}
