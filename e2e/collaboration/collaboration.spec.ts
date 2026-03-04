import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { test, expect } from "../fixtures/auth";
import {
  createTestIdea,
  addCollaborator,
  cleanupTestData,
  getTestUserId,
  scopedTitle,
} from "../fixtures/test-data";
import { supabaseAdmin } from "../fixtures/supabase-admin";

test.describe("Collaboration", () => {
  let userAId: string;
  let userBId: string;
  let publicIdeaId: string;
  let privateIdeaId: string;

  test.beforeAll(async () => {
    userAId = await getTestUserId("userA");
    userBId = await getTestUserId("userB");

    // Create a public idea owned by User A
    const publicIdea = await createTestIdea(userAId, {
      title: scopedTitle("Collaboration Public Idea"),
      description: scopedTitle("A public idea to test collaboration features."),
      tags: ["e2e-test", "collaboration"],
      visibility: "public",
    });
    publicIdeaId = publicIdea.id;

    // Create a private idea owned by User A
    const privateIdea = await createTestIdea(userAId, {
      title: scopedTitle("Collaboration Private Idea"),
      description: scopedTitle("A private idea that should not be visible to non-collaborators."),
      tags: ["e2e-test", "private"],
      visibility: "private",
    });
    privateIdeaId = privateIdea.id;
  });

  test.afterAll(async () => {
    await cleanupTestData();
  });

  test.describe("Self-join and leave (User B)", () => {
    test("User B requests collaboration by clicking the join button", async ({
      userBPage,
    }) => {
      // Clean up any existing requests from previous runs
      await supabaseAdmin
        .from("collaboration_requests")
        .delete()
        .eq("idea_id", publicIdeaId)
        .eq("requester_id", userBId);

      await userBPage.goto(`/ideas/${publicIdeaId}`);
      const main = userBPage.getByRole('main');

      // The collaborator button should say "I want to build this" for non-collaborators
      const joinButton = main.getByRole("button", {
        name: /i want to build this/i,
      });
      await expect(joinButton).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await expect(joinButton).toBeEnabled({ timeout: EXPECT_TIMEOUT });

      // Click to request collaboration
      await joinButton.click();

      // After requesting, button text should change to "Requested" (pending approval)
      const requestedButton = main.getByRole("button", {
        name: /requested/i,
      });
      await expect(requestedButton).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // A success toast should appear
      await expect(
        userBPage.locator("[data-sonner-toast]").filter({ hasText: /request sent/i })
      ).toBeVisible({ timeout: 10_000 });
    });

    test("User B appears in the collaborators list after joining", async ({
      userBPage,
    }) => {
      // Ensure User B is a collaborator (may already be from previous test)
      await addCollaborator(publicIdeaId, userBId);

      await userBPage.goto(`/ideas/${publicIdeaId}`);
      const main = userBPage.getByRole('main');

      // Wait for the collaborators section to render
      const collaboratorsSection = main.getByText(/Collaborators \(/);
      await expect(collaboratorsSection).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // User B's name should appear in the collaborators list
      await expect(main.getByText("Test User B")).toBeVisible();
    });

    test("User B leaves the project by clicking Leave button", async ({
      userBPage,
    }) => {
      // Clean up any pending collaboration requests from previous tests
      await supabaseAdmin
        .from("collaboration_requests")
        .delete()
        .eq("idea_id", publicIdeaId)
        .eq("requester_id", userBId);

      // Ensure User B is a collaborator first
      await addCollaborator(publicIdeaId, userBId);

      await userBPage.goto(`/ideas/${publicIdeaId}`);
      const main = userBPage.getByRole('main');

      // The button should show "Leave Project" since User B is a collaborator
      const leaveButton = main.getByRole("button", {
        name: /leave project/i,
      });
      await expect(leaveButton).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Click to leave and wait for the server action to complete
      const actionPromise = userBPage.waitForResponse(
        (resp) => resp.url().includes("ideas") && resp.request().method() === "POST",
        { timeout: 10_000 }
      );
      await leaveButton.click();
      await actionPromise;

      // Button should revert to join state after revalidation
      // revalidatePath may not trigger a full re-render in time, so reload as fallback
      const joinButton = main.getByRole("button", {
        name: /i want to build this/i,
      });
      try {
        await expect(joinButton).toBeVisible({ timeout: 5_000 });
      } catch {
        await userBPage.reload();
        await expect(
          userBPage.getByRole("main").getByRole("button", {
            name: /i want to build this/i,
          })
        ).toBeVisible({ timeout: 10_000 });
      }
    });
  });

  test.describe("Author manages collaborators (User A)", () => {
    test("Author adds collaborator via search popover", async ({
      userAPage,
    }) => {
      // Remove User B if already a collaborator to start clean
      await supabaseAdmin
        .from("collaborators")
        .delete()
        .eq("idea_id", publicIdeaId)
        .eq("user_id", userBId);

      // Clean up any pending collaboration requests that could interfere
      await supabaseAdmin
        .from("collaboration_requests")
        .delete()
        .eq("idea_id", publicIdeaId)
        .eq("requester_id", userBId);

      await userAPage.goto(`/ideas/${publicIdeaId}`);
      const main = userAPage.getByRole('main');

      // Wait for Collaborators (0) to confirm clean state
      await expect(
        main.getByText(/Collaborators \(0\)/)
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Click the "Add" button to open the collaborator search popover
      const addButton = main.getByRole("button", { name: "Add", exact: true });
      await expect(addButton).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await addButton.click();

      // Search for User B by name in the popover input
      const searchInput = userAPage.getByPlaceholder(
        /search by name or email/i
      );
      await expect(searchInput).toBeVisible();

      // Search with retry — clear and re-type if "No users found" appears (handles auth token refresh races)
      const userBResult = userAPage.getByRole("button").filter({ hasText: "Test User B" }).first();
      for (let attempt = 0; attempt < 3; attempt++) {
        await searchInput.clear();
        await searchInput.fill("Test User B");
        try {
          await expect(userBResult).toBeVisible({ timeout: 5_000 });
          break;
        } catch {
          if (attempt === 2) {
            // Final attempt — use full timeout
            await searchInput.clear();
            await searchInput.fill("Test User B");
            await expect(userBResult).toBeVisible({ timeout: EXPECT_TIMEOUT });
          }
        }
      }

      // Click the result to add User B and wait for the server action response
      const actionPromise = userAPage.waitForResponse(
        (resp) => resp.url().includes("ideas") && resp.request().method() === "POST",
        { timeout: EXPECT_TIMEOUT }
      );
      await userBResult.click();
      await actionPromise;

      // Wait for revalidation to update the collaborator count
      await expect(
        main.getByText(/Collaborators \(1\)/)
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Reload the page to verify the collaborator persisted
      await userAPage.reload();
      const mainAfterReload = userAPage.getByRole('main');

      // Verify User B appears in the collaborators section
      const collaboratorsSection = mainAfterReload.getByText(/Collaborators \(/);
      await expect(collaboratorsSection).toBeVisible({ timeout: EXPECT_TIMEOUT });
      await expect(mainAfterReload.getByText("Test User B")).toBeVisible();
    });

    test("Author removes collaborator and undo toast appears", async ({
      userAPage,
    }) => {
      // Ensure User B is a collaborator
      await addCollaborator(publicIdeaId, userBId);

      await userAPage.goto(`/ideas/${publicIdeaId}`);
      const main = userAPage.getByRole('main');

      // Wait for collaborators section to render
      await expect(
        main.getByText(/Collaborators \(/)
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Find the remove button (X icon) next to User B's name
      const removeButton = main.getByRole("button", {
        name: "Remove collaborator",
      });
      await expect(removeButton).toBeVisible();
      await removeButton.click();

      // Undo toast should appear
      const toast = userAPage
        .locator("[data-sonner-toast]")
        .filter({ hasText: /removed/i });
      await expect(toast).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Toast should contain an Undo action button
      const undoButton = toast.getByRole("button", { name: "Undo" });
      await expect(undoButton).toBeVisible();
    });

    test("Clicking Undo in toast restores the collaborator", async ({
      userAPage,
    }) => {
      // Ensure User B is a collaborator
      await addCollaborator(publicIdeaId, userBId);

      await userAPage.goto(`/ideas/${publicIdeaId}`);
      const main = userAPage.getByRole('main');

      // Wait for collaborators section
      await expect(
        main.getByText(/Collaborators \(/)
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Verify User B is shown
      await expect(main.getByText("Test User B")).toBeVisible();

      // Remove the collaborator
      const removeButton = main.getByRole("button", {
        name: "Remove collaborator",
      });
      await removeButton.click();

      // The remove button itself disappears (optimistic), and undo toast appears
      const toast = userAPage
        .locator("[data-sonner-toast]")
        .filter({ hasText: /removed/i });
      await expect(toast).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Click Undo in the toast
      await toast.getByRole("button", { name: "Undo" }).click();

      // The remove button should reappear after undo (the collaborator was restored)
      await expect(
        main.getByRole("button", { name: "Remove collaborator" })
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });
  });

  test.describe("Private idea visibility", () => {
    test("User B cannot see User A's private idea", async ({
      userBPage,
    }) => {
      await userBPage.goto(`/ideas/${privateIdeaId}`);

      // Should show 404 / not found page, or redirect away
      // The server returns notFound() which renders the default Next.js not-found page
      await expect(
        userBPage.getByText(/could not be found|not found/i).first()
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });
  });
});
