/**
 * GST state codes, GSTIN and PAN formats, and the place-of-supply default.
 * The database applies the same rules in gst_state_code() and gst_place_of_supply()
 * (migration 041); keep the two lists in step.
 */

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const GST_STATES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman & Diu", "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra",
  "28": "Andhra Pradesh (old)", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "97": "Other Territory",
};

// Codes still found in old GSTINs, and the code that replaced each
const SUPERSEDED_CODES: Record<string, string> = { "25": "26", "28": "37" };

const STATE_ALIASES: Record<string, string> = {
  nctofdelhi: "07", newdelhi: "07", orissa: "21", pondicherry: "34", uttaranchal: "05", chattisgarh: "22",
  jammukashmir: "01", andamanandnicobar: "35", dadraandnagarhaveli: "26", damananddiu: "26",
};

export interface StateOption {
  code: string;
  name: string;
}

/** States a user can choose today, sorted by name. */
export const STATE_OPTIONS: StateOption[] = Object.entries(GST_STATES)
  .filter(([code]) => !SUPERSEDED_CODES[code])
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const stateKey = (value: string) => value.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");

const CODE_BY_NAME: Record<string, string> = {
  ...Object.fromEntries(STATE_OPTIONS.map((s) => [stateKey(s.name), s.code])),
  ...STATE_ALIASES,
};

export function stateName(code?: string | null): string {
  return (code && GST_STATES[code]) || "";
}

/** State code for a state name as typed ("Delhi", "NCT of Delhi") or a two-digit code. */
export function stateCodeFromName(value?: string | null): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^[0-9]{2}$/.test(text)) return GST_STATES[text] ? SUPERSEDED_CODES[text] || text : null;
  return CODE_BY_NAME[stateKey(text)] || null;
}

export function stateCodeFromGstin(gstin?: string | null): string | null {
  const value = String(gstin || "").trim().toUpperCase();
  if (!GSTIN_RE.test(value)) return null;
  const code = value.slice(0, 2);
  return GST_STATES[code] ? SUPERSEDED_CODES[code] || code : null;
}

/** Default place of supply for a client: the GSTIN's state, otherwise the state on record. */
export function placeOfSupplyCode(gstin?: string | null, state?: string | null): string | null {
  return stateCodeFromGstin(gstin) || stateCodeFromName(state);
}

export function placeOfSupplyLabel(code?: string | null): string {
  const name = stateName(code);
  return name ? `${name} (${code})` : "";
}
