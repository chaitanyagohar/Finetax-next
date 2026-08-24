export const dynamic = "force-dynamic";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          // Explicitly pass options so maxAge: 0 clears the auth token across subdomains/paths
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  // 1. Sign out from Supabase (clears session cookies on server side)
  await supabase.auth.signOut();

  // 2. Dynamically construct redirect URL using the request origin
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = ""; // clear any active query params

  return NextResponse.redirect(loginUrl, { status: 302 });
}