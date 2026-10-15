"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useLogout() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout Error:", error);
    } finally {
      // Hard redirect wipes all in-memory client data (security best practice)
      window.location.href = "/login";
    }
  }

  return { logout, loggingOut };
}