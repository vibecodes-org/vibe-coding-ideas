import { test as setup, expect } from "@playwright/test";
import path from "path";
import { ensureTestUsers } from "./fixtures/supabase-admin";

const AUTH_DIR = path.join(__dirname, ".auth");

const userConfigs = [
  { key: "userA", file: "user-a.json", envEmail: "TEST_USER_A_EMAIL", envPassword: "TEST_USER_A_PASSWORD" },
  { key: "userB", file: "user-b.json", envEmail: "TEST_USER_B_EMAIL", envPassword: "TEST_USER_B_PASSWORD" },
  { key: "admin", file: "admin.json", envEmail: "TEST_ADMIN_EMAIL", envPassword: "TEST_ADMIN_PASSWORD" },
  { key: "fresh", file: "fresh.json", envEmail: "TEST_FRESH_EMAIL", envPassword: "TEST_FRESH_PASSWORD" },
];

setup.setTimeout(120_000); // 2 minutes for user creation + 4 sequential logins

setup("create test users and authenticate", async ({ browser }) => {
  // Ensure test users exist in Supabase
  await ensureTestUsers();

  // Log in each user in a fresh browser context and save storage state
  for (const config of userConfigs) {
    const email = process.env[config.envEmail] ?? `test-${config.key.toLowerCase()}@vibecodes-test.local`;
    const password = process.env[config.envPassword] ?? "TestPassword123!";

    const context = await browser.newContext();
    const page = await context.newPage();

    // Capture console errors for debugging
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(`PAGE ERROR: ${error.message}`);
    });

    await page.goto("/login");

    // Check for application errors before interacting
    const appError = page.getByText("Application error");
    if (await appError.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.error(`Client-side crash on /login for ${config.key}. Console errors:`, consoleErrors);
      throw new Error(`Login page crashed for ${config.key}: ${consoleErrors.join("; ")}`);
    }

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for auth cookies to be set, then navigate to dashboard explicitly.
    // router.push("/dashboard") can race with cookie setting in Firefox,
    // causing middleware to redirect back to /login. Explicit navigation is more reliable.
    await page.waitForTimeout(3000);
    await page.goto("/dashboard");
    await page.waitForURL("**/dashboard", { timeout: 15_000 });

    // Verify auth cookie exists (Supabase SSR uses cookies, not localStorage)
    const cookies = await context.cookies();
    const hasAuthCookie = cookies.some(
      (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
    );
    if (!hasAuthCookie) {
      // Fall back to checking split cookies (Supabase SSR may chunk large tokens)
      const hasSplitCookie = cookies.some(
        (c) => c.name.startsWith("sb-") && c.name.includes("auth-token")
      );
      if (!hasSplitCookie) {
        console.warn(`Warning: No auth cookie found for ${config.key}, but page is on dashboard.`);
      }
    }

    // Save auth state (cookies including Supabase auth tokens)
    await context.storageState({ path: path.join(AUTH_DIR, config.file) });

    await context.close();
  }
});
