import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ImportPreviewTable } from "./import-preview-table";
import type { ImportTask } from "@/lib/import";

// Radix primitives use ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverStub;

function makeTasks(count: number): ImportTask[] {
  return Array.from({ length: count }, (_, i) => ({ title: `Task ${i}` }));
}

describe("ImportPreviewTable ScrollArea height", () => {
  afterEach(() => {
    cleanup();
  });

  // Regression guard: Radix's Viewport is `size-full` (height:100%), which
  // only resolves against a parent with a *definite* height — a `max-h-*`
  // class alone leaves the parent's height as `auto`, so the viewport (and
  // its content) grows past it unclipped. An explicit `h-*` class gives the
  // parent a definite height the viewport can fill and clip to.
  it("uses a definite h-[50vh] (not max-h-[50vh]) once tasks exceed 8", () => {
    const { container } = render(
      <ImportPreviewTable
        tasks={makeTasks(20)}
        columns={[]}
        columnMapping={{}}
        defaultColumnId="col-1"
      />
    );

    const scrollArea = container.querySelector('[data-slot="scroll-area"]');
    expect(scrollArea!.className).toContain("h-[50vh]");
    expect(scrollArea!.className).not.toContain("max-h-[50vh]");
    expect(scrollArea!.className).toContain("min-h-[200px]");
  });

  it("leaves the ScrollArea unbounded (only min-h) when tasks are at or under 8", () => {
    const { container } = render(
      <ImportPreviewTable
        tasks={makeTasks(3)}
        columns={[]}
        columnMapping={{}}
        defaultColumnId="col-1"
      />
    );

    const scrollArea = container.querySelector('[data-slot="scroll-area"]');
    expect(scrollArea!.className).not.toContain("h-[50vh]");
    expect(scrollArea!.className).toContain("min-h-[200px]");
  });
});
