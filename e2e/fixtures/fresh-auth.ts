import type { Page } from "@playwright/test";

/**
 * Navigate freshPage to a protected route, re-authenticating if the stored
 * session has expired and middleware redirected to /login.
 *
 * The fresh user's auth token (saved during global-setup) can expire between
 * setup and test execution. Protected routes redirect unauthenticated users
 * to /login, which breaks tests that expect to land on the target page.
 */
export async function ensureFreshPageAuthenticated(
  page: Page,
  targetPath: string
): Promise<void> {
  const email =
    process.env.TEST_FRESH_EMAIL ?? "test-fresh@vibecodes-test.local";
  const password = process.env.TEST_FRESH_PASSWORD ?? "TestPassword123!";

  await page.goto(targetPath);

  // Give the page a moment to settle (middleware redirect is near-instant)
  await page.waitForTimeout(2000);

  const currentUrl = page.url();

  if (currentUrl.includes("/login")) {
    // Session expired — re-authenticate inline
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for auth to complete then navigate explicitly (same pattern as global-setup)
    await page.waitForTimeout(3000);
    await page.goto(targetPath);
  }

  // Verify we actually landed on the target page
  await page.waitForURL(`**${targetPath}`, { timeout: 15_000 });
}
