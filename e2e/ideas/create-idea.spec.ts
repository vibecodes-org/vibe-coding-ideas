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
    // Visibility is a segmented Public/Private radiogroup (VisibilitySelector)
    await expect(page.getByRole("radio", { name: /Private/i })).toBeVisible();
  });

  test("should show project type selector when kits exist", async ({ userAPage: page }) => {
    await page.goto("/ideas/new");
    await expect(page.getByText("Share Your Idea")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Kit selector should be visible
    await expect(page.getByText(/What kind of project/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should create an idea with title and description", async ({ userAPage: page }) => {
    // Creation applies the default Web kit (seeds columns/labels/workflows) and
    // then paints the board; the kit-seeded first paint is heavier, so allow headroom.
    test.setTimeout(75_000);
    await page.goto("/ideas/new");
    await expect(page.getByText("Share Your Idea")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    await page.locator("#title").fill("[E2E] Test Idea Creation");
    await page.locator("#description").fill("[E2E] This is a test idea created by E2E tests.");

    // Submit — button text varies based on kit selection
    await page.getByRole("button", { name: /Create idea/i }).click();

    // A kit is applied on create, so creation redirects to the new idea's board.
    // Reaching this URL already proves the idea was created (a missing title would
    // have kept us on /ideas/new with a validation error).
    await page.waitForURL(/\/ideas\/[a-f0-9-]+\/board/, { timeout: 30_000 });

    // Board-content assertion: restored after the post-kit-apply double-render fix
    // (843aff6) — KitAppliedToast no longer re-renders the whole board via
    // router.replace, so the kit-seeded board paints in time. The breadcrumb links
    // back to the idea by its title, confirming the board actually rendered.
    await expect(
      page.getByRole("link", { name: "[E2E] Test Idea Creation" })
    ).toBeVisible({ timeout: 30_000 });
  });
});
