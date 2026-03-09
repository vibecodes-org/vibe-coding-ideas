import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { test, expect } from "../fixtures/auth";
import { getTestUserId } from "../fixtures/test-data";
import { supabaseAdmin } from "../fixtures/supabase-admin";

let userAId: string;

test.beforeAll(async () => {
  userAId = await getTestUserId("userA");
});

test.afterAll(async () => {
  // Clean up all bots owned by Test User A (E2E bots + team-cloned bots)
  const { data: bots } = await supabaseAdmin
    .from("bot_profiles")
    .select("id, name")
    .eq("owner_id", userAId);

  if (bots && bots.length > 0) {
    for (const bot of bots) {
      await supabaseAdmin.rpc("delete_bot_user", {
        p_bot_id: bot.id,
        p_owner_id: userAId,
      });
    }
  }
});

test.describe("Agent management", () => {
  test("create a new agent", async ({ userAPage }) => {
    await userAPage.goto("/agents");
    const main = userAPage.getByRole("main");

    // The "Agents Hub" h1 heading should be visible (page was renamed from "My Agents")
    await expect(main.locator("h1").filter({ hasText: "Agents Hub" })).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Click "Create Agent" (may appear in both header and empty state)
    const createButton = main.getByRole("button", { name: /create agent/i }).first();
    await expect(createButton).toBeVisible();
    await createButton.click();

    // Dialog should open
    const dialog = userAPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Create Agent" })).toBeVisible();

    // Fill agent name
    await dialog.getByLabel("Name").fill("E2E Test Bot Alpha");

    // Fill role
    await dialog.getByLabel("Role").fill("Developer");

    // Submit
    await dialog.getByRole("button", { name: "Create" }).click();

    // Success toast (server action may take a moment)
    const toast = userAPage
      .locator("[data-sonner-toast]")
      .filter({ hasText: /agent created/i });
    await expect(toast).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Dialog should close
    await expect(dialog).not.toBeVisible();

    // The new agent should appear in the list
    await expect(
      main.getByText("E2E Test Bot Alpha")
    ).toBeVisible({ timeout: 10_000 });
  });

  test("edit agent details", async ({ userAPage }) => {
    // Ensure a bot exists to edit
    const { data: existingBots } = await supabaseAdmin
      .from("bot_profiles")
      .select("id, name")
      .eq("owner_id", userAId)
      .like("name", "%E2E%");

    if (!existingBots || existingBots.length === 0) {
      // Create one via the admin client
      await supabaseAdmin.rpc("create_bot_user", {
        p_name: "E2E Edit Bot",
        p_owner_id: userAId,
        p_role: "Tester",
        p_system_prompt: null,
        p_avatar_url: null,
      });
    }

    await userAPage.goto("/agents");
    const main = userAPage.getByRole("main");

    // Find the "Edit" button next to an agent
    const editButton = main
      .getByRole("button", { name: /^edit$/i })
      .first();
    await expect(editButton).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await editButton.click();

    // Edit dialog should open
    const dialog = userAPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Edit Agent")).toBeVisible();

    // Change the name
    const nameInput = dialog.getByLabel("Name");
    await nameInput.clear();
    await nameInput.fill("E2E Renamed Bot");

    // Save
    await dialog.getByRole("button", { name: "Save" }).click();

    // Success toast
    const toast = userAPage
      .locator("[data-sonner-toast]")
      .filter({ hasText: /agent updated/i });
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // Dialog should close
    await expect(dialog).not.toBeVisible();

    // The renamed agent should appear in the list
    await expect(
      main.getByText("E2E Renamed Bot")
    ).toBeVisible({ timeout: 10_000 });
  });

  test("toggle publish to community via edit dialog", async ({ userAPage }) => {
    // Ensure a bot exists
    const { data: existingBots } = await supabaseAdmin
      .from("bot_profiles")
      .select("id, name")
      .eq("owner_id", userAId)
      .like("name", "%E2E%");

    if (!existingBots || existingBots.length === 0) {
      await supabaseAdmin.rpc("create_bot_user", {
        p_name: "E2E Toggle Bot",
        p_owner_id: userAId,
        p_role: "Developer",
        p_system_prompt: null,
        p_avatar_url: null,
      });
    }

    await userAPage.goto("/agents");
    const main = userAPage.getByRole("main");

    // Find and hover over an agent card to reveal the edit button
    const editButton = main.getByRole("button", { name: /^edit$/i }).first();
    await editButton.waitFor({ state: "attached", timeout: EXPECT_TIMEOUT });
    // The edit button is hidden until hover — force click it
    await editButton.click({ force: true });

    // Edit dialog should open
    const dialog = userAPage.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Find the "Publish to Community" switch
    const publishSwitch = dialog.locator("button[role='switch']").first();
    await expect(publishSwitch).toBeVisible();

    // Get initial state
    const initialState = await publishSwitch.getAttribute("data-state");

    // Click to toggle
    await publishSwitch.click();

    // The switch state should change
    await expect(publishSwitch).not.toHaveAttribute("data-state", initialState!, { timeout: 5_000 });

    // Save the change
    await dialog.getByRole("button", { name: "Save" }).click();

    // Success toast
    const toast = userAPage
      .locator("[data-sonner-toast]")
      .filter({ hasText: /agent updated/i });
    await expect(toast).toBeVisible({ timeout: 5_000 });
  });

  test("add a featured team", async ({ userAPage }) => {
    await userAPage.goto("/agents");
    const main = userAPage.getByRole("main");

    // Switch to Browse tab (use exact match to avoid matching "Browse Agents" button)
    const browseTab = main.getByRole("button", { name: "Browse", exact: true });
    await expect(browseTab).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await browseTab.click();

    // Wait for featured teams section to load
    await expect(main.getByText("Featured Teams")).toBeVisible({ timeout: 10_000 });

    // Find the first team with an "Add Team" button (not all-added)
    const addTeamButton = main
      .getByRole("button", { name: /add team|add \d+ remaining/i })
      .first();
    await expect(addTeamButton).toBeVisible({ timeout: 5_000 });

    // Click to add the team
    await addTeamButton.click();

    // Should see a success toast about agents being created
    const toast = userAPage
      .locator("[data-sonner-toast]")
      .filter({ hasText: /created \d+ agent|already exist/i });
    await expect(toast).toBeVisible({ timeout: 10_000 });

    // Switch to My Agents tab to confirm the agents appeared
    const myAgentsTab = main.getByRole("button", { name: /my agents/i });
    await myAgentsTab.click();

    // There should be at least one agent card visible
    await expect(
      main.locator("[class*='grid'] a, [class*='grid'] button").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("delete an agent", async ({ userAPage }) => {
    // Create a specific bot for deletion
    await supabaseAdmin.rpc("create_bot_user", {
      p_name: "E2E Delete Me Bot",
      p_owner_id: userAId,
      p_role: "QA",
      p_system_prompt: null,
      p_avatar_url: null,
    });

    await userAPage.goto("/agents");
    const main = userAPage.getByRole("main");

    // The agent should be visible
    await expect(
      main.getByText("E2E Delete Me Bot")
    ).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Find the agent card for the target bot, then click its Edit button
    // Edit button is hidden until hover (opacity-0 → group-hover:opacity-100), so force click
    const targetCard = main.locator("a, button").filter({ hasText: "E2E Delete Me Bot" }).first();
    const editButton = targetCard.getByRole("button", { name: /edit/i });
    await editButton.click({ force: true });

    // Edit dialog should open
    const dialog = userAPage.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Click "Delete" button (first click shows confirmation)
    const deleteButton = dialog.getByRole("button", { name: /delete/i });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    // Confirmation state: text changes to "Are you sure?"
    await expect(
      dialog.getByRole("button", { name: /are you sure/i })
    ).toBeVisible({ timeout: 3_000 });

    // Click again to confirm
    await dialog.getByRole("button", { name: /are you sure/i }).click();

    // Success toast
    const toast = userAPage
      .locator("[data-sonner-toast]")
      .filter({ hasText: /agent deleted/i });
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // Dialog should close
    await expect(dialog).not.toBeVisible();

    // The agent should no longer appear in the list
    await expect(
      main.getByText("E2E Delete Me Bot")
    ).not.toBeVisible({ timeout: 5_000 });
  });
});
