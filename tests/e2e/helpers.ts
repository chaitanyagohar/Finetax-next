import { expect, type Page } from "@playwright/test";

/** Collects browser errors, including scripts refused by the Content Security Policy. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

export function cspErrors(errors: string[]): string[] {
  return errors.filter((e) => /Content Security Policy|Refused to (load|execute|connect|frame)/i.test(e));
}

export const credentials = {
  email: process.env.E2E_EMAIL || "",
  password: process.env.E2E_PASSWORD || "",
};

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(credentials.email);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  await expect(page.locator("body")).not.toContainText("Something went wrong");
}
