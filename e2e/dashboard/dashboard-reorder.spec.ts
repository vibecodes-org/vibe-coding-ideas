import { test, expect } from "../fixtures/auth";
import { createTestIdea, createTestBoardWithTasks, cleanupIdeas } from "../fixtures/test-data";
import { supabaseAdmin } from "../fixtures/supabase-admin";

async function getUserId(fullName: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("full_name", fullName)
    .single();
  if (!data) throw new Error(`Test user not found: ${fullName}`);
  return data.id;
}

let userAId: string;
let reorderIdeaId: string;

test.beforeAll(async () => {
  userAId = await getUserId("Test User A");

  // Create an idea with a board so Active Boards section appears
  const idea = await createTestIdea(userAId, {
    title: "[E2E] Reorder Board Idea",
    description: "[E2E] Idea to ensure board section renders.",
  });
  reorderIdeaId = idea.id;
  await createTestBoardWithTasks(idea.id, 1);
});

test.afterAll(async () => {
  await cleanupIdeas([reorderIdeaId]);
});

test.describe("Dashboard Reorder", () => {
  test.beforeEach(async ({ userAPage }) => {
    // Bump updated_at so the test idea's board appears in dashboard top 5
    await supabaseAdmin
      .from("ideas")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", reorderIdeaId);

    // Clear any stored panel order before each test
    await userAPage.goto("/dashboard");
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });
    await userAPage.evaluate(() => localStorage.removeItem("dashboard-panel-order"));
    await userAPage.reload();
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });
  });

  test.afterEach(async ({ userAPage }) => {
    // Clean up localStorage after each test
    await userAPage.evaluate(() => localStorage.removeItem("dashboard-panel-order"));
  });

  test("enter Customize mode shows drag handles and controls", async ({ userAPage }) => {
    // Click "Customize" button
    const customizeButton = userAPage.getByRole("button", { name: "Customize" });
    await expect(customizeButton).toBeVisible({ timeout: 15_000 });
    await customizeButton.click();

    // Should now show "Done" button instead
    await expect(
      userAPage.getByRole("button", { name: "Done" })
    ).toBeVisible();

    // Should show "Reset" button
    await expect(
      userAPage.getByRole("button", { name: "Reset" })
    ).toBeVisible();

    // Drag handles should be visible for sections
    await expect(
      userAPage.getByRole("button", { name: /Drag My Ideas to reorder/i })
    ).toBeVisible();

    await expect(
      userAPage.getByRole("button", { name: /Drag Active Boards to reorder/i })
    ).toBeVisible();
  });

  test("drag panel to reorder within column", async ({ userAPage }) => {
    // Enter customize mode
    await userAPage.getByRole("button", { name: "Customize" }).click();

    // Get the section labels to verify initial order
    // Default right column: My Ideas, Collaborations, Recent Activity
    const myIdeasHandle = userAPage.getByRole("button", { name: /Drag My Ideas to reorder/i });
    const collaborationsHandle = userAPage.getByRole("button", { name: /Drag Collaborations to reorder/i });

    await expect(myIdeasHandle).toBeVisible();
    await expect(collaborationsHandle).toBeVisible();

    // Drag "My Ideas" below "Collaborations"
    await myIdeasHandle.dragTo(collaborationsHandle);

    // Exit customize mode to persist
    await userAPage.getByRole("button", { name: "Done" }).click();

    // Verify localStorage was written
    const storedOrder = await userAPage.evaluate(() =>
      localStorage.getItem("dashboard-panel-order")
    );
    expect(storedOrder).toBeTruthy();
  });

  test("persist reorder in localStorage across reload", async ({ userAPage }) => {
    // Enter customize mode
    await userAPage.getByRole("button", { name: "Customize" }).click();

    // Drag "My Ideas" below "Collaborations"
    const myIdeasHandle = userAPage.getByRole("button", { name: /Drag My Ideas to reorder/i });
    const collaborationsHandle = userAPage.getByRole("button", { name: /Drag Collaborations to reorder/i });
    await myIdeasHandle.dragTo(collaborationsHandle);

    // Exit customize mode
    await userAPage.getByRole("button", { name: "Done" }).click();

    // Verify localStorage was written with valid data
    const storedOrder = await userAPage.evaluate(() =>
      localStorage.getItem("dashboard-panel-order")
    );
    expect(storedOrder).toBeTruthy();
    const parsed = JSON.parse(storedOrder!);
    expect(Array.isArray(parsed)).toBe(true);

    // Reload the page
    await userAPage.reload();
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    // Verify order persisted by checking localStorage is still there
    const storedAfterReload = await userAPage.evaluate(() =>
      localStorage.getItem("dashboard-panel-order")
    );
    expect(storedAfterReload).toBeTruthy();
  });

  test("reset restores default order", async ({ userAPage }) => {
    // Manually set a custom order in localStorage
    await userAPage.evaluate(() => {
      localStorage.setItem(
        "dashboard-panel-order",
        JSON.stringify([
          { id: "my-tasks", column: 0 },
          { id: "active-boards", column: 0 },
          { id: "my-bots", column: 0 },
          { id: "recent-activity", column: 1 },
          { id: "collaborations", column: 1 },
          { id: "my-ideas", column: 1 },
        ])
      );
    });
    await userAPage.reload();
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    // Enter customize mode
    await userAPage.getByRole("button", { name: "Customize" }).click();

    // Click "Reset" button
    await userAPage.getByRole("button", { name: "Reset" }).click();

    // Exit customize mode
    await userAPage.getByRole("button", { name: "Done" }).click();

    // localStorage should be cleared
    const storedOrder = await userAPage.evaluate(() =>
      localStorage.getItem("dashboard-panel-order")
    );
    expect(storedOrder).toBeNull();
  });
});
