import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { notifyComplianceViolation } from "./compliance-notify";
import { logger } from "../../../src/lib/logger";

const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const OWNER_ID = "00000000-0000-4000-a000-000000000099";
const CALLER_ID = "00000000-0000-4000-a000-000000000001";

/** Builds a minimal chainable Supabase mock scoped to the "ideas"/"notifications" tables. */
function makeCtx(opts: {
  ideaRow?: { author_id: string | null; author: { notification_preferences: Record<string, unknown> | null } | null } | null;
  ideaFetchError?: { message: string } | null;
  insertError?: { message: string } | null;
  userId?: string;
}) {
  const inserted: unknown[] = [];
  let ideaLookups = 0;

  const from = vi.fn((table: string) => {
    if (table === "ideas") {
      ideaLookups++;
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({
                data: opts.ideaRow ?? null,
                error: opts.ideaFetchError ?? null,
              })
            ),
          })),
        })),
      };
    }
    if (table === "notifications") {
      return {
        insert: vi.fn((row: unknown) => {
          inserted.push(row);
          return Promise.resolve({ error: opts.insertError ?? null });
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  const ctx = {
    supabase: { from } as unknown as McpContext["supabase"],
    userId: opts.userId ?? CALLER_ID,
  } as McpContext;

  return { ctx, inserted, getIdeaLookups: () => ideaLookups };
}

describe("notifyComplianceViolation", () => {
  const compliantIdea = {
    author_id: OWNER_ID,
    author: { notification_preferences: {} },
  };

  it("tier=false, persona=true -> inserts one step_compliance row", async () => {
    const { ctx, inserted } = makeCtx({ ideaRow: compliantIdea });
    await notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual({
      user_id: OWNER_ID,
      actor_id: CALLER_ID,
      type: "step_compliance",
      idea_id: IDEA_ID,
      task_id: TASK_ID,
    });
  });

  it("tier=true, persona=false -> inserts one row", async () => {
    const { ctx, inserted } = makeCtx({ ideaRow: compliantIdea });
    await notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: true, personaHonored: false });
    expect(inserted).toHaveLength(1);
  });

  it("both false -> exactly ONE insert (not two)", async () => {
    const { ctx, inserted } = makeCtx({ ideaRow: compliantIdea });
    await notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: false });
    expect(inserted).toHaveLength(1);
  });

  it("both true -> no insert, no idea lookup", async () => {
    const { ctx, inserted, getIdeaLookups } = makeCtx({ ideaRow: compliantIdea });
    await notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: true, personaHonored: true });
    expect(inserted).toHaveLength(0);
    // Strict gate short-circuits before any lookup when nothing was violated.
    expect(getIdeaLookups()).toBe(0);
  });

  it("both null (old client / no attestation) -> no insert (strict gate, null never triggers)", async () => {
    const { ctx, inserted, getIdeaLookups } = makeCtx({ ideaRow: compliantIdea });
    await notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: null, personaHonored: null });
    expect(inserted).toHaveLength(0);
    expect(getIdeaLookups()).toBe(0);
  });

  it("tier=false, persona=null -> still inserts (only one side needs to be explicitly false)", async () => {
    const { ctx, inserted } = makeCtx({ ideaRow: compliantIdea });
    await notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: null });
    expect(inserted).toHaveLength(1);
  });

  it("compliance_alerts: false -> gate is off, no insert", async () => {
    const { ctx, inserted } = makeCtx({
      ideaRow: { author_id: OWNER_ID, author: { notification_preferences: { compliance_alerts: false } } },
    });
    await notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: null });
    expect(inserted).toHaveLength(0);
  });

  it("compliance_alerts absent from preferences -> defaults ON, inserts", async () => {
    const { ctx, inserted } = makeCtx({
      ideaRow: { author_id: OWNER_ID, author: { notification_preferences: { comments: true } } },
    });
    await notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: null });
    expect(inserted).toHaveLength(1);
  });

  it("author/notification_preferences entirely null -> defaults ON, inserts", async () => {
    const { ctx, inserted } = makeCtx({ ideaRow: { author_id: OWNER_ID, author: null } });
    await notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: null });
    expect(inserted).toHaveLength(1);
  });

  it("no self-skip: owner === ctx.userId still gets notified (governance event, not a social ping)", async () => {
    const { ctx, inserted } = makeCtx({ ideaRow: compliantIdea, userId: OWNER_ID });
    await notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: null });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ user_id: OWNER_ID, actor_id: OWNER_ID });
  });

  it("idea has no author_id (deleted/orphaned) -> no insert", async () => {
    const { ctx, inserted } = makeCtx({ ideaRow: { author_id: null, author: null } });
    await notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: null });
    expect(inserted).toHaveLength(0);
  });

  it("idea lookup returns null row (idea gone) -> no insert, never throws", async () => {
    const { ctx, inserted } = makeCtx({ ideaRow: null });
    await expect(
      notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: null })
    ).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
  });

  it("idea lookup errors -> swallowed, logged, no throw", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx, inserted } = makeCtx({ ideaFetchError: { message: "db down" } });
    await expect(
      notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: null })
    ).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("idea owner lookup failed"),
      expect.objectContaining({ error: "db down" })
    );
    warnSpy.mockRestore();
  });

  it("notification insert fails -> swallowed, logged, no throw", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { ctx } = makeCtx({ ideaRow: compliantIdea, insertError: { message: "insert failed" } });
    await expect(
      notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: null })
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("insert failed"),
      expect.objectContaining({ error: "insert failed" })
    );
    warnSpy.mockRestore();
  });

  it("an unexpected throw during lookup is caught and swallowed", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const ctx = {
      supabase: {
        from: vi.fn(() => {
          throw new Error("boom");
        }),
      } as unknown as McpContext["supabase"],
      userId: CALLER_ID,
    } as McpContext;

    await expect(
      notifyComplianceViolation(ctx, { ideaId: IDEA_ID, taskId: TASK_ID, tierHonored: false, personaHonored: null })
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("threw"),
      expect.objectContaining({ error: "boom" })
    );
    warnSpy.mockRestore();
  });
});
