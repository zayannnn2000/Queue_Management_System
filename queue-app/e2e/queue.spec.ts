import { type Page, expect, test } from "@playwright/test";

// Fictional names only.

test.beforeEach(async ({ request }) => {
  const res = await request.post("/api/action", { data: { type: "resetDay" } });
  expect(res.ok()).toBeTruthy();
});

const counter = (page: Page) => page.getByRole("article", { name: "Counter 1" });

async function addWalkIn(page: Page, name: string) {
  await page.getByRole("button", { name: "Walk-in", exact: true }).click();
  await page.getByLabel("Patient name").fill(name);
  await page.getByRole("button", { name: "Add walk-in" }).click();
  await expect(page.getByRole("status").getByText(`added for ${name}`)).toBeVisible();
}

test("full staff flow: add, book, check in, call next, serve, no-show", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("/staff");
  await expect(page.getByRole("heading", { level: 1, name: "Front desk" })).toBeVisible();

  // Add a walk-in: W-001 is issued and joins the waiting list at position 1.
  await addWalkIn(page, "Tarek Mahmud");
  await expect(page.getByText("In the queue. Give the patient this token.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Waiting" }).getByRole("cell", { name: "W-001", exact: true })).toBeVisible();

  // Book an appointment for the first free slot: A-001, not queued yet.
  await page.getByRole("button", { name: "Appointment", exact: true }).click();
  await page.getByLabel("Patient name").fill("Sumaiya Karim");
  await page.getByRole("button", { name: "Book appointment" }).click();
  await expect(page.getByRole("status").getByText(/A-001 booked/)).toBeVisible();

  // Check in from the booked list.
  await page.getByRole("button", { name: /Booked, not arrived/ }).click();
  await page.getByRole("button", { name: "Check in A-001" }).click();
  await expect(page.getByRole("status").getByText(/A-001 checked in/)).toBeVisible();

  // Call next: the walk-in is due now; the appointment's slot is still ahead.
  await page.getByRole("button", { name: /Waiting/ }).click();
  await counter(page).getByRole("button", { name: "Call next" }).click();
  await expect(counter(page).getByText("W-001", { exact: true })).toBeVisible();
  await expect(counter(page).getByText(/earliest due target/)).toBeVisible();

  // Served & call next: nobody else is due, so the early appointment is called (idle-fill).
  await counter(page).getByRole("button", { name: "Served & call next" }).click();
  await expect(counter(page).getByText("A-001", { exact: true })).toBeVisible();
  await expect(counter(page).getByText(/called early/)).toBeVisible();

  // A new walk-in arrives; the appointment doesn't come to the counter: no-show.
  await addWalkIn(page, "Rakib Hasan");
  await counter(page).getByRole("button", { name: "No-show" }).click();
  await expect(counter(page).getByText(/Next up:/)).toContainText("W-002");

  // Call and serve W-002.
  await counter(page).getByRole("button", { name: "Call next" }).click();
  await expect(counter(page).getByText("W-002", { exact: true })).toBeVisible();
  // Last patient: nobody to call next, so only Served and No-show remain.
  await expect(counter(page).getByRole("button", { name: "Served & call next" })).toHaveCount(0);
  await expect(counter(page).getByRole("button", { name: "No-show" })).toBeVisible();
  await counter(page).getByRole("button", { name: "Served", exact: true }).click();
  await expect(counter(page).getByText(/Nobody is checked in/)).toBeVisible();

  // Finished list: two served, one no-show.
  await page.getByRole("button", { name: /Finished today/ }).click();
  const finished = page.getByRole("region", { name: "Finished today" });
  await expect(finished.getByText("Served", { exact: true })).toHaveCount(2);
  await expect(finished.getByText("No-show", { exact: true })).toHaveCount(1);
});

