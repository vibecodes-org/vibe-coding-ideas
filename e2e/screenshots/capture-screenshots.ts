import { test, expect } from "@playwright/test";
import { seedRealisticData, cleanupSeededData, type SeededData } from "./seed-data";

let seeded: SeededData | null = null;

test.beforeAll(async () => {
  seeded = await seedRealisticData();
});

test.afterAll(async () => {
  await cleanupSeededData(seeded);
});

// ── Helper: prepare page for screenshot ──

async function prepareForScreenshot(page: import("@playwright/test").Page) {
  // Wait for dark theme class on html element
  await expect(page.locator("html")).toHaveClass(/dark/, { timeout: 10_000 });

  // Disable CSS animations for clean capture
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });

  // Brief pause for any final rendering
  await page.waitForTimeout(500);
}

// ── Desktop Screenshots ──

test("01 - Ideas Feed", async ({ page }) => {
  await page.goto("/ideas?sort=popular");

  // Wait for idea cards to render
  const cards = page.locator('[data-testid^="idea-card-"]');
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });

  await prepareForScreenshot(page);
  await page.screenshot({ path: "screenshots/01-ideas-feed.png", fullPage: false });
});

test("02 - Idea Detail", async ({ page }) => {
  test.skip(!seeded, "No seeded data");
  await page.goto(`/ideas/${seeded!.primaryIdeaId}`);

  // Wait for page to load — title is an editable <Input> for authors, so wait for comment text instead
  await expect(page.getByText("Love this concept")).toBeVisible({ timeout: 15_000 });

  await prepareForScreenshot(page);
  await page.screenshot({ path: "screenshots/02-idea-detail.png", fullPage: false });
});

test("03 - Kanban Board", async ({ page }) => {
  test.skip(!seeded, "No seeded data");
  await page.goto(`/ideas/${seeded!.primaryIdeaId}/board`);

  // Wait for columns to render
  const columns = page.locator('[data-testid^="column-"]');
  await expect(columns.first()).toBeVisible({ timeout: 15_000 });

  // Wait for task cards to appear
  const taskCards = page.locator('[data-testid^="task-card-"]');
  await expect(taskCards.first()).toBeVisible({ timeout: 10_000 });

  await prepareForScreenshot(page);
  await page.screenshot({ path: "screenshots/03-kanban-board.png", fullPage: false });
});

test("04 - Task Detail Dialog", async ({ page }) => {
  test.skip(!seeded, "No seeded data");
  await page.goto(`/ideas/${seeded!.primaryIdeaId}/board`);

  // Wait for board to load
  const taskCards = page.locator('[data-testid^="task-card-"]');
  await expect(taskCards.first()).toBeVisible({ timeout: 15_000 });

  // Click a task card that contains "Implement ingredient parser" — use exact match to avoid description text
  const targetTask = page.getByText("Implement ingredient parser API", { exact: true }).first();
  await expect(targetTask).toBeVisible({ timeout: 5_000 });
  await targetTask.click();

  // Wait for the dialog to open
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  // Wait for dialog content to fully load — title renders as <Input> for authors, so look for tabs
  await expect(dialog.getByRole("tablist")).toBeVisible({ timeout: 5_000 });

  await prepareForScreenshot(page);
  await page.screenshot({ path: "screenshots/04-task-detail.png", fullPage: false });
});

test("05 - Agents Hub", async ({ page }) => {
  // Dismiss the MCP banner via localStorage before navigating
  await page.addInitScript(() => {
    localStorage.setItem("agents-mcp-banner-dismissed", "true");
  });

  await page.goto("/agents");

  // Wait for the page to load — look for agent-related text
  await expect(page.getByText(/Agents Hub|My Agents/i).first()).toBeVisible({ timeout: 15_000 });

  // Wait for agent cards to render — look for one of our seeded agents (use first() to avoid strict mode)
  await expect(page.getByText("CodeReviewer").first()).toBeVisible({ timeout: 10_000 });

  await prepareForScreenshot(page);
  await page.screenshot({ path: "screenshots/05-agents-hub.png", fullPage: false });
});

test("06 - MCP Integration Guide", async ({ page }) => {
  await page.goto("/guide/mcp-integration");

  // Wait for page content to load
  await expect(page.getByText("MCP Integration").first()).toBeVisible({ timeout: 15_000 });

  // Expand 2-3 collapsible tool categories — target only CollapsibleTools buttons (contain "tools" text)
  const collapsibleButtons = page.locator('button[aria-expanded="false"]:has-text("tools")');
  const count = await collapsibleButtons.count();
  const toExpand = Math.min(count, 3);
  for (let i = 0; i < toExpand; i++) {
    await collapsibleButtons.nth(0).click({ force: true });
    await page.waitForTimeout(300);
  }

  // Scroll to show the expanded tools section
  const expandedButton = page.locator('button[aria-expanded="true"]:has-text("tools")').first();
  if (await expandedButton.count() > 0) {
    await expandedButton.scrollIntoViewIfNeeded();
  }

  await prepareForScreenshot(page);
  await page.screenshot({ path: "screenshots/06-mcp-integration.png", fullPage: false });
});

test("07 - Dashboard", async ({ page }) => {
  await page.goto("/dashboard");

  // Wait for dashboard content to load
  await expect(page.getByText(/My Ideas|My Tasks|Dashboard/i).first()).toBeVisible({ timeout: 15_000 });

  await prepareForScreenshot(page);
  await page.screenshot({ path: "screenshots/07-dashboard.png", fullPage: false });
});

test("08 - Discussion Thread", async ({ page }) => {
  test.skip(!seeded, "No seeded data");
  await page.goto(`/ideas/${seeded!.primaryIdeaId}/discussions/${seeded!.discussionId}`);

  // Wait for discussion title to render — use heading role to avoid matching <title>
  await expect(page.getByRole("heading", { name: /API Design/ })).toBeVisible({ timeout: 15_000 });

  // Wait for replies to load
  await expect(page.getByText("I'd lean toward GraphQL")).toBeVisible({ timeout: 10_000 });

  await prepareForScreenshot(page);
  await page.screenshot({ path: "screenshots/08-discussion-thread.png", fullPage: false });
});

// ── Mobile Screenshots ──

test.describe("Mobile", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test("09 - Mobile Ideas Feed", async ({ page }) => {
    await page.goto("/ideas?sort=popular");

    const cards = page.locator('[data-testid^="idea-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    await prepareForScreenshot(page);
    await page.screenshot({ path: "screenshots/09-mobile-feed.png", fullPage: false });
  });

  test("10 - Mobile Kanban Board", async ({ page }) => {
    test.skip(!seeded, "No seeded data");
    await page.goto(`/ideas/${seeded!.primaryIdeaId}/board`);

    const columns = page.locator('[data-testid^="column-"]');
    await expect(columns.first()).toBeVisible({ timeout: 15_000 });

    await prepareForScreenshot(page);
    await page.screenshot({ path: "screenshots/10-mobile-board.png", fullPage: false });
  });
});
