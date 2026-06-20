import { describe, it, expectTypeOf } from "vitest";
import type {
  BoardTaskWithAssignee,
  BoardTask,
  BoardLabel,
  User,
  DashboardTask,
  NotificationWithDetails,
} from "./index";
import type { Database } from "./database";

describe("BoardTaskWithAssignee type", () => {
  it("includes archived field from BoardTask", () => {
    expectTypeOf<BoardTaskWithAssignee["archived"]>().toEqualTypeOf<boolean>();
  });

  it("includes attachment_count field from BoardTask", () => {
    expectTypeOf<BoardTaskWithAssignee["attachment_count"]>().toEqualTypeOf<number>();
  });

  it("includes cover_image_path field from BoardTask", () => {
    expectTypeOf<BoardTaskWithAssignee["cover_image_path"]>().toEqualTypeOf<string | null>();
  });

  it("includes assignee", () => {
    expectTypeOf<BoardTaskWithAssignee["assignee"]>().toEqualTypeOf<User | null>();
  });

  it("includes labels", () => {
    expectTypeOf<BoardTaskWithAssignee["labels"]>().toEqualTypeOf<BoardLabel[]>();
  });
});

describe("DashboardTask type", () => {
  it("includes archived field", () => {
    expectTypeOf<DashboardTask["archived"]>().toEqualTypeOf<boolean>();
  });

  it("includes column info", () => {
    expectTypeOf<DashboardTask["column"]>().toMatchTypeOf<{
      id: string;
      title: string;
      is_done_column: boolean;
    }>();
  });
});

describe("Notification types", () => {
  it("Row type includes all notification types", () => {
    type RowType = Database["public"]["Tables"]["notifications"]["Row"]["type"];
    type ExpectedType =
      | "comment"
      | "vote"
      | "collaborator"
      | "user_deleted"
      | "status_change"
      | "task_mention"
      | "comment_mention"
      | "collaboration_request"
      | "collaboration_response"
      | "discussion"
      | "discussion_reply"
      | "discussion_mention";
    expectTypeOf<RowType>().toEqualTypeOf<ExpectedType>();
  });

  it("Insert type includes all notification types", () => {
    type InsertType = Database["public"]["Tables"]["notifications"]["Insert"]["type"];
    type ExpectedType =
      | "comment"
      | "vote"
      | "collaborator"
      | "user_deleted"
      | "status_change"
      | "task_mention"
      | "comment_mention"
      | "collaboration_request"
      | "collaboration_response"
      | "discussion"
      | "discussion_reply"
      | "discussion_mention";
    expectTypeOf<InsertType>().toEqualTypeOf<ExpectedType>();
  });

  it("Update type includes task_mention", () => {
    type UpdateType = NonNullable<Database["public"]["Tables"]["notifications"]["Update"]["type"]>;
    // Update type should match Row type exactly (both include task_mention)
    type RowType = Database["public"]["Tables"]["notifications"]["Row"]["type"];
    expectTypeOf<UpdateType>().toEqualTypeOf<RowType>();
  });
});
