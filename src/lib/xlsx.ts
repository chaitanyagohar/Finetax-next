/**
 * Reads the first worksheet of an .xlsx file in the browser, as rows of text.
 * An .xlsx file is a ZIP of XML files; this reads the ZIP directory, inflates the two parts it
 * needs with the browser's own DecompressionStream, and parses them with DOMParser. No package needed.
 */

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zipEntries(buf: ArrayBuffer): Promise<Map<string, () => Promise<string>>> {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This is not a valid Excel (.xlsx) file.");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, () => Promise<string>>();
  const dec = new TextDecoder();
  for (let n = 0; n < count && u32(b, p) === 0x02014b50; n++) {
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    out.set(name, async () => {
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      const raw = b.subarray(start, start + size);
      return dec.decode(method === 0 ? raw : await inflate(raw));
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(file: File): Promise<string[][]> {
  const entries = await zipEntries(await file.arrayBuffer());
  const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");

  const shared: string[] = [];
  const sst = entries.get("xl/sharedStrings.xml");
  if (sst) {
    xml(await sst()).querySelectorAll("si").forEach((si) => {
      shared.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent || "").join(""));
    });
  }

  const sheetName = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error("No worksheet found in this file.");
  const sheet = xml(await entries.get(sheetName)!());

  const rows: string[][] = [];
  sheet.querySelectorAll("sheetData > row").forEach((row) => {
    const cells: string[] = [];
    row.querySelectorAll("c").forEach((c) => {
      const ref = c.getAttribute("r") || "";
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let text = v;
      if (type === "s") text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = Array.from(c.getElementsByTagName("t")).map((t) => t.textContent || "").join("");
      cells[ref ? colIndex(ref) : cells.length] = text;
    });
    rows.push(Array.from(cells, (x) => x ?? ""));
  });
  return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
}
