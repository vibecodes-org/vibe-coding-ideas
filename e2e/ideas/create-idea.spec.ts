import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { cleanupTestData } from "../fixtures/test-data";

test.afterAll(async () => {
  await cleanupTestData();
});

test.describe("Create Idea", () => {
  test("should display create idea form", async ({ userAPage: page }) => {
    await page.goto("/ideas/new");
    await expect(page.getByText("Share Your Idea")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.locator("#title")).toBeVisible();
    await expect(page.locator("#description")).toBeVisible();
  });

  test("should have visibility toggle", async ({ userAPage: page }) => {
    await page.goto("/ideas/new");
    await expect(page.getByText("Share Your Idea")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByText("Private idea")).toBeVisible();
  });

  test("should show project type selector when kits exist", async ({ userAPage: page }) => {
    await page.goto("/ideas/new");
    await expect(page.getByText("Share Your Idea")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Kit selector should be visible
    await expect(page.getByText(/What kind of project/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should create an idea with title and description", async ({ userAPage: page }) => {
    await page.goto("/ideas/new");
    await expect(page.getByText("Share Your Idea")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    await page.locator("#title").fill("[E2E] Test Idea Creation");
    await page.locator("#description").fill("[E2E] This is a test idea created by E2E tests.");

    // Submit — button text varies based on kit selection
    await page.getByRole("button", { name: /Create idea/i }).click();

    // Should redirect to the idea detail page
    await page.waitForURL(/\/ideas\/[a-f0-9-]+$/, { timeout: 30_000 });
    await expect(page.getByText("[E2E] Test Idea Creation")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
