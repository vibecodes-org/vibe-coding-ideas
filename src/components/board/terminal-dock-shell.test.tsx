// Card b70bcbeb follow-up (field report, Nick 27 Aug 2026): the fix shipped
// for the tab-relabelling bug turned out not to matter in practice, because
// `TerminalDock` was mounted inside `/ideas/[id]/board/page.tsx` — below the
// `[id]` route segment — so Next.js App Router unmounted and remounted the
// WHOLE dock (wiping every live tab back to the chooser) on every board
// switch, before any label logic ever ran. `TerminalDockShell` hosts the one
// dock instance one layout up, so it survives a board switch and only its
// announced idea changes. These tests pin that survival property down at the
// unit level, since it's the actual root cause and the easiest thing for a
// future refactor to silently reintroduce.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useEffect } from "react";
import { TerminalDockShell, AnnounceBoardIdea } from "./terminal-dock-shell";

const mockPathname = { current: "/ideas/idea-a/board" };
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.current,
}));

const dockMountSpy = vi.fn();
const dockUnmountSpy = vi.fn();
vi.mock("@/components/board/terminal-dock", () => ({
  TerminalDock: ({ ideaId, ideaTitle }: { ideaId: string; ideaTitle: string }) => {
    // Mount/unmount tracking, same technique as terminal-dock.test.tsx's own
    // sessionView spies: fires once per GENUINE mount/unmount, not per
    // re-render, so a test can assert the dock instance itself never gets
    // torn down across a board switch.
    // Intentionally empty deps below: this must fire ONLY on a genuine
    // mount/unmount, never on a prop change, or it can't distinguish "same
    // instance, new props" from "torn down and rebuilt" — exactly the
    // distinction this test exists to make.
    useEffect(() => {
      dockMountSpy(ideaId);
      return () => dockUnmountSpy(ideaId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="fake-dock">
        {ideaId}:{ideaTitle}
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  dockMountSpy.mockClear();
  dockUnmountSpy.mockClear();
  mockPathname.current = "/ideas/idea-a/board";
});

describe("TerminalDockShell", () => {
  it("renders nothing until the board page announces its idea", () => {
    render(<TerminalDockShell>{null}</TerminalDockShell>);
    expect(screen.queryByTestId("fake-dock")).not.toBeInTheDocument();
  });

  it("shows the dock once the current board announces itself, targeting that idea", () => {
    render(
      <TerminalDockShell>
        <AnnounceBoardIdea ideaId="idea-a" ideaTitle="Board A" ideaGithubUrl={null} recordedProjectPaths={[]} />
      </TerminalDockShell>,
    );
    expect(screen.getByTestId("fake-dock")).toHaveTextContent("idea-a:Board A");
    expect(dockMountSpy).toHaveBeenCalledTimes(1);
  });

  it("does not unmount the dock across a board switch — the whole point of this fix", () => {
    function Scene({ id, title }: { id: string; title: string }) {
      return (
        <TerminalDockShell>
          <AnnounceBoardIdea ideaId={id} ideaTitle={title} ideaGithubUrl={null} recordedProjectPaths={[]} />
        </TerminalDockShell>
      );
    }

    const { rerender } = render(<Scene id="idea-a" title="Board A" />);
    expect(screen.getByTestId("fake-dock")).toHaveTextContent("idea-a:Board A");
    expect(dockMountSpy).toHaveBeenCalledTimes(1);

    // The board-switcher navigation this bug came from: a client-side route
    // change to a DIFFERENT idea id — exactly what used to remount the page
    // (and everything under it) from scratch. `usePathname()` updates
    // synchronously with the route in the real app, so the mock is updated
    // the same way here, before the re-render that represents it landing.
    mockPathname.current = "/ideas/idea-b/board";
    rerender(<Scene id="idea-b" title="Board B" />);

    expect(screen.getByTestId("fake-dock")).toHaveTextContent("idea-b:Board B");
    // The regression this test exists to catch: the dock component must be
    // the SAME instance across the switch (mounted once, updated via props),
    // never torn down and rebuilt.
    expect(dockMountSpy).toHaveBeenCalledTimes(1);
    expect(dockUnmountSpy).not.toHaveBeenCalled();
  });

  it("hides the dock when navigating away from any board page, without unmounting it", () => {
    // mockPathname is set imperatively BEFORE each render/rerender, never
    // inside a component's render body — mutating an outer-scope variable
    // during render is disallowed (react-hooks/immutability) and would also
    // be a lie here: `usePathname()` reflects the route, not a side effect
    // of rendering.
    mockPathname.current = "/ideas/idea-a/board";
    const { rerender } = render(
      <TerminalDockShell>
        <AnnounceBoardIdea ideaId="idea-a" ideaTitle="Board A" ideaGithubUrl={null} recordedProjectPaths={[]} />
      </TerminalDockShell>,
    );
    expect(screen.getByTestId("fake-dock")).toBeInTheDocument();

    // Left the board entirely (e.g. to /dashboard): the route no longer
    // matches any /ideas/*/board path, and the announcer no longer renders
    // from this page either — both conditions the shell's visibility check
    // relies on change together, exactly as they would in the real app.
    mockPathname.current = "/dashboard";
    rerender(
      <TerminalDockShell>
        <div />
      </TerminalDockShell>,
    );
    expect(screen.queryByTestId("fake-dock")).not.toBeInTheDocument();
  });
});
