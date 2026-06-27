import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

// Migration failures are logged via logger.warn, not thrown.
const mockLoggerWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Supabase client chain (mirrors src/actions/board.test.ts).
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
// `.order()` terminates the migration's comment/attachment selects; default to
// an empty result so flows that don't care about migration stay no-ops.
const mockOrder = vi.fn();
const chain: Record<string, unknown> = {};
const mockInsert = vi.fn(() => chain);
const mockUpdate = vi.fn(() => chain);
const mockDelete = vi.fn(() => chain);
const mockSelect = vi.fn(() => chain);
const mockEq = vi.fn(() => chain);
Object.assign(chain, {
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  select: mockSelect,
  eq: mockEq,
  order: mockOrder,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
});
const mockFrom = vi.fn((..._args: unknown[]) => chain);
const mockGetUser = vi.fn();
// Storage: cross-bucket copy used by the attachment migration.
const mockCopy = vi.fn();
const mockStorageFrom = vi.fn((..._args: unknown[]) => ({ copy: mockCopy }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    storage: { from: (...args: unknown[]) => mockStorageFrom(...args) },
    auth: { getUser: () => mockGetUser() },
  }),
}));

import { convertTaskToDiscussion } from "./discussions";

const TASK = {
  id: "task-1",
  idea_id: "idea-1",
  title: "Add OAuth refresh-token rotation",
  description: "Tokens currently never rotate.",
  archived: false,
};

