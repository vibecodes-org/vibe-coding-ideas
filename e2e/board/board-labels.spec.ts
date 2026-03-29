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

  // Create a test label via DB
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
  test("should show labels in the toolbar filter", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Open Labels filter in toolbar
    await page.getByRole("main").getByRole("button", { name: "Labels" }).click();

    // The label we created should be in the filter list
    await expect(page.getByText("E2E-Bug")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
