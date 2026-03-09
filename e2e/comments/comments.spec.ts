import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { test, expect } from "../fixtures/auth";
import {
  createTestIdea,
  createTestComment,
  cleanupIdeas,
  getTestUserId,
  scopedTitle,
} from "../fixtures/test-data";
import { supabaseAdmin } from "../fixtures/supabase-admin";

test.describe("Comments", () => {
  let userAId: string;
  let userBId: string;
  let ideaId: string;

  test.beforeAll(async () => {
    userAId = await getTestUserId("userA");
    userBId = await getTestUserId("userB");

    const idea = await createTestIdea(userAId, {
      title: scopedTitle("Comments Test Idea"),
      description: scopedTitle("An idea to test comment functionality."),
      tags: ["e2e-test", "comments"],
    });
    ideaId = idea.id;
  });

  test.afterAll(async () => {
    await cleanupIdeas([ideaId]);
  });

  // Clean up comments between tests to prevent accumulation/flakiness
  test.beforeEach(async () => {
    await supabaseAdmin.from("comments").delete().eq("idea_id", ideaId);
  });

  test.describe("Posting comments", () => {
    test("post a comment with default type", async ({ userAPage }) => {
      const commentText = scopedTitle("This is a test comment from User A");

      await userAPage.goto(`/ideas/${ideaId}`);
      const main = userAPage.getByRole('main');

      // Wait for the comment form to be visible
      const commentTextarea = main.getByPlaceholder(/add a comment/i);
      await expect(commentTextarea).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Type a comment — click first to focus, then fill
      await commentTextarea.click();
      await commentTextarea.fill(commentText);
      await userAPage.waitForTimeout(300);

      // The default type should already be "Comment" — just click Post
      const postButton = main.getByRole("button", { name: "Post" }).first();
      await expect(postButton).toBeEnabled({ timeout: 5_000 });

      // Wait for the server action response
      const actionPromise = userAPage.waitForResponse(
        (resp) => resp.url().includes("ideas") && resp.request().method() === "POST",
        { timeout: EXPECT_TIMEOUT }
      );
      await postButton.click();
      await actionPromise;

      // Reload for fresh server data (revalidatePath may not update client immediately)
      await userAPage.reload();
      const mainAfterReload = userAPage.getByRole('main');

      // The comment should appear in the thread
      await expect(
        mainAfterReload.getByText(commentText)
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Author name should be shown
      await expect(
        mainAfterReload.getByText("Test User A").first()
      ).toBeVisible();
    });

    test("post a suggestion comment", async ({ userAPage }) => {
      const commentText = scopedTitle("This is a suggestion for improving the idea");

      await userAPage.goto(`/ideas/${ideaId}`);
      const main = userAPage.getByRole('main');

      const commentTextarea = main.getByPlaceholder(/add a comment/i);
      await commentTextarea.scrollIntoViewIfNeeded();
      await expect(commentTextarea).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Ensure Post button is in its default disabled state (empty textarea)
      const postButton = main.getByRole("button", { name: "Post" }).first();
      await expect(postButton).toBeDisabled();

      // Change the comment type to Suggestion via the Radix Select
      const typeSelect = commentTextarea.locator("xpath=following::button[@role='combobox']").first();
      await typeSelect.scrollIntoViewIfNeeded();
      await typeSelect.click();
      const suggestionOption = userAPage.getByRole("option", { name: "Suggestion" });
      await expect(suggestionOption).toBeVisible({ timeout: 5_000 });
      await suggestionOption.click();
      await expect(typeSelect).toHaveText(/Suggestion/);

      // Fill the textarea
      await commentTextarea.click();
      await commentTextarea.fill(commentText);
      await userAPage.waitForTimeout(300);

      // Submit
      await expect(postButton).toBeEnabled({ timeout: 5_000 });

      const actionPromise = userAPage.waitForResponse(
        (resp) => resp.url().includes("ideas") && resp.request().method() === "POST",
        { timeout: EXPECT_TIMEOUT }
      );
      await postButton.click();
      await actionPromise;

      // Reload for fresh server data
      await userAPage.reload();
      const mainAfterReload = userAPage.getByRole('main');

      // Comment should appear after reload
      await expect(
        mainAfterReload.getByText(commentText)
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // The Suggestion badge should be visible near the comment
      await expect(
        mainAfterReload.locator('[data-slot="badge"]').filter({ hasText: "Suggestion" }).first()
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("post a question comment", async ({ userAPage }) => {
      const commentText = scopedTitle("What is the expected timeline for this idea?");

      await userAPage.goto(`/ideas/${ideaId}`);
      const main = userAPage.getByRole('main');

      const commentTextarea = main.getByPlaceholder(/add a comment/i);
      await commentTextarea.scrollIntoViewIfNeeded();
      await expect(commentTextarea).toBeVisible({ timeout: EXPECT_TIMEOUT });

      const postButton = main.getByRole("button", { name: "Post" }).first();
      await expect(postButton).toBeDisabled();

      // Change type to Question
      const typeSelect = commentTextarea.locator("xpath=following::button[@role='combobox']").first();
      await typeSelect.scrollIntoViewIfNeeded();
      await typeSelect.click();
      const questionOption = userAPage.getByRole("option", { name: "Question" });
      await expect(questionOption).toBeVisible({ timeout: 5_000 });
      await questionOption.click();
      await expect(typeSelect).toHaveText(/Question/);

      // Fill the textarea
      await commentTextarea.click();
      await commentTextarea.fill(commentText);
      await userAPage.waitForTimeout(300);

      // Submit
      await expect(postButton).toBeEnabled({ timeout: 5_000 });

      const actionPromise = userAPage.waitForResponse(
        (resp) => resp.url().includes("ideas") && resp.request().method() === "POST",
        { timeout: EXPECT_TIMEOUT }
      );
      await postButton.click();
      await actionPromise;

      // Reload for fresh server data
      await userAPage.reload();
      const mainAfterReload = userAPage.getByRole('main');

      await expect(
        mainAfterReload.getByText(commentText)
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // The Question badge should be visible
      await expect(
        mainAfterReload.locator('[data-slot="badge"]').filter({ hasText: "Question" }).first()
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });

    test("comment appears in thread with author name and content", async ({
      userBPage,
    }) => {
      // Seed a comment from User A via the API — capture the text once
      const commentText = scopedTitle("Seeded comment for thread verification");
      await createTestComment(ideaId, userAId, {
        content: commentText,
        type: "comment",
      });

      await userBPage.goto(`/ideas/${ideaId}`);
      const main = userBPage.getByRole('main');

      // The seeded comment should be visible
      await expect(
        main.getByText(commentText)
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Author name should be displayed
      await expect(main.getByText("Test User A").first()).toBeVisible();
    });
  });

  test.describe("Replying to comments", () => {
    test("reply to a comment creates a nested reply", async ({
      userBPage,
    }) => {
      // Seed a top-level comment from User A — capture text once
      const parentText = scopedTitle("Parent comment for reply test");
      await createTestComment(ideaId, userAId, {
        content: parentText,
        type: "comment",
      });

      await userBPage.goto(`/ideas/${ideaId}`);
      const main = userBPage.getByRole('main');

      // Find the parent comment and click Reply
      const parentComment = main.getByText(parentText);
      await expect(parentComment).toBeVisible({ timeout: EXPECT_TIMEOUT });

      const commentContainer = parentComment
        .locator("xpath=ancestor::div[contains(@class, 'py-3')]")
        .first();
      const replyButton = commentContainer.getByRole("button", {
        name: "Reply",
      });
      await replyButton.click();

      // Reply form should appear
      const replyTextarea = main.getByPlaceholder(/write a reply/i);
      await expect(replyTextarea).toBeVisible();

      // Type and submit a reply — capture text once
      const replyText = scopedTitle("This is a reply from User B");
      await replyTextarea.fill(replyText);
      await userBPage.waitForTimeout(300);

      const replyPostButton = replyTextarea
        .locator("xpath=ancestor::form[1]")
        .getByRole("button", { name: "Post" });
      await expect(replyPostButton).toBeEnabled({ timeout: 5_000 });

      const actionPromise = userBPage.waitForResponse(
        (resp) => resp.url().includes("ideas") && resp.request().method() === "POST",
        { timeout: EXPECT_TIMEOUT }
      );
      await replyPostButton.click();
      await actionPromise;

      // Reload for fresh server data
      await userBPage.reload();
      const mainAfterReload = userBPage.getByRole('main');

      // The reply should appear
      await expect(
        mainAfterReload.getByText(replyText)
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Reply author
      await expect(mainAfterReload.getByText("Test User B").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
    });
  });

  test.describe("Deleting comments", () => {
    test("delete own comment shows undo toast", async ({ userAPage }) => {
      // Seed a comment from User A — capture text once
      const commentText = scopedTitle("Comment to be deleted by author");
      await createTestComment(ideaId, userAId, {
        content: commentText,
        type: "comment",
      });

      await userAPage.goto(`/ideas/${ideaId}`);
      const main = userAPage.getByRole('main');

      // Find the comment
      const comment = main.getByText(commentText);
      await expect(comment).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Find the Delete button in the same comment item
      const commentContainer = comment
        .locator("xpath=ancestor::div[contains(@class, 'py-3')]")
        .first();
      const deleteButton = commentContainer.getByRole("button", {
        name: "Delete",
      });
      await expect(deleteButton).toBeVisible();
      await deleteButton.click();

      // Comment should disappear (optimistic removal)
      await expect(comment).not.toBeVisible();

      // Undo toast should appear
      const toast = userAPage
        .locator("[data-sonner-toast]")
        .filter({ hasText: /comment deleted/i });
      await expect(toast).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Toast should have Undo button
      await expect(
        toast.getByRole("button", { name: "Undo" })
      ).toBeVisible();
    });

    test("cannot delete another user's comment (no delete button)", async ({
      userBPage,
    }) => {
      // Seed a comment from User A — capture text once
      const commentText = scopedTitle("User A comment that User B should not delete");
      await createTestComment(ideaId, userAId, {
        content: commentText,
        type: "comment",
      });

      await userBPage.goto(`/ideas/${ideaId}`);
      const main = userBPage.getByRole('main');

      // Find the comment
      const comment = main.getByText(commentText);
      await expect(comment).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // The comment container should NOT have a Delete button for User B
      const commentContainer = comment
        .locator("xpath=ancestor::div[contains(@class, 'py-3')]")
        .first();

      // There should be a Reply button but no Delete button
      await expect(
        commentContainer.getByRole("button", { name: "Reply" })
      ).toBeVisible();
      await expect(
        commentContainer.getByRole("button", { name: "Delete" })
      ).not.toBeVisible();
    });
  });

  test.describe("Incorporating suggestions", () => {
    test("author marks suggestion as incorporated", async ({
      userAPage,
    }) => {
      // Seed a suggestion comment from User B — capture text once
      const suggestionText = scopedTitle("Suggestion to incorporate");
      await createTestComment(ideaId, userBId, {
        content: suggestionText,
        type: "suggestion",
      });

      await userAPage.goto(`/ideas/${ideaId}`);
      const main = userAPage.getByRole('main');

      // Find the suggestion comment
      const suggestion = main.getByText(suggestionText);
      await expect(suggestion).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // Find the "Mark as incorporated" button
      const incorporateButton = main.getByRole("button", {
        name: /mark as incorporated/i,
      });
      await expect(incorporateButton).toBeVisible({ timeout: 10_000 });
      await incorporateButton.click();

      // After incorporating, the "Incorporated" badge should appear
      await expect(
        main.getByText("Incorporated", { exact: true }).first()
      ).toBeVisible({ timeout: EXPECT_TIMEOUT });

      // The "Mark as incorporated" button should no longer be visible
      await expect(incorporateButton).not.toBeVisible();
    });
  });
});
