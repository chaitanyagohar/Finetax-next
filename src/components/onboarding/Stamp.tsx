"use client";

import { useId } from "react";

/** A violet office rubber stamp with a textured ink impression. It animates in when it appears. */
export default function Stamp({
  title,
  subtitle,
  date,
  size = "lg",
  className = "",
}: {
  title: string;
  subtitle?: string;
  date?: string;
  size?: "lg" | "sm";
  className?: string;
}) {
  const id = "ink-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const lg = size === "lg";
  return (
    <>
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.9 1.15" result="speckle" />
          <feComposite in="SourceGraphic" in2="speckle" operator="in" />
        </filter>
      </svg>
      <div
        className={`ob-stamp inline-block select-none text-center uppercase leading-none ${className}`}
        style={{
          filter: `url(#${id})`,
          color: "var(--ob-stamp)",
          fontFamily: "var(--font-stamp), 'Arial Narrow', 'Roboto Condensed', sans-serif",
          border: lg ? "5px double currentColor" : "3px double currentColor",
          borderRadius: lg ? 10 : 6,
          padding: lg ? "10px 18px 9px" : "3px 8px 3px",
        }}
        aria-hidden="true"
      >
        <div style={{ fontSize: lg ? 40 : 13, fontWeight: 700, letterSpacing: "0.04em" }}>{title}</div>
        {subtitle && <div style={{ fontSize: lg ? 15 : 7, fontWeight: 700, letterSpacing: "0.32em", marginTop: lg ? 6 : 2 }}>{subtitle}</div>}
        {date && (
          <div style={{ marginTop: lg ? 8 : 3, paddingTop: lg ? 6 : 2, borderTop: `${lg ? 2 : 1}px solid currentColor`, fontSize: lg ? 13 : 7, fontWeight: 700, letterSpacing: "0.2em" }}>
            {date}
          </div>
        )}
      </div>
    </>
  );
}