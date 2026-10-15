/** Shared password policy — used by browser pages and API routes. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72; // bcrypt limit

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
}

export interface PasswordStrength {
  score: number; // 0–4
  label: string;
  barClass: string;
  textClass: string;
}

export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "", barClass: "bg-border", textClass: "text-text-muted" };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  if (validatePassword(password)) score = Math.min(score, 1);

  if (score <= 1) return { score: 1, label: "Weak", barClass: "bg-rose-500", textClass: "text-rose-600" };
  if (score === 2) return { score: 2, label: "Fair", barClass: "bg-amber-500", textClass: "text-amber-600" };
  if (score === 3) return { score: 3, label: "Good", barClass: "bg-blue-500", textClass: "text-blue-600" };
  return { score: 4, label: "Strong", barClass: "bg-emerald-500", textClass: "text-emerald-600" };
}