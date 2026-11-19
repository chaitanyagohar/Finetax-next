/** The seller details printed on an invoice: the firm's, or its branch's when the branch is registered separately. SERVER ONLY. */
import { getAdminClient } from "@/lib/api/guard";

type Rec = Record<string, unknown> | null | undefined;

export async function sellerFor(invoice: Rec, firm: Rec): Promise<Record<string, unknown>> {
  const base = { ...(firm || {}) };
  const branchId = invoice?.branch_id;
  if (typeof branchId !== "string" || !branchId) return base;
  const { data: b } = await getAdminClient().from("branches").select("name, address, gstin, phone, email, is_default").eq("id", branchId).maybeSingle();
  if (!b || b.is_default) return base;
  return {
    ...base,
    address: b.address || base.address,
    gstin: b.gstin || base.gstin,
    phone: b.phone || base.phone,
    email: b.email || base.email,
  };
}
