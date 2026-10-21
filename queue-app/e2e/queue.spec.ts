import { type Page, expect, test } from "@playwright/test";

// Fictional names only.

// When the server has a staff PIN, sign the browser context in first (E2E_STAFF_PIN is a test PIN).
// API calls go through page.request so they share the signed-in cookie.
test.beforeEach(async ({ page }) => {
  const pin = process.env.E2E_STAFF_PIN;
  if (pin) expect((await page.request.post("/api/login", { data: { pin } })).ok()).toBeTruthy();
  const res = await page.request.post("/api/action", { data: { type: "resetDay" } });
  expect(res.ok()).toBeTruthy();
});

const room = (page: Page, name = "General consultation · Room 1") => page.getByRole("group", { name });
/** Opens a room pill's details (patient, times, reason, No-show). */
async function openRoom(page: Page, name = "General consultation · Room 1") {
  const toggle = room(page, name).getByRole("button", { expanded: false });
  if (await toggle.count()) await toggle.click();
}
const waitingList = (page: Page) => page.getByRole("region", { name: "Waiting" });

async function addWalkIn(page: Page, name: string, service = "consultation") {
  await page.getByRole("button", { name: "Walk-in", exact: true }).click();
  await page.getByLabel("Patient name").fill(name);
  await page.getByLabel("Service", { exact: true }).selectOption(service);
  await page.getByRole("button", { name: "Add walk-in" }).click();
  await expect(page.getByRole("status").getByText(`added for ${name}`)).toBeVisible();
}

/** A slot at least 20 minutes ahead, so the appointment isn't due during the test. */
async function laterSlot(page: Page): Promise<number> {
  await page.getByRole("button", { name: "Appointment", exact: true }).click();
  const values = await page.getByLabel("Time today").locator("option:not([disabled])").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  return Number(values[Math.min(4, values.length - 1)]);
}

test("full staff flow in one service: add, book, check in, call next, serve, no-show", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.goto("/staff");
  await expect(page.getByRole("heading", { level: 1, name: "Front desk" })).toBeVisible();

  // A consultation walk-in gets CW-001 and joins the Consultation queue at position 1.
  await addWalkIn(page, "Tarek Mahmud");
  await expect(page.getByText("In the queue. Give the patient this token.")).toBeVisible();
  await expect(waitingList(page).getByRole("cell", { name: "CW-001", exact: true })).toBeVisible();

  // Book a consultation appointment 20+ minutes ahead: CA-001, not queued yet.
  const slot = await laterSlot(page);
  await page.getByLabel("Patient name").fill("Sumaiya Karim");
  await page.getByLabel("Time today").selectOption(String(slot));
  await page.getByRole("button", { name: "Book appointment" }).click();
  await expect(page.getByRole("status").getByText(/CA-001 booked/)).toBeVisible();

  // Check in from the booked list; the booking note goes.
  await page.getByRole("button", { name: "Check in CA-001" }).click();
  await expect(page.getByRole("status").getByText(/CA-001 checked in/)).toBeVisible();
  await expect(page.getByText("Appointment booked. Quote this token to the patient.")).toHaveCount(0);

  // Call next: the walk-in is due; the appointment's time hasn't come yet.
  await room(page).getByRole("button", { name: "Call next" }).click();
  await expect(room(page).getByText("CW-001", { exact: true }).first()).toBeVisible();
  await openRoom(page);
  await expect(room(page).getByText(/the earliest due/)).toBeVisible();

  // Served & call next: nobody else is due, so the early appointment is called (idle-fill).
  await room(page).getByRole("button", { name: "Served & call next" }).click();
  await expect(room(page).getByText("CA-001", { exact: true }).first()).toBeVisible();
  await openRoom(page);
  await expect(room(page).getByText(/called early/)).toBeVisible();

  // A new walk-in arrives; the appointment doesn't come in: no-show.
  await addWalkIn(page, "Rakib Hasan");
  await openRoom(page);
  await room(page).getByRole("button", { name: "No-show" }).click();
  await expect(room(page)).toContainText("next CW-002");

  // Call and serve the last patient: only Served and No-show are offered.
  await room(page).getByRole("button", { name: "Call next" }).click();
  await expect(room(page).getByText("CW-002", { exact: true }).first()).toBeVisible();
  await expect(room(page).getByRole("button", { name: "Served & call next" })).toHaveCount(0);
  await room(page).getByRole("button", { name: "Served", exact: true }).first().click();
  await expect(room(page)).toContainText("Free · 0 waiting");

  await page.getByRole("region", { name: "Finished today" }).getByRole("button", { name: "Show" }).click();
  const finished = page.getByRole("region", { name: "Finished today" });
  await expect(finished.getByText("Served", { exact: true })).toHaveCount(2);
  await expect(finished.getByText("No-show", { exact: true })).toHaveCount(1);
});

