"use client";

import { MessageCircle, Phone } from "lucide-react";
import { toWhatsAppNumber } from "@/lib/phone";

/** Tap-to-call and WhatsApp links for a client's mobile number; renders nothing without a usable number. */
export default function ClientContact({ phone, className = "" }: { phone?: string | null; className?: string }) {
  const number = toWhatsAppNumber(phone);
  if (!number) return null;
  const shown = String(phone).trim();
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <a
        href={`tel:+${number}`}
        onClick={(e) => e.stopPropagation()}
        title={`Call ${shown}`}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-navy transition hover:bg-navy/5"
      >
        <Phone className="h-3 w-3" /> {shown}
      </a>
      <a
        href={`https://wa.me/${number}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title="Open in WhatsApp"
        aria-label={`WhatsApp ${shown}`}
        className="inline-flex items-center rounded-md p-1 text-emerald-600 transition hover:bg-emerald-50"
      >
        <MessageCircle className="h-3.5 w-3.5" />
      </a>
    </span>
  );
}
