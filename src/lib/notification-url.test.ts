import { describe, it, expect } from "vitest";
import { buildNotificationUrl } from "./notification-url";

const APP = "https://vibecodes.co.uk";
const IDEA = "idea-123";
const COMMENT = "comment-456";
const TASK = "task-789";
const DISCUSSION = "disc-abc";
const REPLY = "reply-def";

describe("buildNotificationUrl", () => {
  it("returns appUrl when ideaId is null", () => {
    expect(
      buildNotificationUrl({
        type: "comment",
        ideaId: null,
        commentId: COMMENT,
        taskId: null,
        discussionId: null,
        replyId: null,
        appUrl: APP,
      })
    ).toBe(APP);
  });

  it("deep-links to comment with hash fragment", () => {
    expect(
      buildNotificationUrl({
        type: "comment",
        ideaId: IDEA,
        commentId: COMMENT,
        taskId: null,
        discussionId: null,
        replyId: null,
        appUrl: APP,
      })
    ).toBe(`${APP}/ideas/${IDEA}#comment-${COMMENT}`);
  });

  it("deep-links to comment_mention with hash fragment", () => {
    expect(
      buildNotificationUrl({
        type: "comment_mention",
        ideaId: IDEA,
        commentId: COMMENT,
        taskId: null,
        discussionId: null,
        replyId: null,
        appUrl: APP,
      })
    ).toBe(`${APP}/ideas/${IDEA}#comment-${COMMENT}`);
  });

  it("deep-links to task with taskId query param", () => {
    expect(
      buildNotificationUrl({
        type: "task_mention",
        ideaId: IDEA,
        commentId: null,
        taskId: TASK,
        discussionId: null,
        replyId: null,
        appUrl: APP,
      })
    ).toBe(`${APP}/ideas/${IDEA}/board?taskId=${TASK}`);
  });

  it("falls back to board page for task_mention without taskId", () => {
    expect(
      buildNotificationUrl({
        type: "task_mention",
        ideaId: IDEA,
        commentId: null,
        taskId: null,
        discussionId: null,
        replyId: null,
        appUrl: APP,
      })
    ).toBe(`${APP}/ideas/${IDEA}/board`);
  });

  it("deep-links to discussion page", () => {
    expect(
      buildNotificationUrl({
        type: "discussion",
        ideaId: IDEA,
        commentId: null,
        taskId: null,
        discussionId: DISCUSSION,
        replyId: null,
        appUrl: APP,
      })
    ).toBe(`${APP}/ideas/${IDEA}/discussions/${DISCUSSION}`);
  });

  it("deep-links to discussion reply with hash fragment", () => {
    expect(
      buildNotificationUrl({
        type: "discussion_reply",
        ideaId: IDEA,
        commentId: null,
        taskId: null,
        discussionId: DISCUSSION,
        replyId: REPLY,
        appUrl: APP,
      })
    ).toBe(`${APP}/ideas/${IDEA}/discussions/${DISCUSSION}#reply-${REPLY}`);
  });

  it("deep-links to discussion_mention with reply hash", () => {
    expect(
      buildNotificationUrl({
        type: "discussion_mention",
        ideaId: IDEA,
        commentId: null,
        taskId: null,
        discussionId: DISCUSSION,
        replyId: REPLY,
        appUrl: APP,
      })
    ).toBe(`${APP}/ideas/${IDEA}/discussions/${DISCUSSION}#reply-${REPLY}`);
  });

  it("falls back to discussions list for discussion type without discussionId", () => {
    expect(
      buildNotificationUrl({
        type: "discussion_reply",
        ideaId: IDEA,
        commentId: null,
        taskId: null,
        discussionId: null,
        replyId: REPLY,
        appUrl: APP,
      })
    ).toBe(`${APP}/ideas/${IDEA}/discussions`);
  });

  it("falls back to idea page for collaborator type", () => {
    expect(
      buildNotificationUrl({
        type: "collaborator",
        ideaId: IDEA,
        commentId: null,
        taskId: null,
        discussionId: null,
        replyId: null,
        appUrl: APP,
      })
    ).toBe(`${APP}/ideas/${IDEA}`);
  });

  it("falls back to idea page for status_change type", () => {
    expect(
      buildNotificationUrl({
        type: "status_change",
        ideaId: IDEA,
        commentId: null,
        taskId: null,
        discussionId: null,
        replyId: null,
        appUrl: APP,
      })
    ).toBe(`${APP}/ideas/${IDEA}`);
  });

  it("prioritizes taskId over commentId", () => {
    // If both are set, task wins (e.g. a mention in a task comment)
    expect(
      buildNotificationUrl({
        type: "task_mention",
        ideaId: IDEA,
        commentId: COMMENT,
        taskId: TASK,
        discussionId: null,
        replyId: null,
        appUrl: APP,
      })
    ).toBe(`${APP}/ideas/${IDEA}/board?taskId=${TASK}`);
  });
});
