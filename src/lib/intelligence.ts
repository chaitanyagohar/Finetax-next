import { createClient } from "@/lib/supabase/client";

export async function recalculateClientIntelligence(clientId: string) {
  const supabase = createClient();

  // Aggregate Total Invoice Revenue
  const { data: invoices } = await supabase
    .from("invoices")
    .select("amount")
    .eq("client_id", clientId);

  const totalRevenue = invoices?.reduce((sum, inv) => sum + Number(inv.amount), 0) || 0;

  // Aggregate Active Task Workload
  const { count: activeTasksCount } = await supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId)
    .in("stage", ["Assigned", "In Progress", "Submitted for Review"]);

  // Calculate Risk Level
  let riskLevel: "Low" | "Medium" | "High Workload" | "At-Risk" = "Low";

  if ((activeTasksCount || 0) > 8) {
    riskLevel = "High Workload";
  } else if (totalRevenue > 100000 && (activeTasksCount || 0) === 0) {
    riskLevel = "At-Risk";
  } else if (totalRevenue > 50000) {
    riskLevel = "Medium";
  }

  // Update Database Intelligence Record
  await supabase
    .from("clients")
    .update({
      total_revenue: totalRevenue,
      risk_level: riskLevel,
    })
    .eq("id", clientId);
}