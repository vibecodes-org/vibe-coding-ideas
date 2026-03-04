import { describe, it, expect } from "vitest";
import { buildReplyTree } from "./discussion-thread";
import type {
  IdeaDiscussionReplyWithAuthor,
  IdeaDiscussionReplyWithChildren,
} from "@/types";

// ---------------------------------------------------------------------------
// Helper to create a mock reply
// ---------------------------------------------------------------------------

function makeReply(
  overrides: Partial<IdeaDiscussionReplyWithAuthor> & { id: string }
): IdeaDiscussionReplyWithAuthor {
  return {
    discussion_id: "d1",
    author_id: "u1",
    content: "Reply content",
    parent_reply_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    author: {
      id: "u1",
      full_name: "Test User",
      avatar_url: null,
      email: "test@test.com",
      is_bot: false,
      is_admin: false,
      bio: null,
      github_username: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      contact_info: null,
      onboarding_completed_at: null,
      ai_daily_limit: 10,
      ai_enabled: true,
      default_board_columns: null,
      email_notifications: true,
      active_bot_id: null,
      encrypted_anthropic_key: null,
      ai_starter_credits: 10,
      notification_preferences: {
        comments: true,
        votes: true,
        collaborators: true,
        status_changes: true,
        task_mentions: true,
        comment_mentions: true,
        email_notifications: true,
        collaboration_requests: true,
        collaboration_responses: true,
        discussion_mentions: true,
        discussions: true,
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildReplyTree", () => {
  it("returns empty array for empty input", () => {
    expect(buildReplyTree([])).toEqual([]);
  });

  it("returns top-level replies with empty children", () => {
    const replies = [
      makeReply({ id: "r1", content: "First" }),
      makeReply({ id: "r2", content: "Second" }),
    ];

    const tree = buildReplyTree(replies);

    expect(tree).toHaveLength(2);
    expect(tree[0].id).toBe("r1");
    expect(tree[0].children).toEqual([]);
    expect(tree[1].id).toBe("r2");
    expect(tree[1].children).toEqual([]);
  });

  it("attaches child replies to their parent", () => {
    const replies = [
      makeReply({ id: "r1", content: "Parent" }),
      makeReply({
        id: "r2",
        content: "Child",
        parent_reply_id: "r1",
        author_id: "u2",
      }),
    ];

    const tree = buildReplyTree(replies);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("r1");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe("r2");
  });

  it("handles multiple children for the same parent", () => {
    const replies = [
      makeReply({ id: "r1" }),
      makeReply({ id: "r2", parent_reply_id: "r1" }),
      makeReply({ id: "r3", parent_reply_id: "r1" }),
      makeReply({ id: "r4", parent_reply_id: "r1" }),
    ];

    const tree = buildReplyTree(replies);

    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(3);
  });

  it("handles multiple top-level replies with different children", () => {
    const replies = [
      makeReply({ id: "r1", content: "Parent A" }),
      makeReply({ id: "r2", content: "Parent B" }),
      makeReply({
        id: "r3",
        content: "Child of A",
        parent_reply_id: "r1",
      }),
      makeReply({
        id: "r4",
        content: "Child of B",
        parent_reply_id: "r2",
      }),
    ];

    const tree = buildReplyTree(replies);

    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe("r3");
    expect(tree[1].children).toHaveLength(1);
    expect(tree[1].children[0].id).toBe("r4");
  });

  it("preserves reply data in tree nodes", () => {
    const replies = [
      makeReply({
        id: "r1",
        content: "Important content",
        author_id: "special-user",
      }),
    ];

    const tree = buildReplyTree(replies);

    expect(tree[0].content).toBe("Important content");
    expect(tree[0].author_id).toBe("special-user");
    expect(tree[0].author.full_name).toBe("Test User");
  });

  it("does not create deeper nesting — orphan children go to childMap only", () => {
    // If r3 has parent_reply_id = "r2", and r2 has parent_reply_id = "r1",
    // r3 won't appear as a child of r2 because the function only groups
    // by parent_reply_id at a single level (into childMap for top-level)
    const replies = [
      makeReply({ id: "r1" }),
      makeReply({ id: "r2", parent_reply_id: "r1" }),
      makeReply({ id: "r3", parent_reply_id: "r2" }),
    ];

    const tree = buildReplyTree(replies);

    // r1 is top-level with r2 as child
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("r1");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe("r2");
    // r3 has parent_reply_id="r2" which is not top-level, so it goes into
    // childMap keyed by "r2" but r2 is not in topLevel — r3 is effectively orphaned
    // The function does not attach children to non-top-level parents
  });

  it("handles only child replies (no top-level parents present)", () => {
    // Edge case: all replies reference a parent that isn't in the list
    const replies = [
      makeReply({ id: "r1", parent_reply_id: "missing-parent" }),
      makeReply({ id: "r2", parent_reply_id: "missing-parent" }),
    ];

    const tree = buildReplyTree(replies);

    // No top-level replies found
    expect(tree).toHaveLength(0);
  });
});
