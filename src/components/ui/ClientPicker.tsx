"use client";

import { useMemo, useState } from "react";
import Combobox, { type ComboOption } from "@/components/ui/Combobox";

export type PickerClient = {
  id: string;
  name: string;
  organization_name?: string | null;
  pan?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
};

/** "Kumar Traders Pvt Ltd — Ramesh Kumar" (organisation first). */
export function clientLabel(c?: Partial<PickerClient> | null): string {
  if (!c) return "";
  const org = String(c.organization_name || "").trim();
  const name = String(c.name || "").trim();
  if (org && name && org.toLowerCase() !== name.toLowerCase()) return `${org} — ${name}`;
  return org || name;
}

export function sortByLabel<T extends Partial<PickerClient>>(list: T[]): T[] {
  return [...list].sort((a, b) => clientLabel(a).localeCompare(clientLabel(b)));
}

interface Props {
  clients: PickerClient[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** When set, shows an option to clear the selection (e.g. "Internal / No client"). */
  noneLabel?: string;
  includeInactive?: boolean;
  /** Fixed choices listed above the clients, e.g. "Internal (no client)". */
  extraOptions?: ComboOption[];
  /** Smaller control for filter bars. */
  compact?: boolean;
  className?: string;
}

const MAX_SHOWN = 60;

export default function ClientPicker({
  clients,
  value,
  onChange,
  disabled,
  placeholder = "Type organisation, name, PAN, GSTIN or mobile…",
  noneLabel,
  includeInactive = false,
  extraOptions = [],
  compact,
  className,
}: Props) {
  const [query, setQuery] = useState("");

  const selected = clients.find((c) => String(c.id) === String(value));
  const selectedExtra = extraOptions.find((o) => o.id === value);

  const options: ComboOption[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const pool = clients.filter(
      (c) => c.status !== "Merged" && (includeInactive || c.status !== "Inactive" || String(c.id) === String(value))
    );
    const matched = !q
      ? pool
      : pool.filter((c) => {
          const hay = [c.organization_name, c.name, c.pan, c.gstin, c.email].filter(Boolean).join(" ").toLowerCase();
          if (hay.includes(q)) return true;
          return digits.length >= 4 && String(c.phone || "").replace(/\D/g, "").includes(digits);
        });
    const extras = extraOptions.filter((o) => !q || o.label.toLowerCase().includes(q));
    return extras.concat(
      sortByLabel(matched)
        .slice(0, MAX_SHOWN)
        .map((c) => ({
          id: String(c.id),
          label: c.organization_name || c.name,
          detail: [c.organization_name ? c.name : null, c.gstin || c.pan, c.phone, c.status === "Inactive" ? "Inactive" : null]
            .filter(Boolean)
            .join(" · "),
        }))
    );
  }, [clients, query, includeInactive, value, extraOptions]);

  return (
    <Combobox
      value={value}
      onChange={onChange}
      selectedLabel={selectedExtra?.label ?? clientLabel(selected)}
      options={options}
      onQueryChange={setQuery}
      disabled={disabled}
      emptyLabel="— Select client —"
      noneLabel={noneLabel}
      searchPlaceholder={placeholder}
      noMatchText={(q) => `No clients match "${q}".`}
      compact={compact}
      className={className}
    />
  );
}
