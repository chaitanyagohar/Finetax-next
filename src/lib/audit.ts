import { createClient } from "@/lib/supabase/client";

export async function logAuditEvent(
  action: string,
  entity: string,
  entityId?: string,
  metadata?: Record<string, any>
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase.from("audit_logs").insert([
    {
      user_id: user?.id || null,
      action,
      entity,
      entity_id: entityId || null,
      metadata: metadata || {},
      timestamp: new Date().toISOString(),
    },
  ]);
}