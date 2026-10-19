"use client";

import Link from "next/link";
import React from "react";

/** Renders **bold**, `code`, [internal links](/path), numbered and bullet lists. No HTML is ever injected. */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\(\/[^)\s]*\)|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={`${keyBase}-${i++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={`${keyBase}-${i++}`} className="rounded bg-surface-alt px-1 text-[0.9em]">
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      const mm = tok.match(/^\[([^\]]+)\]\((\/[^)\s]*)\)$/);
      if (mm) {
        out.push(
          <Link key={`${keyBase}-${i++}`} href={mm[2]} className="font-semibold text-navy underline">
            {mm[1]}
          </Link>
        );
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function RichText({ text }: { text: string }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let listOrdered: boolean | null = null;
  let listItems: string[] = [];

  const flush = () => {
    if (listOrdered === null) return;
    const items = listItems;
    const key = `l${blocks.length}`;
    blocks.push(
      listOrdered ? (
        <ol key={key} className="list-decimal space-y-1 pl-5">
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `${key}-${idx}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="list-disc space-y-1 pl-5">
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `${key}-${idx}`)}</li>
          ))}
        </ul>
      )
    );
    listOrdered = null;
    listItems = [];
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trimEnd();
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    if (ol) {
      if (listOrdered !== true) {
        flush();
        listOrdered = true;
      }
      listItems.push(ol[1]);
      continue;
    }
    if (ul) {
      if (listOrdered !== false) {
        flush();
        listOrdered = false;
      }
      listItems.push(ul[1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      <p key={`p${idx}`} className={h ? "font-bold text-text-main" : undefined}>
        {inline(h ? h[1] : line, `p${idx}`)}
      </p>
    );
  }
  flush();

  return <div className="space-y-2 leading-relaxed">{blocks}</div>;
}