test("prints a token slip for a walk-in and for a checked-in appointment", async ({ page, request }) => {
  // Replace the print dialog with a probe that records the slip on the page at print time.
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: string[] };
    w.__printed = [];
    window.print = () => {
      w.__printed.push(document.getElementById("print-slip")?.innerText ?? "");
    };
  });
  const printed = () => page.evaluate(() => (window as unknown as { __printed: string[] }).__printed);

  await page.goto("/staff");
  await addWalkIn(page, "Mahbub Alam");
  await page.getByRole("button", { name: "Print token", exact: true }).click();
  await expect.poll(async () => (await printed()).length).toBe(1);
  const walkInSlip = (await printed())[0];
  expect(walkInSlip).toContain("W-001");
  expect(walkInSlip).toContain("Walk-in");
  expect(walkInSlip).toContain("Place in line");
  expect(walkInSlip).not.toContain("Mahbub"); // the slip carries no name
  await expect(page.locator("#print-slip")).toHaveCount(0); // removed after printing

  // A booked appointment gets its slip at check-in.
  // Take the first free slot the form offers (always today, even close to midnight).
  await page.getByRole("button", { name: "Appointment", exact: true }).click();
  const scheduledAt = Number(await page.getByLabel("Time today").inputValue());
  const booked = await request.post("/api/action", {
    data: { type: "book", name: "Nusrat Jahan", service: "follow_up", scheduledAt },
  });
  expect(booked.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: /Booked, not arrived/ }).click();
  await page.getByRole("button", { name: "Check in A-001" }).click();
  await page.getByRole("button", { name: "Print token", exact: true }).click();
  await expect.poll(async () => (await printed()).length).toBe(1); // counter resets on reload
  expect((await printed())[0]).toContain("A-001");
  expect((await printed())[0]).toContain("Appointment");

  // Reprint from the waiting list.
  await page.getByRole("button", { name: /Waiting/ }).click();
  await page.getByRole("button", { name: "Print token W-001" }).click();
  await expect.poll(async () => (await printed()).length).toBe(2);
  expect((await printed())[1]).toContain("W-001");
});

test("double-booking is refused and the slot shows as full", async ({ page, request }) => {
  await page.goto("/staff");
  await page.getByRole("button", { name: "Appointment", exact: true }).click();
  const time = page.getByLabel("Time today");
  const firstSlot = Number(await time.inputValue());
  const res = await request.post("/api/action", {
    data: { type: "book", name: "Nadia Ahmed", service: "consultation", scheduledAt: firstSlot },
  });
  expect(res.ok()).toBeTruthy();
  const clash = await request.post("/api/action", {
    data: { type: "book", name: "Omar Sani", service: "consultation", scheduledAt: firstSlot },
  });
  expect(clash.status()).toBe(400);
  expect((await clash.json()).error).toContain("clashes with A-001");

  // After the next poll the form greys the taken slot out.
  await expect(time.locator(`option[value="${firstSlot}"]`)).toBeDisabled({ timeout: 8_000 });
});

test("/display reflects every staff change", async ({ page, context }) => {
  page.on("dialog", (d) => d.accept());
  const display = await context.newPage();
  await display.goto("/display?token=W-002");
  await expect(display.getByRole("heading", { level: 1 })).toContainText("Hygieia Wellness Clinic");
  await expect(display.getByText(/isn't waiting right now/)).toBeVisible();

  await page.goto("/staff");
  await addWalkIn(page, "Jannat Ara");
  await addWalkIn(page, "Fahad Rahman");

  // Display picks up both walk-ins (polls every 3 s), initials only.
  const waiting = display.getByRole("region", { name: "Waiting" });
  await expect(waiting.getByText("W-001")).toBeVisible();
  await expect(waiting.getByText("J.")).toBeVisible();
  await expect(display.getByText("Jannat Ara")).toHaveCount(0);
  await expect(display.getByText(/You are number 2 in line/)).toBeVisible();

  // Call next: W-001 moves to now serving, W-002 becomes number 1.
  await counter(page).getByRole("button", { name: "Call next" }).click();
  const serving = display.getByRole("region", { name: "Now serving" });
  await expect(serving.getByText("W-001")).toBeVisible();
  await expect(display.getByText(/You are number 1 in line/)).toBeVisible();

  // Served & call next: W-002 is called, and the highlighted patient is told where to go.
  await counter(page).getByRole("button", { name: "Served & call next" }).click();
  await expect(display.getByText(/It's your turn. Please go to counter 1/)).toBeVisible();
  await expect(serving.getByText("W-002")).toBeVisible();

  // No-show clears the counter on the display.
  await counter(page).getByRole("button", { name: "No-show" }).click();
  await expect(serving.getByText("Free")).toBeVisible();
});
