"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/format";

// Initials keep the same colour for the same person everywhere
const TONES = ["#f2613f", "#0ea5e9", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899", "#14b8a6", "#6366f1"];
function toneFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

const SIZES = { xs: "h-5 w-5 text-[8px]", sm: "h-7 w-7 text-[10px]", md: "h-9 w-9 text-xs", lg: "h-14 w-14 text-base", xl: "h-20 w-20 text-xl" };

export default function Avatar({
  name,
  url,
  seed,
  size = "md",
  className = "",
}: {
  name: string | null | undefined;
  url?: string | null;
  seed?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const label = name || "?";
  const cls = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ring-2 ring-surface ${SIZES[size]} ${className}`;
  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={label} title={label} className={`${cls} object-cover`} onError={() => setBroken(true)} loading="lazy" />;
  }
  return (
    <span className={cls} style={{ backgroundColor: toneFor(seed || label) }} title={label} aria-label={label}>
      {getInitials(label)}
    </span>
  );
}

/* Photos of everyone in the firm, loaded once per page visit and shared by every list */
let cache: Promise<Record<string, string | null>> | null = null;

export function usePeoplePhotos(): Record<string, string | null> {
  const [map, setMap] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let cancelled = false;
    if (!cache) {
      cache = (async () => {
        const { data } = await createClient().from("profiles").select("id, avatar_url").not("avatar_url", "is", null);
        return Object.fromEntries((data || []).map((p) => [p.id as string, p.avatar_url as string | null]));
      })();
    }
    cache.then((m) => !cancelled && setMap(m));
    return () => {
      cancelled = true;
    };
  }, []);
  return map;
}

/** Called after someone changes their photo, so the next lookup fetches again. */
export function forgetPeoplePhotos() {
  cache = null;
}

/** A team member's photo (or coloured initials), looked up by their id. */
export function PersonAvatar({ id, name, size = "sm", className = "" }: { id: string | null | undefined; name: string | null | undefined; size?: keyof typeof SIZES; className?: string }) {
  const photos = usePeoplePhotos();
  return <Avatar name={name} url={id ? photos[id] : null} seed={id || name} size={size} className={className} />;
}
