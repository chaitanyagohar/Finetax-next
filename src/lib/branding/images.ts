/** Checks and stores logos and profile photos in the public brand-assets bucket. SERVER ONLY. */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/guard";

export const BRAND_BUCKET = "brand-assets";
const MAX_BYTES = 2 * 1024 * 1024;

// The file's own first bytes decide its type, not the name or what the browser claims
function sniff(b: Buffer): { ext: string; type: string } | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", type: "image/png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}

export async function readImage(request: Request): Promise<{ bytes: Buffer; ext: string; type: string }> {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "Choose an image.");
  if (file.size <= 0 || file.size > MAX_BYTES) throw new ApiError(400, "Images can be up to 2 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) throw new ApiError(400, "Use a PNG, JPG or WebP image.");
  return { bytes, ...kind };
}

/** Uploads under folder/owner/, returns the public URL, and removes the previous file. */
export async function storeImage(
  admin: SupabaseClient,
  folder: "avatars" | "logos",
  ownerId: string,
  image: { bytes: Buffer; ext: string; type: string },
  previousUrl: string | null,
): Promise<string> {
  const path = `${folder}/${ownerId}/${randomUUID()}.${image.ext}`;
  const { error } = await admin.storage.from(BRAND_BUCKET).upload(path, image.bytes, { contentType: image.type, upsert: false, cacheControl: "31536000" });
  if (error) throw new ApiError(500, "The image could not be saved. Please try again.");
  await removeImage(admin, folder, ownerId, previousUrl);
  return admin.storage.from(BRAND_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function removeImage(admin: SupabaseClient, folder: string, ownerId: string, url: string | null) {
  const marker = `/${BRAND_BUCKET}/`;
  if (!url || !url.includes(marker)) return;
  const path = decodeURIComponent(url.slice(url.indexOf(marker) + marker.length).split("?")[0]);
  // Only ever delete inside this owner's own folder
  if (!path.startsWith(`${folder}/${ownerId}/`)) return;
  await admin.storage.from(BRAND_BUCKET).remove([path]);
}
