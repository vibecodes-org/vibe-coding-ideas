import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Middleware — Route Protection", () => {
  test.describe("Unauthenticated user", () => {
    test("should redirect /dashboard to /login", async ({ anonPage: page }) => {
      await page.goto("/dashboard");
      await page.waitForURL("**/login", { timeout: EXPECT_TIMEOUT });
      await expect(page).toHaveURL(/\/login/);
    });

    test("should redirect /ideas to /login", async ({ anonPage: page }) => {
      await page.goto("/ideas");
      await page.waitForURL("**/login", { timeout: EXPECT_TIMEOUT });
      await expect(page).toHaveURL(/\/login/);
    });

    test("should redirect /agents to /login", async ({ anonPage: page }) => {
      await page.goto("/agents");
      await page.waitForURL("**/login", { timeout: EXPECT_TIMEOUT });
      await expect(page).toHaveURL(/\/login/);
    });

    test("should redirect /admin to /login", async ({ anonPage: page }) => {
      await page.goto("/admin");
      await page.waitForURL("**/login", { timeout: EXPECT_TIMEOUT });
      await expect(page).toHaveURL(/\/login/);
    });

    test("should allow access to public landing page", async ({ anonPage: page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("main")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("should allow access to guide pages", async ({ anonPage: page }) => {
      await page.goto("/guide");
      await expect(page).toHaveURL(/\/guide/);
      await expect(page.getByRole("main")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });
  });

  test.describe("Authenticated user", () => {
    test("should access /dashboard without redirect", async ({ userAPage: page }) => {
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole("main")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("should access /ideas without redirect", async ({ userAPage: page }) => {
      await page.goto("/ideas");
      await expect(page).toHaveURL(/\/ideas/);
      await expect(page.getByRole("main")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("should redirect /admin to /dashboard for non-admin", async ({ userAPage: page }) => {
      await page.goto("/admin");
      await page.waitForURL("**/dashboard", { timeout: EXPECT_TIMEOUT });
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test("should allow admin access to /admin", async ({ adminPage: page }) => {
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/admin/);
      await expect(page.getByRole("main")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });
  });
});