test("separate queues per service, staff priority and call now", async ({ page }) => {
  await page.goto("/staff");
  await addWalkIn(page, "Ayesha Rahman");
  await addWalkIn(page, "Bilal Hossain");
  await addWalkIn(page, "Chandra Das");
  await addWalkIn(page, "Eva Biswas", "blood_test");
  await expect(waitingList(page).getByRole("cell", { name: "BW-001", exact: true })).toBeVisible();

  // Flag CW-003 as priority: they're next in Consultation, with the reason shown.
  await waitingList(page).getByLabel("Priority for CW-003").selectOption("Elderly");
  await expect(waitingList(page).getByText("Priority · Elderly")).toBeVisible();
  await room(page).getByRole("button", { name: "Call next" }).click();
  await expect(room(page).getByText("CW-003", { exact: true }).first()).toBeVisible();
  await openRoom(page);
  await expect(room(page).getByText(/priority \(Elderly\)/)).toBeVisible();
  await page.keyboard.press("Escape");

  // The Blood test room calls from its own queue, unaffected by the consultations.
  const blood = room(page, "Blood test · Room 1");
  await blood.getByRole("button", { name: "Call next" }).click();
  await expect(blood.getByText("BW-001", { exact: true }).first()).toBeVisible();

  // Call now: once the consultation room is free, staff pick CW-002 out of order.
  await openRoom(page);
  await room(page).getByRole("button", { name: "Served", exact: true }).first().click();
  await waitingList(page).getByRole("button", { name: "Call now CW-002" }).click();
  await expect(room(page).getByText("CW-002", { exact: true }).first()).toBeVisible();
  await openRoom(page);
  await expect(room(page).getByText("CW-002 called by staff (Call now).")).toBeVisible();
});

test("prints a token slip for a walk-in and for a checked-in appointment", async ({ page }) => {
  const request = page.request;
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
  const slip = (await printed())[0];
  for (const text of ["CW-001", "Walk-in", "General consultation", "Room 1", "Place in queue"]) expect(slip).toContain(text);
  expect(slip).not.toContain("Mahbub"); // the slip carries no name
  await expect(page.locator("#print-slip")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Print token", exact: true })).toHaveCount(0);

  // A follow-up appointment gets its slip at check-in.
  const scheduledAt = await laterSlot(page);
  const booked = await request.post("/api/action", {
    data: { type: "book", name: "Nusrat Jahan", service: "follow_up", scheduledAt },
  });
  expect(booked.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "Check in FA-001" }).click();
  await page.getByRole("button", { name: "Print token", exact: true }).click();
  await expect.poll(async () => (await printed()).length).toBe(1); // counter resets on reload
  expect((await printed())[0]).toContain("FA-001");
  expect((await printed())[0]).toContain("Follow-up");

  // Reprint from the waiting list.
  await page.getByRole("button", { name: "Print token CW-001" }).click();
  await expect.poll(async () => (await printed()).length).toBe(2);
  expect((await printed())[1]).toContain("CW-001");
});

test("double-booking within a service is refused and the slot shows as full", async ({ page }) => {
  const request = page.request;
  await page.goto("/staff");
  await page.getByRole("button", { name: "Appointment", exact: true }).click();
  const time = page.getByLabel("Time today");
  const firstSlot = Number(await time.inputValue());
  expect((await request.post("/api/action", { data: { type: "book", name: "Nadia Ahmed", service: "consultation", scheduledAt: firstSlot } })).ok()).toBeTruthy();
  const clash = await request.post("/api/action", {
    data: { type: "book", name: "Omar Sani", service: "consultation", scheduledAt: firstSlot },
  });
  expect(clash.status()).toBe(400);
  expect((await clash.json()).error).toContain("clashes with CA-001");
  // The time is marked full for Consultation, and booking it there is blocked in the form.
  const option = time.locator(`option[value="${firstSlot}"]`);
  await expect(option).toContainText("full for General consultation", { timeout: 8_000 });
  await time.selectOption(String(firstSlot));
  await expect(page.getByText("General consultation is full at this time")).toBeVisible();
  await expect(page.getByRole("button", { name: "Book appointment" })).toBeDisabled();
});

