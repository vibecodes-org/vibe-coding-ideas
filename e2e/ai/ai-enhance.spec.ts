import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { test, expect } from "../fixtures/auth";
import { createTestIdea, cleanupTestData, getTestUserId, scopedTitle } from "../fixtures/test-data";
import { supabaseAdmin } from "../fixtures/supabase-admin";

let userAId: string;
let testIdeaId: string;

// Fake encrypted key — the UI only checks !!encrypted_anthropic_key, not its value
const FAKE_ENCRYPTED_KEY = "aabbccdd:eeff0011:22334455";

test.beforeAll(async () => {
  userAId = await getTestUserId("userA");

  // Create a test idea owned by User A
  const idea = await createTestIdea(userAId, {
    title: scopedTitle("AI Enhance Test Idea"),
    description: scopedTitle("This is the original description that should be enhanced by AI."),
  });
  testIdeaId = idea.id;
});

test.afterAll(async () => {
  // Remove fake API key
  await supabaseAdmin
    .from("users")
    .update({ encrypted_anthropic_key: null })
    .eq("id", userAId);

  await cleanupTestData();
});

test.describe("AI Enhance - Idea Detail", () => {
  test('shows "Enhance with AI" button for author with API key', async ({
    userAPage,
  }) => {
    // Give User A a (fake) API key so the button is enabled
    await supabaseAdmin
      .from("users")
      .update({ encrypted_anthropic_key: FAKE_ENCRYPTED_KEY })
      .eq("id", userAId);

    await userAPage.goto(`/ideas/${testIdeaId}`);
    const main = userAPage.getByRole("main");

    // The button should be visible on desktop (hidden sm:inline-flex wrapper)
    const enhanceButton = main.getByRole("button", { name: /enhance with ai/i });
    await expect(enhanceButton.first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Button should be enabled when user has API key
    await expect(enhanceButton.first()).toBeEnabled();
  });

  test("shows disabled enhance button when user has no API key", async ({
    userAPage,
  }) => {
    // Remove API key so button is disabled
    await supabaseAdmin
      .from("users")
      .update({ encrypted_anthropic_key: null })
      .eq("id", userAId);

    await userAPage.goto(`/ideas/${testIdeaId}`);
    const main = userAPage.getByRole("main");

    // Wait for page to fully render
    await expect(main.locator("input[value*='AI Enhance Test Idea']")).toBeVisible({
      timeout: EXPECT_TIMEOUT,
    });

    // The enhance button should still be visible but disabled (opacity-50)
    const enhanceButton = main.getByRole("button", { name: /enhance with ai/i }).first();
    await expect(enhanceButton).toBeVisible({ timeout: 10_000 });
    await expect(enhanceButton).toHaveClass(/opacity-50/);
  });

  test("disabled enhance button shows API key tooltip on hover", async ({
    userAPage,
  }) => {
    // Remove API key
    await supabaseAdmin
      .from("users")
      .update({ encrypted_anthropic_key: null })
      .eq("id", userAId);

    await userAPage.goto(`/ideas/${testIdeaId}`);
    const main = userAPage.getByRole("main");

    // Wait for the button to appear (disabled state: wrapped in a span with pointer-events-none)
    const enhanceButton = main.getByRole("button", { name: /enhance with ai/i }).first();
    await expect(enhanceButton).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // The button should have pointer-events-none (disabled style)
    await expect(enhanceButton).toHaveClass(/pointer-events-none/);

    // Hover over the tooltip trigger (the wrapping span) to show the tooltip
    const tooltipTrigger = enhanceButton.locator("xpath=ancestor::span[@data-slot='tooltip-trigger']").first();
    await tooltipTrigger.hover();

    // Tooltip should tell user to add API key
    await expect(
      userAPage.getByRole("tooltip").filter({ hasText: /api key/i })
    ).toBeVisible({ timeout: 5_000 });
  });

  test("opens enhance dialog with prompt textarea and current description", async ({
    userAPage,
  }) => {
    // Give User A an API key so the button is enabled
    await supabaseAdmin
      .from("users")
      .update({ encrypted_anthropic_key: FAKE_ENCRYPTED_KEY })
      .eq("id", userAId);

    await userAPage.goto(`/ideas/${testIdeaId}`);
    const main = userAPage.getByRole("main");

    // Click the enhance button
    const enhanceButton = main.getByRole("button", { name: /enhance with ai/i });
    await expect(enhanceButton.first()).toBeEnabled({ timeout: EXPECT_TIMEOUT });
    await enhanceButton.first().click();

    // Dialog should open
    const dialog = userAPage.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Dialog title should contain "Enhance with AI"
    await expect(dialog.getByText("Enhance with AI")).toBeVisible();

    // Prompt textarea should be present with default prompt text
    const promptTextarea = dialog.locator("textarea");
    await expect(promptTextarea).toBeVisible();
    await expect(promptTextarea).not.toBeEmpty();

    // Current description preview should be visible
    await expect(dialog.getByText("Current Description")).toBeVisible();
  });

  test("dialog has Ask clarifying questions checkbox and Next button", async ({
    userAPage,
  }) => {
    // Give User A an API key
    await supabaseAdmin
      .from("users")
      .update({ encrypted_anthropic_key: FAKE_ENCRYPTED_KEY })
      .eq("id", userAId);

    await userAPage.goto(`/ideas/${testIdeaId}`);
    const main = userAPage.getByRole("main");

    // Open the enhance dialog
    const enhanceButton = main.getByRole("button", { name: /enhance with ai/i });
    await expect(enhanceButton.first()).toBeEnabled({ timeout: EXPECT_TIMEOUT });
    await enhanceButton.first().click();

    const dialog = userAPage.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // "Ask clarifying questions first" checkbox should be present and checked by default
    const askQuestionsCheckbox = dialog.getByLabel(/ask clarifying questions/i);
    await expect(askQuestionsCheckbox).toBeVisible();
    await expect(askQuestionsCheckbox).toBeChecked();

    // "Next" button should be visible (since ask questions is checked)
    const nextButton = dialog.getByRole("button", { name: /next/i });
    await expect(nextButton).toBeVisible();
  });
});
