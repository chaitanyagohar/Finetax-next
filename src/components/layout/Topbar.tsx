"use client";

import { Bell, Search, User } from "lucide-react";

interface TopbarProps {
  user?: {
    name: string;
    role: string;
  };
}

export default function Topbar({ user = { name: "Chaitanya Gohar", role: "admin" } }: TopbarProps) {
  return (
    <header className="h-16 bg-surface border-b border-border px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4">
        <h2 className="text-sm font-semibold text-text-main">CA Practice Management Portal</h2>
      </div>

      <div className="flex items-center gap-4">
        <button className="relative text-text-muted hover:text-text-main transition p-1">
          <Bell className="h-5 w-5" />
          <span className="absolute top-0 right-0 h-2 w-2 bg-danger rounded-full"></span>
        </button>

        <div className="h-6 w-px bg-border"></div>

        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-navy text-white flex items-center justify-center font-bold text-xs">
            {user.name.charAt(0)}
          </div>
          <div className="text-xs">
            <p className="font-semibold text-text-main leading-none">{user.name}</p>
            <p className="text-text-muted capitalize leading-tight">{user.role}</p>
          </div>
        </div>
      </div>
    </header>
  );
}