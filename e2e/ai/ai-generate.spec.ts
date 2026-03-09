import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { test, expect } from "../fixtures/auth";
import {
  createTestIdea,
  createTestBoardWithTasks,
  cleanupIdeas,
  getTestUserId,
  scopedTitle,
} from "../fixtures/test-data";
import { supabaseAdmin } from "../fixtures/supabase-admin";

let userAId: string;
let testIdeaId: string;

// Fake encrypted key — the UI only checks !!encrypted_anthropic_key, not its value
const FAKE_ENCRYPTED_KEY = "aabbccdd:eeff0011:22334455";

test.beforeAll(async () => {
  userAId = await getTestUserId("userA");

  // Create a test idea with board and tasks
  const idea = await createTestIdea(userAId, {
    title: scopedTitle("AI Generate Board Idea"),
    description: scopedTitle("An idea for testing AI board generation features."),
  });
  testIdeaId = idea.id;
  await createTestBoardWithTasks(testIdeaId, 2);
});

test.afterAll(async () => {
  // Remove fake API key
  await supabaseAdmin
    .from("users")
    .update({ encrypted_anthropic_key: null })
    .eq("id", userAId);

  await cleanupIdeas([testIdeaId]);
});

test.describe("AI Generate - Board Toolbar", () => {
  test('shows "AI Generate" button on board toolbar for team member', async ({
    userAPage,
  }) => {
    await userAPage.goto(`/ideas/${testIdeaId}/board`);
    const main = userAPage.getByRole("main");

    // Wait for board columns to load
    await main
      .locator('[data-testid^="column-"]')
      .first()
      .waitFor({ timeout: EXPECT_TIMEOUT });

    // AI Generate button should be visible (always shown for team members)
    const aiButton = main.getByRole("button", { name: /ai generate/i });
    await expect(aiButton).toBeVisible();
  });

  test("AI Generate button is disabled (opacity-50) when user has no API key", async ({
    userAPage,
  }) => {
    // Remove API key AND zero out credits so button is disabled
    await supabaseAdmin
      .from("users")
      .update({ encrypted_anthropic_key: null, ai_starter_credits: 0 })
      .eq("id", userAId);

    await userAPage.goto(`/ideas/${testIdeaId}/board`);
    const main = userAPage.getByRole("main");

    // Wait for board columns to load
    await main
      .locator('[data-testid^="column-"]')
      .first()
      .waitFor({ timeout: EXPECT_TIMEOUT });

    // AI Generate button should be visible but with opacity-50
    const aiButton = main.getByRole("button", { name: /ai generate/i });
    await expect(aiButton).toBeVisible();
    await expect(aiButton).toHaveClass(/opacity-50/);
  });

  test("disabled AI Generate button shows API key tooltip on hover", async ({
    userAPage,
  }) => {
    // Remove API key AND zero out credits so button is disabled
    await supabaseAdmin
      .from("users")
      .update({ encrypted_anthropic_key: null, ai_starter_credits: 0 })
      .eq("id", userAId);

    await userAPage.goto(`/ideas/${testIdeaId}/board`);
    const main = userAPage.getByRole("main");

    // Wait for board columns to load
    await main
      .locator('[data-testid^="column-"]')
      .first()
      .waitFor({ timeout: EXPECT_TIMEOUT });

    // The button should have pointer-events-none (disabled style)
    const generateButton = main.getByRole("button", { name: /ai generate/i });
    await expect(generateButton).toBeVisible();
    await expect(generateButton).toHaveClass(/pointer-events-none/);

    // Hover over the tooltip trigger (the wrapping span) to show the tooltip
    const tooltipTrigger = generateButton.locator("xpath=ancestor::span[@tabindex='0']").first();
    await tooltipTrigger.hover();

    // Tooltip should tell user to add API key
    await expect(
      userAPage.getByRole("tooltip").filter({ hasText: /api key/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("opens AI Generate dialog with prompt field and mode selector", async ({
    userAPage,
  }) => {
    // Give User A an API key so the button works
    await supabaseAdmin
      .from("users")
      .update({ encrypted_anthropic_key: FAKE_ENCRYPTED_KEY })
      .eq("id", userAId);

    await userAPage.goto(`/ideas/${testIdeaId}/board`);
    const main = userAPage.getByRole("main");

    // Wait for board columns to load
    await main
      .locator('[data-testid^="column-"]')
      .first()
      .waitFor({ timeout: EXPECT_TIMEOUT });

    // Click AI Generate button
    await main.getByRole("button", { name: /ai generate/i }).click();

    // Dialog should open
    const dialog = userAPage.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Dialog title
    await expect(dialog.getByText("AI Generate Board")).toBeVisible();

    // Prompt textarea should be present
    const promptTextarea = dialog.locator("textarea");
    await expect(promptTextarea).toBeVisible();
    await expect(promptTextarea).not.toBeEmpty();

    // Mode radio buttons should be present
    await expect(dialog.getByText("Add to existing board")).toBeVisible();
    await expect(dialog.getByText("Replace existing board")).toBeVisible();

    // Generate button should be visible
    await expect(dialog.getByRole("button", { name: /generate/i })).toBeVisible();
  });

  test("replace mode shows destructive warning", async ({
    userAPage,
  }) => {
    // Give User A an API key
    await supabaseAdmin
      .from("users")
      .update({ encrypted_anthropic_key: FAKE_ENCRYPTED_KEY })
      .eq("id", userAId);

    await userAPage.goto(`/ideas/${testIdeaId}/board`);
    const main = userAPage.getByRole("main");

    // Wait for board columns to load
    await main
      .locator('[data-testid^="column-"]')
      .first()
      .waitFor({ timeout: EXPECT_TIMEOUT });

    // Open dialog
    await main.getByRole("button", { name: /ai generate/i }).click();
    const dialog = userAPage.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Select "Replace existing board" mode
    await dialog.getByLabel(/replace existing board/i).click();

    // Destructive warning should appear
    await expect(
      dialog.getByText(/will delete all existing tasks/i)
    ).toBeVisible();
  });
});
