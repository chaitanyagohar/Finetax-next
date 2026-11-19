import { expect, test } from "@playwright/test";
import { credentials, cspErrors, signIn, watchErrors } from "./helpers";

// Needs E2E_EMAIL and E2E_PASSWORD for an administrator of a TEST firm. Read-only: nothing is created or changed.
test.skip(!credentials.email || !credentials.password, "Set E2E_EMAIL and E2E_PASSWORD to run the signed-in checks");

const PAGES = [
  "/",
  "/my-day",
  "/inbox",
  "/clients",
  "/leads",
  "/quotations",
  "/client-discussions",
  "/tasks",
  "/calendar",
  "/time-tracking",
  "/performance",
  "/documents",
  "/invoices",
  "/insights",
  "/reviewer-queue",
  "/team",
  "/organisation",
  "/attendance",
  "/plan",
  "/packages",
  "/settings",
  "/help",
];

test("every main page opens without errors or blocked scripts", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  for (const path of PAGES) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page, `${path} should not send you back to login`).not.toHaveURL(/\/login/);
    await expect(page.locator("body"), `${path} should render`).not.toContainText("Application error");
  }
  expect(cspErrors(errors), "scripts refused by the security policy").toEqual([]);
});

test("dashboard shows the totals worked out by the database", async ({ page }) => {
  await signIn(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByText("Receivables (balance due)")).toBeVisible();
  await expect(page.getByText(/of the amount billed in this period/)).toBeVisible();
});

test("tasks page offers older completed tasks", async ({ page }) => {
  await signIn(page);
  await page.goto("/tasks", { waitUntil: "networkidle" });
  await expect(page.getByText(/Completed tasks from the last 90 days are shown/)).toBeVisible();
  await page.getByRole("button", { name: "Show all completed tasks" }).click();
  await expect(page.getByText(/Completed tasks from the last 90 days are shown/)).toBeHidden();
});

test("manual time entry opens", async ({ page }) => {
  await signIn(page);
  await page.goto("/time-tracking", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Manual entry/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("inbox attachment search looks beyond the latest files", async ({ page }) => {
  await signIn(page);
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const compose = page.getByRole("button", { name: /^(Compose|New message)$/ }).filter({ visible: true }).first();
  test.skip(await compose.isDisabled(), "No mailbox connected in this firm");
  await compose.click();
  await page.getByTitle("Attach an invoice, quotation or vault document").click();
  await expect(page.getByPlaceholder("Search all invoices, quotations and documents")).toBeVisible();
});

test("dialogs close with Escape and return focus", async ({ page }) => {
  await signIn(page);
  await page.goto("/clients", { waitUntil: "networkidle" });
  const add = page.getByRole("button", { name: "Add client" });
  await add.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(add).toBeFocused();
});

test("Ctrl+K finds records and actions", async ({ page }) => {
  await signIn(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.keyboard.press("Control+k");
  const box = page.getByRole("dialog", { name: "Search and actions" });
  await expect(box).toBeVisible();
  await box.locator("input").fill("new inv");
  await expect(box.getByRole("option", { name: /New invoice/ })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("attendance tabs and branches open for an administrator", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto("/attendance?tab=team");
  await expect(page.getByRole("main").getByRole("heading", { name: "Attendance" })).toBeVisible();
  for (const tab of ["Workload", "Holidays and rules", "My attendance"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
  }
  await page.goto("/organisation");
  await page.getByRole("button", { name: "Roles", exact: true }).click();
  await expect(page.getByRole("main").getByRole("heading", { name: "Branches and roles" })).toBeVisible();
  expect(errors.filter((e) => !/websocket|realtime/i.test(e))).toEqual([]);
});
