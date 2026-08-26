"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

  try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
      } else {
        // Force hard redirect so the corrected Middleware reads the new cookie
        window.location.href = "/";
      }
    } catch (err: any) {
      setError(err.message || "An unexpected network error occurred.");
      setLoading(false);
    }
  }
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md bg-surface p-8 rounded-xl border border-border shadow-lg">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 bg-navy text-white rounded-lg flex items-center justify-center mb-4 shadow-sm">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-navy">Finetax Manager</h1>
          <p className="text-sm text-text-muted mt-1">Sign in to your workspace</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          {error && (
            <div className="bg-danger/10 border border-danger/20 text-danger text-sm p-3 rounded text-center font-medium">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1.5">OFFICIAL EMAIL</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-border rounded-md p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-navy bg-background"
              placeholder="name@firm.com"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1.5">PASSWORD</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-border rounded-md p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-navy bg-background"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-navy text-white font-medium p-2.5 rounded-md hover:bg-navy/90 transition disabled:opacity-70"
          >
            {loading ? "Authenticating..." : "Secure Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}