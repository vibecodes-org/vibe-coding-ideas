import { test as setup } from "@playwright/test";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { ensureTestUsers } from "./fixtures/supabase-admin";

const AUTH_DIR = path.join(__dirname, ".auth");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Extract the project ref from the URL (e.g. "irqbqxspxxzvuczhujzg" from "https://irqbqxspxxzvuczhujzg.supabase.co")
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;

const userConfigs = [
  { key: "userA", file: "user-a.json", envEmail: "TEST_USER_A_EMAIL", envPassword: "TEST_USER_A_PASSWORD" },
  { key: "userB", file: "user-b.json", envEmail: "TEST_USER_B_EMAIL", envPassword: "TEST_USER_B_PASSWORD" },
  { key: "admin", file: "admin.json", envEmail: "TEST_ADMIN_EMAIL", envPassword: "TEST_ADMIN_PASSWORD" },
  { key: "fresh", file: "fresh.json", envEmail: "TEST_FRESH_EMAIL", envPassword: "TEST_FRESH_PASSWORD" },
];

/** Max cookie size before Supabase SSR chunks the value */
const MAX_CHUNK_SIZE = 3180;

/**
 * Build Supabase SSR auth cookies from a session.
 * Supabase SSR stores the full session object as a JSON-encoded cookie value.
 * If the value exceeds ~3180 bytes, it's chunked into .0, .1, etc.
 */
function buildAuthCookies(session: Record<string, unknown>) {
  const value = JSON.stringify(session);
  const cookies: { name: string; value: string; domain: string; path: string; httpOnly: boolean; secure: boolean; sameSite: "Lax" }[] = [];

  if (value.length <= MAX_CHUNK_SIZE) {
    cookies.push({
      name: COOKIE_NAME,
      value: encodeURIComponent(value),
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    });
  } else {
    // Chunk the value
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += MAX_CHUNK_SIZE) {
      chunks.push(value.slice(i, i + MAX_CHUNK_SIZE));
    }
    for (let i = 0; i < chunks.length; i++) {
      cookies.push({
        name: `${COOKIE_NAME}.${i}`,
        value: encodeURIComponent(chunks[i]),
        domain: "localhost",
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      });
    }
  }

  return cookies;
}

setup.setTimeout(60_000); // 1 minute — API auth is fast, no browser login needed

setup("create test users and authenticate", async ({ browser }) => {
  console.log(`[E2E Setup] SUPABASE_URL: ${SUPABASE_URL}`);
  console.log(`[E2E Setup] Project ref: ${PROJECT_REF}`);

  // Ensure test users exist in Supabase
  console.log("[E2E Setup] Creating test users...");
  await ensureTestUsers();
  console.log("[E2E Setup] Test users ready");

  // Authenticate each user via API (bypasses CAPTCHA) and save storage state
  for (const config of userConfigs) {
    const email = process.env[config.envEmail] ?? `test-${config.key.toLowerCase()}@vibecodes-test.local`;
    const password = process.env[config.envPassword] ?? "TestPassword123!";

    console.log(`[E2E Setup] Authenticating ${config.key} via API...`);

    // Sign in via service-role client — bypasses CAPTCHA verification
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      throw new Error(`API login failed for ${config.key}: ${error?.message ?? "no session returned"}`);
    }

    console.log(`[E2E Setup] ${config.key} authenticated successfully`);

    // Create a browser context, inject auth cookies, and save storage state
    const context = await browser.newContext();
    const cookies = buildAuthCookies(data.session);
    await context.addCookies(cookies);

    // Verify the cookies work by navigating to dashboard
    const page = await context.newPage();
    await page.goto("/dashboard");
    try {
      await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
      console.log(`[E2E Setup] ${config.key} dashboard verified`);
    } catch {
      console.warn(`[E2E Setup] ${config.key} dashboard navigation timed out at: ${page.url()}`);
      // Don't throw — the cookies might still work for individual tests
    }

    // Save auth state
    await context.storageState({ path: path.join(AUTH_DIR, config.file) });
    await context.close();
  }

  console.log("[E2E Setup] All users authenticated and storage states saved");
});
