import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Onboarding", () => {
  test.describe("Fresh user (onboarding not completed)", () => {
    test("should show onboarding wizard on dashboard", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByText(/Welcome to VibeCodes/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await expect(page.getByRole("button", { name: /Let's get started/i })).toBeVisible();
    });

    test("should show skip option on welcome step", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByText(/Skip for now/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("should advance to profile step on get started click", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByText(/Welcome to VibeCodes/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByRole("button", { name: /Let's get started/i }).click();
      // Profile step should show display name field
      await expect(page.getByLabel(/Display name/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("should advance to project step after profile", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByText(/Welcome to VibeCodes/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByRole("button", { name: /Let's get started/i }).click();
      await expect(page.getByLabel(/Display name/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      // Skip profile step
      await page.getByText(/Skip this step/i).click();
      // Project step should show project name field
      await expect(page.getByLabel(/Project name/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("should show kit selector on project step", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByText(/Welcome to VibeCodes/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByRole("button", { name: /Let's get started/i }).click();
      await page.getByText(/Skip this step/i).click();
      await expect(page.getByText(/What kind of project/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      // Kit options should be visible
      await expect(page.getByText("Web Application")).toBeVisible();
    });

    test("should show validation error when creating project without name", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByText(/Welcome to VibeCodes/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByRole("button", { name: /Let's get started/i }).click();
      await page.getByText(/Skip this step/i).click();
      // Try to create without a name
      await page.getByRole("button", { name: /Create & Generate Board/i }).click();
      // Should show validation toast
      await expect(page.getByText(/Give your project a name/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("should allow skipping the entire onboarding", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByText(/Welcome to VibeCodes/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByText(/Skip for now/i).click();
      // Onboarding should close and dashboard should be visible
      await expect(page.getByText(/Welcome to VibeCodes/i)).not.toBeVisible({ timeout: EXPECT_TIMEOUT });
    });
  });

  test.describe("Existing user (onboarding completed)", () => {
    test("should NOT show onboarding wizard on dashboard", async ({ userAPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByRole("main")).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await expect(page.getByText(/Welcome to VibeCodes/i)).not.toBeVisible();
    });
  });
});
