"use client";

import { LogOut, Loader2 } from "lucide-react";
import { useLogout } from "./useLogout";

export default function SignOutButton() {
  const { logout, loggingOut } = useLogout();

  return (
    <button
      type="button"
      onClick={logout}
      disabled={loggingOut}
      className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-light disabled:opacity-60"
    >
      {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
      {loggingOut ? "Signing out..." : "Sign out"}
    </button>
  );
}