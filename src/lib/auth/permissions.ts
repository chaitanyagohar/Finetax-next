import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UserRole } from "@/types/database";

export async function checkServerPermission(
  requiredRole?: UserRole,
  requiredPermission?: string
) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/login");
  }

  // Admin bypass
  if (profile.role === "admin") return profile;

  // Strict Role Check
  if (requiredRole && profile.role !== requiredRole) {
    redirect("/");
  }

  // Granular Permission Check
  if (
    requiredPermission &&
    !profile.permissions?.[requiredPermission]
  ) {
    redirect("/");
  }

  return profile;
}