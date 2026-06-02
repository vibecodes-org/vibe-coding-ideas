import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { supabaseAdmin } from "../fixtures/supabase-admin";
import { createTestIdea, cleanupIdeas, getTestUserId, scopedTitle } from "../fixtures/test-data";

/**
 * E2E coverage for the GitHub link dialog and Profile-Settings connection
 * surface. Server-side fetches to api.github.com cannot be intercepted from
 * the browser context, so this suite focuses on the parts that don't depend
 * on a live GitHub API response:
 *
 *   1. Manual URL fallback (no GitHub at all)
 *   2. Connect button hitting the start route (OAuth round-trip stubbed via
 *      a Playwright route on github.com so we don't actually leave the app)
 *   3. Connected-state UI rendering when a row is pre-seeded
 *   4. Disconnect flow from Profile Settings
 *
 * Browse-list rendering and create-repo POST are best left to lower-level
 * integration tests against `src/actions/github.ts`; mocking server-side
 * fetches across the Next.js boundary in Playwright is brittle.
 */

let ideaId: string;
let userAId: string;
let ideaUrl: string;

test.beforeAll(async () => {
  userAId = await getTestUserId("userA");
  const idea = await createTestIdea(userAId, {
    title: scopedTitle("GitHub Link Test"),
    description: "[E2E] Idea for testing the GitHub link dialog.",
  });
  ideaId = idea.id;
  ideaUrl = `/ideas/${ideaId}`;
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
  // Belt-and-braces: ensure no test-seeded connection row leaks across runs
  await supabaseAdmin.from("user_github_connections").delete().eq("user_id", userAId);
});

