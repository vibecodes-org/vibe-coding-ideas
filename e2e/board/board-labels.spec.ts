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

    // On mobile the inline desktop filter controls are hidden (display:none) but
    // still present in the DOM inside <main>. The real Labels button lives inside
    // the Filters sheet (Radix dialog portal, rendered outside <main>). Scope to
    // the right container per viewport.
    if (isMobile) {
      await page.getByRole("button", { name: /Filters/i }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await sheet.getByRole("button", { name: "Labels" }).click();
    } else {
      await page.getByRole("main").getByRole("button", { name: "Labels" }).click();
    }
    await expect(page.getByText("E2E-Bug")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
