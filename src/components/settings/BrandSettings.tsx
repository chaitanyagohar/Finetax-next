"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Palette } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ImagePicker from "@/components/ui/ImagePicker";
import { btn } from "@/components/ui/kit";

const SWATCHES = ["#0f172a", "#1e3a8a", "#065f46", "#7c2d12", "#581c87", "#9f1239", "#f2613f", "#0e7490"];

/** Firm logo and brand colour. */
export default function BrandSettings({ firmName, onNotice }: { firmName: string; onNotice: (type: "success" | "error", message: string) => void }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [logo, setLogo] = useState<string | null>(null);
  const [color, setColor] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("firm_settings")
      .select("logo_url, brand_color")
      .maybeSingle()
      .then(({ data }) => {
        setLogo(data?.logo_url || null);
        setColor(data?.brand_color || "");
        setSaved(data?.brand_color || "");
      });
  }, [supabase]);

  async function saveColor() {
    setBusy(true);
    const res = await fetch("/api/admin/logo", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandColor: color }) });
    setBusy(false);
    if (!res.ok) return onNotice("error", "Could not save the colour.");
    setSaved(color);
    onNotice("success", "Brand colour saved.");
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-start gap-2 border-b border-border bg-surface-alt px-5 py-4">
        <Palette className="mt-0.5 h-4 w-4 text-navy" />
        <div>
          <h3 className="text-sm font-semibold text-text-main">Logo and brand colour</h3>
          <p className="text-[11px] text-text-muted">Shown in the sidebar, on invoices and quotations, in emails and in your client portal.</p>
        </div>
      </div>
      <div className="grid gap-6 p-5 text-xs md:grid-cols-2">
        <ImagePicker
          endpoint="/api/admin/logo"
          current={logo}
          label="logo"
          preview={
            logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={`${firmName} logo`} className="h-16 w-16 rounded-xl border border-border bg-white object-contain p-1" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-accent text-xl font-semibold text-white">{(firmName || "D").slice(0, 1).toUpperCase()}</span>
            )
          }
          onChange={(url) => {
            setLogo(url);
            onNotice("success", url ? "Logo saved." : "Logo removed.");
            router.refresh();
          }}
        />
        <div className="space-y-2">
          <p className="font-semibold text-text-main">Brand colour</p>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Use ${c}`}
                className={`h-7 w-7 rounded-full ring-offset-2 transition ${color === c ? "ring-2 ring-accent" : "hover:scale-110"}`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              aria-label="Custom colour"
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#0f172a"}
              onChange={(e) => setColor(e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-border bg-surface"
            />
          </div>
          <button type="button" onClick={saveColor} disabled={busy || color === saved} className={btn.secondary}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save colour
          </button>
        </div>
      </div>
    </section>
  );
}
