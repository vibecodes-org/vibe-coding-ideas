import { test, expect } from "@playwright/test";
import { seedRealisticData, cleanupSeededData, type SeededData } from "../screenshots/seed-data";
import { dragTaskToColumn } from "../helpers/board-dnd";

let seeded: SeededData | null = null;

test.beforeAll(async () => {
  seeded = await seedRealisticData();
});

test.afterAll(async () => {
  await cleanupSeededData(seeded);
});

// ── Scene 1: Dashboard (0:00 - 0:10) ──
// Landing page redirects authenticated users to /dashboard, so start there.

test("scene-1-dashboard", async ({ page }) => {
  await page.goto("/dashboard");

  // Wait for dashboard content to load
  await expect(
    page.getByText(/Dashboard|My Ideas|My Tasks/i).first()
  ).toBeVisible({ timeout: 15_000 });

  // Brief pause on dashboard
  await page.waitForTimeout(2500);

  // Smooth scroll to show more dashboard content
  await page.evaluate(() =>
    window.scrollBy({ top: 400, behavior: "smooth" })
  );
  await page.waitForTimeout(2500);

  // Scroll back
  await page.evaluate(() =>
    window.scrollTo({ top: 0, behavior: "smooth" })
  );
  await page.waitForTimeout(1500);

  // Navigate to ideas feed
  await page.goto("/ideas?sort=popular");
  const cards = page.locator('[data-testid^="idea-card-"]');
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2000);
});

// ── Scene 2: Create a New Idea (0:10 - 0:25) ──

test("scene-2-create-idea", async ({ page }) => {
  // Navigate to create idea page
  await page.goto("/ideas/new");
  await page.waitForTimeout(1500);

  // Type the idea title with visible typing
  const titleInput = page.getByLabel(/title/i);
  await expect(titleInput).toBeVisible({ timeout: 10_000 });
  await titleInput.click();
  await titleInput.pressSequentially("Build a CLI Dashboard for DevOps Monitoring", {
    delay: 60,
  });
  await page.waitForTimeout(800);

  // Type a short description
  const descriptionField = page.locator('textarea, [contenteditable="true"]').first();
  await descriptionField.click();
  await descriptionField.pressSequentially(
    "A terminal-based dashboard for monitoring CI/CD pipelines, server health, and deployment status in real-time.",
    { delay: 40 }
  );
  await page.waitForTimeout(1500);

  // Show the form briefly, then navigate to pre-seeded idea for richer content
  await page.waitForTimeout(2000);

  // Navigate to the pre-seeded idea detail to show a complete idea page
  test.skip(!seeded, "No seeded data");
  await page.goto(`/ideas/${seeded!.primaryIdeaId}`);
  await expect(page.getByText("Love this concept")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3000);
});

// ── Scene 3: AI Board Generation (0:25 - 0:40) ──

test("scene-3-board-gen", async ({ page }) => {
  test.skip(!seeded, "No seeded data");

  // Navigate to the board page — it's already populated with seeded tasks
  await page.goto(`/ideas/${seeded!.primaryIdeaId}/board`);

  // Wait for columns to render
  const columns = page.locator('[data-testid^="column-"]');
  await expect(columns.first()).toBeVisible({ timeout: 15_000 });

  // Wait for task cards to appear
  const taskCards = page.locator('[data-testid^="task-card-"]');
  await expect(taskCards.first()).toBeVisible({ timeout: 10_000 });

  // Brief pause to show the full board
  await page.waitForTimeout(2000);

  // Slow horizontal scroll to show all columns
  await page.evaluate(() => {
    const boardContainer = document.querySelector('[class*="overflow-x"]');
    if (boardContainer) {
      boardContainer.scrollBy({ left: 400, behavior: "smooth" });
    }
  });
  await page.waitForTimeout(2000);

  // Scroll back
  await page.evaluate(() => {
    const boardContainer = document.querySelector('[class*="overflow-x"]');
    if (boardContainer) {
      boardContainer.scrollTo({ left: 0, behavior: "smooth" });
    }
  });
  await page.waitForTimeout(2000);
});

// ── Scene 4: Kanban Board Interaction (0:40 - 0:55) ──

test("scene-4-kanban", async ({ page }) => {
  test.skip(!seeded, "No seeded data");

  await page.goto(`/ideas/${seeded!.primaryIdeaId}/board`);

  // Wait for board to load
  const taskCards = page.locator('[data-testid^="task-card-"]');
  await expect(taskCards.first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);

  // Find a task in "To Do" column to drag to "In Progress"
  const toDoColumn = page.locator(`[data-testid="column-${seeded!.columnIds["To Do"]}"]`);
  const inProgressColumn = page.locator(`[data-testid="column-${seeded!.columnIds["In Progress"]}"]`);

  const toDoTask = toDoColumn.locator('[data-testid^="task-card-"]').first();
  if (await toDoTask.count() > 0) {
    await dragTaskToColumn(page, toDoTask, inProgressColumn);
    await page.waitForTimeout(1500);
  }

  // Click on a task card to open the detail dialog
  const targetTask = page.getByText("Implement ingredient parser API", { exact: true }).first();
  await expect(targetTask).toBeVisible({ timeout: 5_000 });
  await targetTask.click();

  // Wait for dialog
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByRole("tablist")).toBeVisible({ timeout: 5_000 });

  // Pause to show dialog contents: labels, checklist, due date, assignee
  await page.waitForTimeout(3000);

  // Close the dialog
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
});

// ── Scene 5: AI Agent Integration (0:55 - 1:15) ──

test("scene-5-agents", async ({ page }) => {
  // Dismiss the MCP banner via localStorage
  await page.addInitScript(() => {
    localStorage.setItem("agents-mcp-banner-dismissed", "true");
  });

  // Navigate to Agents Hub
  await page.goto("/agents");

  // Wait for page to load
  await expect(page.getByText(/Agents Hub|My Agents/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("CodeReviewer").first()).toBeVisible({ timeout: 10_000 });

  // Pan across agent cards
  await page.waitForTimeout(3000);

  // Navigate to MCP Integration guide
  await page.goto("/guide/mcp-integration");
  await expect(page.getByText("MCP Integration").first()).toBeVisible({ timeout: 15_000 });

  // Scroll down to show the claude mcp add command
  await page.evaluate(() =>
    window.scrollBy({ top: 300, behavior: "smooth" })
  );
  await page.waitForTimeout(3000);
});

// ── Scene 6: Wrap-up & End Card (1:15 - 1:30) ──

test("scene-6-wrapup", async ({ page }) => {
  test.skip(!seeded, "No seeded data");

  // Return to board showing task distribution
  await page.goto(`/ideas/${seeded!.primaryIdeaId}/board`);

  const columns = page.locator('[data-testid^="column-"]');
  await expect(columns.first()).toBeVisible({ timeout: 15_000 });

  const taskCards = page.locator('[data-testid^="task-card-"]');
  await expect(taskCards.first()).toBeVisible({ timeout: 10_000 });

  // Slow pan across the board
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    const boardContainer = document.querySelector('[class*="overflow-x"]');
    if (boardContainer) {
      boardContainer.scrollBy({ left: 600, behavior: "smooth" });
    }
  });
  await page.waitForTimeout(3000);

  // Scroll back for final view
  await page.evaluate(() => {
    const boardContainer = document.querySelector('[class*="overflow-x"]');
    if (boardContainer) {
      boardContainer.scrollTo({ left: 0, behavior: "smooth" });
    }
  });
  await page.waitForTimeout(3000);
});
