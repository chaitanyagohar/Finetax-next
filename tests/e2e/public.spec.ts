import { expect, test } from "@playwright/test";
import { cspErrors, watchErrors } from "./helpers";

// No account needed: these run against any build, including a local one.

test("login page loads with a per-request script nonce and no blocked scripts", async ({ page }) => {
  const errors = watchErrors(page);
  const response = await page.goto("/login", { waitUntil: "networkidle" });
  const csp = response?.headers()["content-security-policy"] || "";
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("'unsafe-inline' https://challenges");
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce, "the policy carries a nonce").toBeTruthy();

  const scriptNonces = await page.evaluate(() => Array.from(document.scripts).map((s) => s.nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((n) => n === nonce)).toBe(true);

  // The page is interactive, so React's scripts ran
  await page.locator("#email").fill("someone@example.com");
  await expect(page.locator("#email")).toHaveValue("someone@example.com");
  expect(cspErrors(errors)).toEqual([]);
});

test("each request gets a new nonce", async ({ request }) => {
  const a = (await request.get("/login")).headers()["content-security-policy"];
  const b = (await request.get("/login")).headers()["content-security-policy"];
  expect(a).not.toEqual(b);
});

test("security headers are set", async ({ request }) => {
  const headers = (await request.get("/login")).headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login\?redirect=%2Ftasks/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("API refuses signed-out requests", async ({ request, baseURL }) => {
  const res = await request.post("/api/invoices", { data: {}, headers: { origin: baseURL || "" } });
  expect([401, 403]).toContain(res.status());
  expect(res.headers()["content-security-policy"]).toContain("default-src 'none'");
});

test("the email webhook ignores a secret in the URL", async ({ request }) => {
  const res = await request.post("/api/webhooks/incoming-emails?token=guess", { data: {} });
  expect([401, 403, 500]).toContain(res.status());
});