describe("convertTaskToDiscussion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSingle.mockResolvedValue({ data: { id: "disc-1" }, error: null });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    // No comments/attachments to migrate by default.
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockCopy.mockResolvedValue({ data: { path: "copied" }, error: null });
  });

  it("creates an open discussion from the task and archives the task with the backlink", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: TASK, error: null }) // task load
      .mockResolvedValueOnce({ data: { id: "task-1" }, error: null }); // archive guard

    const result = await convertTaskToDiscussion("task-1", "idea-1");

    expect(result).toBe("disc-1");
    expect(mockFrom).toHaveBeenCalledWith("idea_discussions");
    expect(mockFrom).toHaveBeenCalledWith("board_tasks");
    // Field mapping: status=open, author=current user, title from task, body =
    // provenance line + preserved description.
    expect(mockInsert).toHaveBeenCalledWith({
      idea_id: "idea-1",
      author_id: "user-1",
      title: "Add OAuth refresh-token rotation",
      body:
        "From board task: Add OAuth refresh-token rotation\n\n" +
        "Tokens currently never rotate.",
      status: "open",
    });
    // Source task archived + linked to the new discussion.
    expect(mockUpdate).toHaveBeenCalledWith({
      archived: true,
      discussion_id: "disc-1",
    });
    // Discussions list revalidated; no orphan cleanup ran.
    expect(mockRevalidatePath).toHaveBeenCalledWith("/ideas/idea-1/discussions");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("uses a fallback body when the task has no description", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: { ...TASK, description: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: "task-1" }, error: null });

    await convertTaskToDiscussion("task-1", "idea-1");

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "From board task: Add OAuth refresh-token rotation",
      })
    );
  });

  it("reopens the existing discussion (no new insert) for a discussion-derived task", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: { ...TASK, discussion_id: "disc-existing" },
        error: null,
      }) // task load
      .mockResolvedValueOnce({ data: { id: "disc-existing" }, error: null }) // existing discussion lookup
      .mockResolvedValueOnce({ data: { id: "task-1" }, error: null }); // archive guard

    const result = await convertTaskToDiscussion("task-1", "idea-1");

    // Relinked to the original discussion — no duplicate created.
    expect(result).toBe("disc-existing");
    expect(mockInsert).not.toHaveBeenCalled();
    // The existing discussion is reopened (reverse of the "converted" flip)...
    expect(mockUpdate).toHaveBeenCalledWith({ status: "open" });
    // ...and the source task is archived (backlink already points at it).
    expect(mockUpdate).toHaveBeenCalledWith({ archived: true });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/ideas/idea-1/discussions");
  });

  it("falls back to creating a new discussion when the linked discussion was deleted", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: { ...TASK, discussion_id: "disc-gone" },
        error: null,
      }) // task load
      .mockResolvedValueOnce({ data: null, error: null }) // existing discussion lookup: deleted
      .mockResolvedValueOnce({ data: { id: "task-1" }, error: null }); // archive guard

    const result = await convertTaskToDiscussion("task-1", "idea-1");

    // No surviving original → mint a fresh discussion via the create-new path.
    expect(result).toBe("disc-1");
    expect(mockInsert).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      archived: true,
      discussion_id: "disc-1",
    });
  });

  it("throws and does not archive the task when the discussion insert fails", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: TASK, error: null }); // task load
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "discussion insert failed" },
    });

    await expect(convertTaskToDiscussion("task-1", "idea-1")).rejects.toThrow(
      /discussion insert failed/i
    );
    // Insert failed before the archive — task must not be mutated/archived.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("deletes the orphan discussion and throws on a hard archive error", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: TASK, error: null }) // task load
      .mockResolvedValueOnce({
        data: null,
        error: { message: "archive update failed" },
      }); // archive guard returns an error (not just zero rows)

    await expect(convertTaskToDiscussion("task-1", "idea-1")).rejects.toThrow(
      /archive update failed/i
    );
    // Just-created discussion rolled back; nothing revalidated.
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith("id", "disc-1");
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("deletes the orphan discussion and throws when the archive guard loses the race", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: TASK, error: null }) // task load
      .mockResolvedValueOnce({ data: null, error: null }); // archive guard: 0 rows

    await expect(convertTaskToDiscussion("task-1", "idea-1")).rejects.toThrow(
      /already archived or removed/i
    );

    // Orphan discussion cleaned up; nothing revalidated.
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith("id", "disc-1");
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an already-archived task before creating a discussion", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { ...TASK, archived: true },
      error: null,
    });

    await expect(convertTaskToDiscussion("task-1", "idea-1")).rejects.toThrow(
      /already been archived/i
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("migrates the task's comments and attachments into the new discussion", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: TASK, error: null }) // task load
      .mockResolvedValueOnce({ data: { id: "task-1" }, error: null }); // archive guard

    const comments = [
      {
        author_id: "user-a",
        content: "First comment",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
      {
        author_id: "user-b",
        content: "Second comment",
        created_at: "2026-01-03T00:00:00Z",
        updated_at: "2026-01-03T00:00:00Z",
      },
    ];
    const attachments = [
      {
        file_name: "diagram.png",
        file_size: 1234,
        content_type: "image/png",
        storage_path: "idea-1/task-1/orig.png",
        uploaded_by: "user-a",
        created_at: "2026-01-04T00:00:00Z",
      },
    ];
    mockOrder
      .mockResolvedValueOnce({ data: comments, error: null }) // comments select
      .mockResolvedValueOnce({ data: attachments, error: null }); // attachments select

    const result = await convertTaskToDiscussion("task-1", "idea-1");

    expect(result).toBe("disc-1");

    // Comments → one bulk reply insert, mapped + timestamps preserved.
    expect(mockInsert).toHaveBeenCalledWith([
      {
        discussion_id: "disc-1",
        idea_id: "idea-1",
        author_id: "user-a",
        content: "First comment",
        parent_reply_id: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      },
      {
        discussion_id: "disc-1",
        idea_id: "idea-1",
        author_id: "user-b",
        content: "Second comment",
        parent_reply_id: null,
        created_at: "2026-01-03T00:00:00Z",
        updated_at: "2026-01-03T00:00:00Z",
      },
    ]);

    // Attachment → cross-bucket storage copy with the new path shape.
    expect(mockStorageFrom).toHaveBeenCalledWith("task-attachments");
    expect(mockCopy).toHaveBeenCalledWith(
      "idea-1/task-1/orig.png",
      expect.stringMatching(/^idea-1\/disc-1\/[0-9a-f-]+\.png$/),
      { destinationBucket: "discussion-attachments" }
    );
    const newPath = mockCopy.mock.calls[0][1] as string;

    // ...then one discussion_attachments row pointing at the copied object.
    expect(mockInsert).toHaveBeenCalledWith({
      discussion_id: "disc-1",
      idea_id: "idea-1",
      reply_id: null,
      uploaded_by: "user-a",
      file_name: "diagram.png",
      file_size: 1234,
      content_type: "image/png",
      storage_path: newPath,
      created_at: "2026-01-04T00:00:00Z",
    });

    // Conversion still completed: task archived + discussions list revalidated.
    expect(mockUpdate).toHaveBeenCalledWith({
      archived: true,
      discussion_id: "disc-1",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/ideas/idea-1/discussions");
  });

  it("migrates nothing when the task has no comments or attachments", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: TASK, error: null }) // task load
      .mockResolvedValueOnce({ data: { id: "task-1" }, error: null }); // archive guard
    // mockOrder defaults to empty results for both selects.

    const result = await convertTaskToDiscussion("task-1", "idea-1");

    expect(result).toBe("disc-1");
    // No reply/attachment inserts — only the single discussion insert ran.
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockCopy).not.toHaveBeenCalled();
    // Conversion still archived the task.
    expect(mockUpdate).toHaveBeenCalledWith({
      archived: true,
      discussion_id: "disc-1",
    });
  });

  it("logs and skips an attachment whose storage copy fails, still converting", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: TASK, error: null }) // task load
      .mockResolvedValueOnce({ data: { id: "task-1" }, error: null }); // archive guard

    mockOrder
      .mockResolvedValueOnce({ data: [], error: null }) // no comments
      .mockResolvedValueOnce({
        data: [
          {
            file_name: "broken.pdf",
            file_size: 99,
            content_type: "application/pdf",
            storage_path: "idea-1/task-1/broken.pdf",
            uploaded_by: "user-a",
            created_at: "2026-01-05T00:00:00Z",
          },
        ],
        error: null,
      }); // one attachment
    mockCopy.mockResolvedValueOnce({
      data: null,
      error: { message: "object not found" },
    });

    const result = await convertTaskToDiscussion("task-1", "idea-1");

    // Conversion succeeded despite the bad copy.
    expect(result).toBe("disc-1");
    expect(mockUpdate).toHaveBeenCalledWith({
      archived: true,
      discussion_id: "disc-1",
    });
    // Copy attempted + failure logged...
    expect(mockCopy).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).toHaveBeenCalled();
    // ...but NO discussion_attachments row was written (only the discussion).
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/ideas/idea-1/discussions");
  });

  it("throws when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    await expect(convertTaskToDiscussion("task-1", "idea-1")).rejects.toThrow(
      /not authenticated/i
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
