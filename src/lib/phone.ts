/** Indian mobile numbers in the international form wa.me and tel: links need ("9198…"), or null if not a usable number. */
export function toWhatsAppNumber(raw?: string | null): string | null {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = "91" + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}
