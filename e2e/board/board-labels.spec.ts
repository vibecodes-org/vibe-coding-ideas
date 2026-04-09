import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardWithTasks, cleanupIdeas, scopedTitle } from "../fixtures/test-data";
import { supabaseAdmin } from "../fixtures/supabase-admin";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Board Labels") });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  await createTestBoardWithTasks(ideaId, 2);

  await supabaseAdmin.from("board_labels").insert({
    idea_id: ideaId,
    name: "E2E-Bug",
    color: "red",
  });
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Board Labels", () => {
  test("should show labels in the toolbar filter", async ({ userAPage: page }, testInfo) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    const isMobile = testInfo.project.name === "Mobile Chrome";

    if (isMobile) {
      // Mobile: open the Filters sheet first, then find Labels
      await page.getByRole("button", { name: /Filters/i }).click();
      await page.waitForTimeout(500);
    }

    // Click the Labels filter button (scoped to main to avoid strict mode violation)
    await page.getByRole("main").getByRole("button", { name: "Labels" }).click();
    await expect(page.getByText("E2E-Bug")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
