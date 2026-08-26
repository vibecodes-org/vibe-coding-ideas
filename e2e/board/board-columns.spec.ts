import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardWithTasks, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Board Columns") });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  // Create columns WITH tasks so the board shows columns, not the empty AI state
  await createTestBoardWithTasks(ideaId, 1);
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Board Columns", () => {
  test("should display existing columns", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Board has default columns + the 3 we created, so at least 3
    const count = await page.locator("[data-testid^='column-']").count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("should create a new column", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    await page.getByRole("button", { name: "Add Column" }).click();
    await page.getByPlaceholder("Column name...").fill("Testing");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.locator("[data-testid^='column-']").filter({ hasText: "Testing" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  // TODO: column options menu test needs a data-testid on the "..." button
  // The current SVG-based selector is unreliable

  // Regression test for the missing-horizontal-scrollbar bug: a missing
  // `min-h-0` on an ancestor flex wrapper let the column row stretch to its
  // full content height instead of the viewport, pushing its horizontal
  // scrollbar off-screen. Asserting the scroll container stays viewport-bound
  // catches that class of regression even though the scrollbar itself isn't
  // something Playwright can "see".
  test("column scroll container stays bounded to the viewport height", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    const main = page.getByRole("main");
    const scrollContainer = main.getByTestId("board-scroll-container");
    await expect(scrollContainer).toBeVisible({ timeout: EXPECT_TIMEOUT });

    const viewportSize = page.viewportSize();
    expect(viewportSize).not.toBeNull();

    const box = await scrollContainer.boundingBox();
    expect(box).not.toBeNull();

    // Allow a small tolerance for chrome (navbar/footer share the viewport),
    // but the container must never be allowed to grow past it.
    expect(box!.height).toBeLessThanOrEqual(viewportSize!.height);
  });
});
