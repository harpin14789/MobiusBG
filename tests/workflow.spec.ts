import { expect, test } from "@playwright/test";

test("reserve, submit delivery, receive partial quantity, and record payment", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Reserve units" }).first().click();
  const modal = page.getByRole("dialog", { name: "Reserve your units" });
  await modal.getByLabel("Quantity").fill("2");
  await expect(modal.locator(".total")).toContainText("$510.00");
  await modal.getByRole("button", { name: "Confirm reservation" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("$510.00");
  await page.reload();
  await page
    .getByRole("button", { name: "My reservations", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toContainText("2 units");
  await page.getByRole("button", { name: "Add delivery" }).click();
  await page.getByLabel("Delivery method").selectOption("Local drop-off");
  await page.getByLabel('Name on payment account').fill('Test Member');
  await page.getByLabel('Product UPC',{exact:true}).fill('195133197656');
  await page.getByLabel('Destination address',{exact:true}).selectOption('Blue Ocean Dropoff');
  await page
    .getByLabel("Tracking number or drop-off reference")
    .fill("North warehouse, Nov 15");
  await page.getByRole("button", { name: "Save delivery details" }).click();
  await expect(page.locator("tbody tr")).toContainText("Local drop-off");
  await page.getByRole("button", { name: "Switch to admin" }).click();
  await page.getByRole("button", { name: "Deliveries", exact: true }).click();
  await page.getByLabel("Total received units for Meta Quest 3S").fill("1");
  await page.getByRole("button", { name: "Mark received" }).click();
  await page.getByRole("button", { name: "Payouts", exact: true }).click();
  await expect(page.locator(".stat").nth(2)).toContainText("$255.00");
  await page.getByLabel("Total paid units for Meta Quest 3S").fill("2");
  await page.getByRole("button", { name: "Record paid" }).click();
  await expect(page.locator(".stat").nth(3)).toContainText("$0.00");
  await page.getByLabel("Total paid units for Meta Quest 3S").fill("1");
  await page.getByRole("button", { name: "Record paid" }).click();
  await expect(page.locator(".stat").nth(2)).toContainText("$0.00");
  await expect(page.locator(".stat").nth(3)).toContainText("$255.00");
});

test("capacity cannot be exceeded and full deals cannot be reserved", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Reserve units" }).first().click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Quantity").fill("31");
  await modal.getByRole("button", { name: "Confirm reservation" }).click();
  await expect(modal).toBeVisible();
  await modal.getByLabel("Quantity").fill("30");
  await modal.getByRole("button", { name: "Confirm reservation" }).click();
  await page.getByRole("button", { name: /^Deals/ }).click();
  const card = page.locator("article").filter({ hasText: "Meta Quest 3S" });
  await expect(card).toContainText("0 of 30 spots left");
  await expect(
    card.getByRole("button", { name: "Unavailable" }),
  ).toBeDisabled();
});

test("admin posts a deal with exact cent payouts and member can reserve it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to admin" }).click();
  await page.getByRole("button", { name: "Post a deal" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Product name").fill("Test laptop");
  await modal.getByLabel("Retailer", { exact: true }).fill("Example shop");
  await modal.getByLabel("Product URL").fill("https://example.com/product");
  await modal.getByLabel("Base payout ($)").fill("299.99");
  await modal.getByLabel("Commission ($)").fill("15.01");
  await modal.getByLabel("Total capacity").fill("5");
  await modal.getByLabel("Reserve by").fill("2027-01-01");
  await modal
    .getByLabel("Delivery instructions")
    .fill("Sealed units. Local drop-off.");
  await modal.getByRole("button", { name: "Post deal", exact: true }).click();
  await page.getByRole("button", { name: "Switch to member" }).click();
  await page.getByLabel("Search deals").fill("Test laptop");
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article")).toContainText("$315.00");
  await page.getByRole("button", { name: "Reserve units" }).click();
  await page.getByRole("button", { name: "Confirm reservation" }).click();
  await expect(page.locator("tbody tr")).toContainText("$315.00");
});

test("mobile layout fits viewport and navigation works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "VR & gaming", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Reserve units" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/mobius-mobile.png", fullPage: true });
});
