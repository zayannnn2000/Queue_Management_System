import { expect, test } from "@playwright/test";

// Runs only against a server started with a staff PIN: E2E_STAFF_PIN must equal that server's STAFF_PIN.
// It uses a fresh browser context (no sign-in from the other specs).
const PIN = process.env.E2E_STAFF_PIN;
test.skip(!PIN, "Set E2E_STAFF_PIN to the server's test PIN to run the sign-in tests.");

test("the front desk asks for the PIN; the display stays public", async ({ page }) => {
  // Staff pages and staff API are closed.
  await page.goto("/staff/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fstaff%2Fsettings/);
  await expect(page.getByRole("heading", { name: "Front desk sign-in" })).toBeVisible();
  expect((await page.request.get("/api/state")).status()).toBe(401);
  expect((await page.request.post("/api/action", { data: { type: "resetDay" } })).status()).toBe(401);

  // The public display and its data are open.
  expect((await page.request.get("/api/state?view=public")).status()).toBe(200);

  // A wrong PIN is refused with the tries left.
  await page.getByLabel("Staff PIN").fill("0000");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.locator("#pin-error")).toContainText("tries left");

  // The keypad works, the right PIN opens the page that was asked for.
  for (const digit of PIN!) await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).toHaveURL(/\/staff\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  expect((await page.request.get("/api/state")).status()).toBe(200);

  // Lock signs this device out again.
  await page.getByRole("button", { name: "Lock" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/state")).status()).toBe(401);
});

test("five wrong PINs lock sign-in for a while", async ({ request }) => {
  // A client address of its own, so this lock-out doesn't affect the other tests.
  const headers = { "x-real-ip": `203.0.113.${Math.floor(Math.random() * 200) + 1}` };
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    statuses.push((await request.post("/api/login", { data: { pin: "9999" }, headers })).status());
  }
  expect(statuses).toEqual([401, 401, 401, 401, 429]);
  // Even the right PIN is refused during the lock-out.
  const res = await request.post("/api/login", { data: { pin: PIN }, headers });
  expect(res.status()).toBe(429);
  expect((await res.json()).error).toContain("Try again in 5 minutes");
});
