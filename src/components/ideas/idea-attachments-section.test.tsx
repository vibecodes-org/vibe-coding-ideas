import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { IdeaAttachment } from "@/types";

// Radix primitives use ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverStub;

function makeAttachments(count: number): IdeaAttachment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `attachment-${i}`,
    idea_id: "idea-1",
    uploaded_by: "user-1",
    file_name: `file-${i}.png`,
    file_size: 1024,
    content_type: "image/png",
    storage_path: `idea-1/file-${i}.png`,
    created_at: new Date().toISOString(),
  }));
}

// Minimal chainable query builder that resolves to a fixed attachment list —
// this test only cares about the ScrollArea's static height class, not data.
function createQueryBuilder(data: IdeaAttachment[]) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) {
    builder[m] = vi.fn(() => builder);
  }
  (builder as { then: unknown }).then = (resolve: (v: { data: unknown[] }) => void) =>
    resolve({ data });
  return builder;
}

function mockSupabase(data: IdeaAttachment[]) {
  vi.doMock("@/lib/supabase/client", () => ({
    createClient: () => ({
      from: () => createQueryBuilder(data),
      channel: () => {
        const ch: Record<string, unknown> = {};
        ch.on = vi.fn(() => ch);
        ch.subscribe = vi.fn(() => ch);
        ch.unsubscribe = vi.fn();
        return ch;
      },
    }),
  }));
}

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe("IdeaAttachmentsSection ScrollArea height", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.resetModules();
  });

  // Regression guard for a bug where >6 attachments overflowed onto the
  // Comments section below: Radix's Viewport is `size-full` (height:100%),
  // which only resolves against a parent with a *definite* height — a
  // `max-h-*` class leaves the parent's height as `auto`, so the viewport
  // (and its content) grows past it unclipped. An explicit `h-*` class
  // gives the parent a definite height the viewport can fill and clip to.
  it("uses a definite h-64 (not max-h-64) once attachments exceed 6", async () => {
    mockSupabase(makeAttachments(16));
    const { IdeaAttachmentsSection } = await import("./idea-attachments-section");

    const { container } = render(
      <TooltipProvider>
        <IdeaAttachmentsSection
          ideaId="idea-1"
          currentUserId="user-1"
          isAuthor={false}
          isTeamMember={true}
        />
      </TooltipProvider>
    );

    await waitFor(() => {
      expect(container.querySelector('[data-slot="scroll-area"]')).toBeInTheDocument();
    });

    const scrollArea = container.querySelector('[data-slot="scroll-area"]');
    expect(scrollArea!.className).toContain("h-64");
    expect(scrollArea!.className).not.toContain("max-h-64");
  });

  it("leaves the ScrollArea unbounded when attachments are at or under 6", async () => {
    mockSupabase(makeAttachments(3));
    const { IdeaAttachmentsSection } = await import("./idea-attachments-section");

    const { container } = render(
      <TooltipProvider>
        <IdeaAttachmentsSection
          ideaId="idea-1"
          currentUserId="user-1"
          isAuthor={false}
          isTeamMember={true}
        />
      </TooltipProvider>
    );

    await waitFor(() => {
      expect(container.querySelector('[data-slot="scroll-area"]')).toBeInTheDocument();
    });

    const scrollArea = container.querySelector('[data-slot="scroll-area"]');
    expect(scrollArea!.className).not.toContain("h-64");
  });
});
