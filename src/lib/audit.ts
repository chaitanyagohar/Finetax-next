import { createClient } from "@/lib/supabase/client";

export async function logAuditEvent(
  action: string,
  entity: string,
  entityId?: string,
  metadata: Record<string, any> = {}
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    let actorName = "System";
    
    // Fetch the user's name from profiles to make the timeline look pretty
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", user.id)
        .single();
        
      if (profile?.name) actorName = profile.name;
    }

    await supabase.from("audit_logs").insert([
      {
        user_id: user?.id || null,
        action,
        entity,
        entity_id: entityId || null,
        metadata: { ...metadata, actor_name: actorName },
        timestamp: new Date().toISOString(),
      },
    ]);
  } catch (error) {
    console.error("Failed to log audit event:", error);
  }
}