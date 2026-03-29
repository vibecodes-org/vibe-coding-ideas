import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

// Use the visible heading (with !) to avoid strict mode violation with the sr-only dialog title
const WELCOME_HEADING = (page: import("@playwright/test").Page) => page.getByRole("heading", { name: "Welcome to VibeCodes!" });

test.describe("Onboarding", () => {
  // TODO: Fresh user tests need investigation — the freshPage session
  // doesn't survive in CI (cookie not accepted by middleware).
  // Tracked as a follow-up task.
  test.describe("Fresh user (onboarding not completed)", () => {
    test.skip(() => true, "Fresh user session not working in CI — needs investigation");
    test("should show onboarding wizard on dashboard", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(WELCOME_HEADING(page)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await expect(page.getByRole("button", { name: /Let's get started/i })).toBeVisible();
    });

    test("should show skip option on welcome step", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByText(/Skip for now/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("should advance to profile step on get started click", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByRole("button", { name: /Let's get started/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByRole("button", { name: /Let's get started/i }).click();
      await expect(page.getByLabel(/Display name/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("should advance to project step after profile", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByRole("button", { name: /Let's get started/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByRole("button", { name: /Let's get started/i }).click();
      await expect(page.getByLabel(/Display name/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByText(/Skip this step/i).click();
      await expect(page.getByLabel(/Project name/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("should show kit selector on project step", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByRole("button", { name: /Let's get started/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByRole("button", { name: /Let's get started/i }).click();
      await page.getByText(/Skip this step/i).click();
      await expect(page.getByText(/What kind of project/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await expect(page.getByText("Web Application")).toBeVisible();
    });

    test("should show validation error when creating project without name", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(page.getByRole("button", { name: /Let's get started/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByRole("button", { name: /Let's get started/i }).click();
      await page.getByText(/Skip this step/i).click();
      await expect(page.getByRole("button", { name: /Create & Generate Board/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByRole("button", { name: /Create & Generate Board/i }).click();
      await expect(page.getByText(/Give your project a name/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("should allow skipping the entire onboarding", async ({ freshPage: page }) => {
      await page.goto("/dashboard");
      await expect(WELCOME_HEADING(page)).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await page.getByText(/Skip for now/i).click();
      await expect(page.getByRole("button", { name: /Let's get started/i })).not.toBeVisible({ timeout: EXPECT_TIMEOUT });
    });
  });

  test.describe("Existing user (onboarding completed)", () => {
    test("should NOT show onboarding wizard on dashboard", async ({ userAPage: page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2000);
      await expect(page.getByRole("button", { name: /Let's get started/i })).not.toBeVisible();
    });
  });
});