test.describe("GitHub link dialog — manual URL fallback (no connection required)", () => {
  test("opens the dialog and reveals manual URL field via 'paste a URL instead'", async ({ userAPage: page }) => {
    await page.goto(ideaUrl);
    await page.getByRole("button", { name: /Add GitHub URL/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(dialog.getByRole("heading", { name: /Link a GitHub repo/i })).toBeVisible();

    await dialog.getByText(/paste a URL instead/i).click();
    await expect(dialog.getByPlaceholder(/https:\/\/github\.com/i)).toBeVisible();
  });

  test("saves a manually-entered URL and shows it on the idea page", async ({ userAPage: page }) => {
    await page.goto(ideaUrl);
    await page.getByRole("button", { name: /Add GitHub URL/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByText(/paste a URL instead/i).click();

    const urlInput = dialog.getByPlaceholder(/https:\/\/github\.com/i);
    await urlInput.fill("https://github.com/test-user/manual-repo");
    await dialog.getByRole("button", { name: /^Save$/i }).click();

    // Dialog closes and the View Repository pill is rendered
    await expect(page.getByRole("link", { name: /View Repository/i })).toBeVisible({
      timeout: EXPECT_TIMEOUT,
    });
  });

  test("rejects a non-github URL with an inline error toast", async ({ userAPage: page }) => {
    // Reset any URL from the previous test
    await supabaseAdmin.from("ideas").update({ github_url: null }).eq("id", ideaId);
    await page.goto(ideaUrl);
    await page.getByRole("button", { name: /Add GitHub URL/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByText(/paste a URL instead/i).click();

    await dialog.getByPlaceholder(/https:\/\/github\.com/i).fill("https://gitlab.com/foo/bar");
    await dialog.getByRole("button", { name: /^Save$/i }).click();

    // Dialog should still be open and a toast surfaces the rejection
    await expect(page.getByText(/Not a valid GitHub repository URL/i)).toBeVisible({
      timeout: EXPECT_TIMEOUT,
    });
    await expect(dialog).toBeVisible();
  });
});

test.describe("GitHub link dialog — disconnected state", () => {
  test.beforeEach(async () => {
    // Ensure no connection exists so we render the Connect CTA
    await supabaseAdmin.from("user_github_connections").delete().eq("user_id", userAId);
    await supabaseAdmin.from("ideas").update({ github_url: null }).eq("id", ideaId);
  });

  test("shows the Connect CTA and the escape-hatch link", async ({ userAPage: page }) => {
    await page.goto(ideaUrl);
    await page.getByRole("button", { name: /Add GitHub URL/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: /Connect GitHub/i })).toBeVisible();
    await expect(dialog.getByText(/paste a URL instead/i)).toBeVisible();
    await expect(dialog.getByText(/we'll request/i)).toBeVisible();
  });

  test("Connect button navigates toward the GitHub authorize URL via the start route", async ({ userAPage: page }) => {
    // Intercept the github.com authorize redirect so we don't actually leave
    // the app — return an empty 200 so Playwright can capture the URL we
    // *would* have visited.
    await page.route(/github\.com\/login\/oauth\/authorize/, async (route) => {
      await route.fulfill({ status: 200, contentType: "text/plain", body: "intercepted" });
    });

    await page.goto(ideaUrl);
    await page.getByRole("button", { name: /Add GitHub URL/i }).click();

    const dialog = page.getByRole("dialog");
    const connectButton = dialog.getByRole("button", { name: /Connect GitHub/i });

    // After clicking Connect the browser navigates through /api/github/start
    // which 30x's to github.com — we should land on the intercepted github.com
    // URL (or a 503 if env vars are missing in test env, which is also fine
    // because it proves the start route was hit).
    await Promise.all([
      page.waitForURL(/(github\.com\/login\/oauth\/authorize|api\/github\/start)/, {
        timeout: EXPECT_TIMEOUT,
        waitUntil: "domcontentloaded",
      }).catch(() => {
        // 503 with no env vars set ends up on a 503 page — also acceptable
      }),
      connectButton.click(),
    ]);

    const url = page.url();
    expect(
      url.includes("github.com/login/oauth/authorize") || url.includes("/api/github/start")
    ).toBe(true);
  });
});

test.describe("Profile settings — GitHub connection management", () => {
  // The standalone GitHub connection button on the profile is a desktop-only
  // surface (`hidden sm:contents` in profile/[id]/page.tsx); mobile uses the
  // consolidated Settings menu, which does not expose GitHub. These tests
  // target that desktop button, so skip them on mobile viewports.
  test.skip(
    ({ isMobile }) => !!isMobile,
    "GitHub connection management is desktop-only on the profile page"
  );

  // Pre-seed a fake connection so the connected-state UI renders.
  // We never actually call the GitHub API in these tests; the dialog renders
  // its connected chrome (login, scopes, Disconnect) directly from the row.
  test.beforeEach(async () => {
    await supabaseAdmin.from("user_github_connections").upsert(
      {
        user_id: userAId,
        github_user_id: 999999,
        github_login: "e2e-test-user",
        github_avatar_url: null,
        encrypted_access_token: "iv:ciphertext:tag", // never decrypted in these tests
        scopes: ["repo", "read:user"],
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  });

  test.afterEach(async () => {
    await supabaseAdmin.from("user_github_connections").delete().eq("user_id", userAId);
  });

  test("renders connected-state with login + scopes + Disconnect button", async ({ userAPage: page }) => {
    await page.goto(`/profile/${userAId}`);
    await page.getByRole("button", { name: /^GitHub$/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(dialog.getByText(/@e2e-test-user/i)).toBeVisible();
    await expect(dialog.getByText(/repo, read:user/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Disconnect/i })).toBeVisible();
  });

  test("disconnects via the confirmation dialog and clears the row", async ({ userAPage: page }) => {
    await page.goto(`/profile/${userAId}`);
    await page.getByRole("button", { name: /^GitHub$/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /Disconnect/i }).click();

    // AlertDialog confirmation appears with destructive Disconnect button
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(confirm.getByText(/Disconnect GitHub\?/i)).toBeVisible();

    await confirm.getByRole("button", { name: /^Disconnect$/i }).click();

    // Settings dialog returns to the Connect CTA state
    await expect(dialog.getByRole("button", { name: /Connect GitHub/i })).toBeVisible({
      timeout: EXPECT_TIMEOUT,
    });

    // And the row is actually gone
    const { data } = await supabaseAdmin
      .from("user_github_connections")
      .select("user_id")
      .eq("user_id", userAId)
      .maybeSingle();
    expect(data).toBeNull();
  });
});

test.describe("GitHub link dialog — connected state (UI only, no live GitHub fetch)", () => {
  test.beforeEach(async () => {
    await supabaseAdmin.from("user_github_connections").upsert(
      {
        user_id: userAId,
        github_user_id: 999999,
        github_login: "e2e-test-user",
        github_avatar_url: null,
        encrypted_access_token: "iv:ciphertext:tag",
        scopes: ["repo", "read:user"],
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  });

  test.afterEach(async () => {
    await supabaseAdmin.from("user_github_connections").delete().eq("user_id", userAId);
  });

  test("renders Browse + Create tabs and shows the connected @login in the header", async ({ userAPage: page }) => {
    await page.goto(ideaUrl);
    await page.getByRole("button", { name: /Add GitHub URL/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(dialog.getByText(/@e2e-test-user/i)).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /^Browse$/i })).toBeVisible();
    await expect(dialog.getByRole("tab", { name: /Create new/i })).toBeVisible();
  });

  test("Create tab pre-fills the repo name with a kebab-cased idea title", async ({ userAPage: page }) => {
    await page.goto(ideaUrl);
    await page.getByRole("button", { name: /Add GitHub URL/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: /Create new/i }).click();

    // The seeded idea title is "[E2E] GitHub Link Test <timestamp>" — kebab-cased
    // should start with "e2e-github-link-test-".
    const nameInput = dialog.locator('input[value^="e2e-github-link-test"]').first();
    await expect(nameInput).toBeVisible();

    // "Initialise with README" must default OFF (Design Review tightening #4)
    const readmeCheckbox = dialog.locator('label:has-text("Initialise with README") input[type="checkbox"]');
    await expect(readmeCheckbox).not.toBeChecked();

    // Private should default ON
    const privateCheckbox = dialog.locator('label:has-text("Private repository") input[type="checkbox"]');
    await expect(privateCheckbox).toBeChecked();
  });
});