test("appointments of different services can share the same time, in any order", async ({ page }) => {
  await page.goto("/staff");
  const slot = String(await laterSlot(page));
  const time = page.getByLabel("Time today");
  const service = page.getByLabel("Service", { exact: true });
  const book = async (name: string) => {
    await page.getByLabel("Patient name").fill(name);
    await page.getByRole("button", { name: "Book appointment" }).click();
    await expect(page.getByRole("status").getByText(new RegExp(`booked for ${name}`))).toBeVisible();
  };

  await time.selectOption(slot);
  await book("Nadia Ahmed"); // CA-001 (consultation)

  // Service first, then the same time.
  await service.selectOption("blood_test");
  await time.selectOption(slot);
  await book("Omar Sani");
  await expect(page.getByRole("status")).toContainText("BA-001");

  // Time first while Consultation (full) is selected, then the service: the time is kept.
  await service.selectOption("consultation");
  await time.selectOption(slot);
  await expect(page.getByRole("button", { name: "Book appointment" })).toBeDisabled();
  await service.selectOption("vaccination");
  await expect(time).toHaveValue(slot);
  await book("Lamia Chowdhury");
  await expect(page.getByRole("status")).toContainText("VA-001");
});

test("a service added in Settings gets its own queue, tokens, room and display panel", async ({ page, context }) => {
  page.on("dialog", (d) => d.accept());
  // Reset day keeps settings, so make sure no Dental is left over from an earlier run, and clean up after.
  await page.request.post("/api/action", { data: { type: "removeService", id: "dental" } });
  try {
    await page.goto("/staff/settings");
    const card = page.getByRole("form", { name: "Add a service" });
    await card.getByLabel("Name").fill("Dental");
    await expect(card.getByLabel("Letter")).toHaveValue("D");
    await card.getByLabel("Minutes").fill("20");
    await card.getByRole("button", { name: "Add service" }).click();
    await expect(page.getByRole("status").getByText(/Dental added: tokens DW-001/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Services" })).toContainText("Dental");

    // A letter already in use is refused with the reason.
    await card.getByLabel("Name").fill("Dermatology");
    await card.getByLabel("Letter").fill("D");
    await card.getByRole("button", { name: "Add service" }).click();
    await expect(card.getByRole("alert")).toContainText("Dental already uses the letter D");

    await page.goto("/staff");
    await addWalkIn(page, "Rubina Yasmin", "dental");
    await expect(waitingList(page).getByRole("cell", { name: "DW-001", exact: true })).toBeVisible();
    const dental = room(page, "Dental · Room 1");
    await dental.getByRole("button", { name: "Call next" }).click();
    await expect(dental.getByText("DW-001", { exact: true }).first()).toBeVisible();

    const display = await context.newPage();
    await display.goto("/display");
    await expect(display.getByRole("region", { name: "Dental" }).getByText("DW-001")).toBeVisible();

    // Removal waits until nobody is being seen for it.
    await page.goto("/staff/settings");
    await page.getByRole("button", { name: "Remove Dental" }).click();
    await expect(page.getByRole("status")).toContainText("Dental still has patients today (DW-001)");
    await page.goto("/staff");
    await room(page, "Dental · Room 1").getByRole("button", { name: "Served", exact: true }).first().click();
    await page.goto("/staff/settings");
    await page.getByRole("button", { name: "Remove Dental" }).click();
    await expect(page.getByRole("status")).toContainText("Dental removed");
    await expect(page.getByRole("list", { name: "Services" })).not.toContainText("Dental");
  } finally {
    await page.request.post("/api/action", { data: { type: "removeService", id: "dental" } });
  }
});

test("/display shows each queue and follows every staff change", async ({ page, context }) => {
  page.on("dialog", (d) => d.accept());
  const display = await context.newPage();
  await display.goto("/display?token=CW-002");
  await expect(display.getByRole("heading", { level: 1 })).toContainText("Hygieia Wellness Clinic");
  await expect(display.getByText(/isn't waiting right now/)).toBeVisible();

  await page.goto("/staff");
  await addWalkIn(page, "Jannat Ara");
  await addWalkIn(page, "Fahad Rahman");

  const consult = display.getByRole("region", { name: "General consultation" });
  await expect(consult.getByText("CW-001")).toBeVisible();
  await expect(consult.getByText("J.")).toBeVisible();
  await expect(display.getByText("Jannat Ara")).toHaveCount(0);
  await expect(display.getByText(/You are number 2 in the General consultation queue/)).toBeVisible();

  await room(page).getByRole("button", { name: "Call next" }).click();
  await expect(display.getByText(/You are number 1 in the General consultation queue/)).toBeVisible();

  await room(page).getByRole("button", { name: "Served & call next" }).click();
  await expect(display.getByText(/It's your turn. Please go to General consultation · Room 1/)).toBeVisible();

  await openRoom(page);
  await room(page).getByRole("button", { name: "No-show" }).click();
  await expect(consult.getByText("Free")).toBeVisible();
});
