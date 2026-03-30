import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Agents Hub", () => {
  test("should display Agents Hub page", async ({ userAPage: page }) => {
    await page.goto("/agents");
    await expect(page.getByRole("heading", { name: "Agents Hub" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have Create Agent button", async ({ userAPage: page }) => {
    await page.goto("/agents");
    await expect(page.getByRole("heading", { name: "Agents Hub" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // The main page Create Agent button (not the one in empty state)
    await expect(page.getByRole("button", { name: /Create Agent/i }).first()).toBeVisible();
  });

  test("should open Create Agent dialog", async ({ userAPage: page }) => {
    await page.goto("/agents");
    await expect(page.getByRole("heading", { name: "Agents Hub" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await page.getByRole("button", { name: /Create Agent/i }).first().click();

    // Dialog should appear with name field
    await expect(page.locator("#bot-name")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should show role template chips in Create Agent dialog", async ({ userAPage: page }) => {
    await page.goto("/agents");
    await page.getByRole("button", { name: /Create Agent/i }).first().click();
    await expect(page.locator("#bot-name")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Role templates should be visible
    await expect(page.getByRole("button", { name: "Full Stack Engineer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "QA Engineer" })).toBeVisible();
  });
});
