import { test, expect } from "../fixtures/auth";
import {
  createTestIdea,
  addCollaborator,
  createTestComment,
  cleanupIdeas,
  scopedTitle,
} from "../fixtures/test-data";
import { supabaseAdmin } from "../fixtures/supabase-admin";

let userAId: string;
let userBId: string;
let ideaId: string;
let collabIdeaId: string;

// Capture scoped titles once so assertions match what was created
const ideaTitle = scopedTitle("Profile Test Idea");
const collabTitle = scopedTitle("Collab Idea for Profile");
const commentContent = scopedTitle("Profile comment test content");

test.beforeAll(async () => {
  const { data: users } = await supabaseAdmin
    .from("users")
    .select("id, full_name")
    .in("full_name", ["Test User A", "Test User B"]);

  const userA = users?.find((u) => u.full_name === "Test User A");
  const userB = users?.find((u) => u.full_name === "Test User B");
  if (!userA || !userB)
    throw new Error("Test users not found — run global setup first");

  userAId = userA.id;
  userBId = userB.id;

  // Create an idea by User A
  const idea = await createTestIdea(userAId, {
    title: ideaTitle,
    description: "An idea for profile tab testing",
    tags: ["e2e-test"],
  });
  ideaId = idea.id;

  // Create an idea by User B that User A collaborates on
  const collabIdea = await createTestIdea(userBId, {
    title: collabTitle,
    description: "User A collaborates on this idea",
    tags: ["e2e-test"],
  });
  collabIdeaId = collabIdea.id;
  await addCollaborator(collabIdeaId, userAId);

  // Create a comment by User A on their own idea
  await createTestComment(ideaId, userAId, {
    content: commentContent,
  });
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId, collabIdeaId]);
});

test.describe("Profile page", () => {
  test("displays own profile with tabs (Ideas, Collaborations, Comments)", async ({
    userAPage,
  }) => {
    await userAPage.goto(`/profile/${userAId}`);

    // Profile header should show the user's name
    await expect(
      userAPage.getByRole("heading", { name: "Test User A" })
    ).toBeVisible({ timeout: 15_000 });

    // Stats should be visible — scope to the stats grid to avoid matching tab labels
    const statsGrid = userAPage.locator(".grid.grid-cols-3");
    await expect(statsGrid.getByText("Ideas")).toBeVisible();
    await expect(statsGrid.getByText("Collaborating")).toBeVisible();
    await expect(statsGrid.getByText("Comments")).toBeVisible();

    // Tab triggers should be visible
    await expect(
      userAPage.getByRole("tab", { name: /My Ideas/i })
    ).toBeVisible();
    await expect(
      userAPage.getByRole("tab", { name: /Collaborating/i })
    ).toBeVisible();
    await expect(
      userAPage.getByRole("tab", { name: /Comments/i })
    ).toBeVisible();

    // Edit Profile button should be visible on own profile
    await expect(
      userAPage.getByRole("button", { name: /edit profile/i })
    ).toBeVisible();
  });

  test("viewing another user's profile is read-only (no edit buttons)", async ({
    userBPage,
  }) => {
    await userBPage.goto(`/profile/${userAId}`);

    // Should see User A's name
    await expect(
      userBPage.getByRole("heading", { name: "Test User A" })
    ).toBeVisible({ timeout: 15_000 });

    // Tabs should show "Ideas" (not "My Ideas") for another user
    await expect(
      userBPage.getByRole("tab", { name: /^Ideas/i })
    ).toBeVisible();

    // Edit Profile button should NOT be visible
    await expect(
      userBPage.getByRole("button", { name: /edit profile/i })
    ).not.toBeVisible();
  });

  test("Ideas tab shows user's ideas", async ({ userAPage }) => {
    await userAPage.goto(`/profile/${userAId}`);

    // The "My Ideas" tab should be active by default
    await expect(
      userAPage.getByRole("tab", { name: /My Ideas/i })
    ).toBeVisible({ timeout: 15_000 });

    // The test idea should appear in the Ideas tab
    await expect(
      userAPage.getByText(ideaTitle).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Collaborations tab shows ideas user collaborates on", async ({
    userAPage,
  }) => {
    await userAPage.goto(`/profile/${userAId}`);

    // Click the Collaborating tab
    const collabTab = userAPage.getByRole("tab", { name: /Collaborating/i });
    await expect(collabTab).toBeVisible({ timeout: 15_000 });
    await collabTab.click();

    // The collab idea should appear
    await expect(
      userAPage.getByText(collabTitle).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Comments tab shows user's comments", async ({ userAPage }) => {
    await userAPage.goto(`/profile/${userAId}`);

    // Click the Comments tab
    const commentsTab = userAPage.getByRole("tab", { name: /Comments/i });
    await expect(commentsTab).toBeVisible({ timeout: 15_000 });
    await commentsTab.click();

    // The test comment should appear
    await expect(
      userAPage.getByText(commentContent).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
