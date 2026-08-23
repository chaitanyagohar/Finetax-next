import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "Practice Manager",
  description: "CA Firm Practice Management System",
};

// Define the shape of the user prop
interface UserProfile {
  name?: string;
  role?: string;
  [key: string]: any;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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

  const { data: { user } } = await supabase.auth.getUser();

  // If no user is logged in, ONLY render the login page children
  if (!user) {
    return (
      <html lang="en">
        <body className="bg-background text-text-main antialiased m-0 p-0">
          {children}
        </body>
      </html>
    );
  }

  // If logged in, fetch their specific role/profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("name, role")
    .eq("id", user.id)
    .single();

  const activeUser: UserProfile = profile || { name: "Staff Member", role: "staff" };

return (
    <html lang="en">
      <body className="bg-background text-text-main antialiased m-0 p-0">
        <div className="flex h-screen w-screen overflow-hidden bg-background">
          {/* Render layout components safely */}
          <Sidebar />
          
          <div className="flex-1 flex flex-col overflow-hidden relative">
            <Topbar />
            <main className="flex-1 overflow-auto p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}