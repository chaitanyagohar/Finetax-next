/** Blocks mail connections to private or internal addresses. SERVER ONLY. */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ApiError } from "@/lib/api/guard";

const SMTP_PORTS = [25, 465, 587, 2525];
const IMAP_PORTS = [993];

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

/** Throws unless host:port is a public mail server on a normal mail port. */
export async function assertPublicMailHost(host: string, port: number, kind: "smtp" | "imap"): Promise<void> {
  const h = String(host || "").trim().toLowerCase();
  const ports = kind === "smtp" ? SMTP_PORTS : IMAP_PORTS;
  if (!ports.includes(Number(port))) {
    throw new ApiError(400, `Port ${port} isn't allowed for ${kind.toUpperCase()}. Use ${ports.join(" or ")}.`);
  }
  if (!h || h === "localhost" || /\.(local|internal|localhost)$/.test(h)) {
    throw new ApiError(400, "That mail server address isn't allowed.");
  }
  let addresses: string[];
  try {
    addresses = isIP(h) ? [h] : (await lookup(h, { all: true })).map((a) => a.address);
  } catch {
    throw new ApiError(400, `Could not find the mail server ${h}.`);
  }
  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new ApiError(400, "That mail server address isn't allowed.");
  }
}