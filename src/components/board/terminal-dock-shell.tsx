"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { TerminalDock } from "@/components/board/terminal-dock";
import type { RecordedProjectPath } from "@/lib/launch-claude-code";

export interface TerminalDockIdea {
  ideaId: string;
  ideaTitle: string;
  ideaGithubUrl: string | null;
  recordedProjectPaths: RecordedProjectPath[];
}

interface TerminalDockAnnounceContextValue {
  announce: (idea: TerminalDockIdea) => void;
}

const TerminalDockAnnounceContext = createContext<TerminalDockAnnounceContextValue | null>(null);

/**
 * Card b70bcbeb follow-up. `/ideas/[id]/board/page.tsx` sits below the
 * dynamic `[id]` segment, so switching boards changes the URL's `[id]` and
 * Next.js App Router remounts that whole page tree from scratch on the
 * client — including whatever it renders. TerminalDock's own header comment
 * assumed it would never be conditionally mounted/unmounted while a session
 * is live; that held for every case except this one, because nothing in the
 * tree was shared across two different idea IDs to let React preserve it.
 *
 * Hosting the ONE TerminalDock instance here, in the layout that wraps every
 * `(main)` route (above `[id]`), fixes that: the dock survives a board
 * switch and only the announced idea below changes.
 */
export function TerminalDockShell({ children }: { children: ReactNode }) {
  const [idea, setIdea] = useState<TerminalDockIdea | null>(null);
  const pathname = usePathname();

  // Deliberately no unmount-cleanup path here. Clearing `idea` when a board
  // page unmounts would race the NEW board page's own announce-on-mount —
  // React doesn't guarantee old-unmount-before-new-mount ordering across a
  // client transition, so a naive cleanup could wipe out the page that just
  // navigated in. Leaving a board page entirely (e.g. to /dashboard) hides
  // the dock via the pathname check alone, below; a stale announcement just
  // sits unused until the next board visit re-announces.
  //
  // showDock is deliberately NOT gated on `idea.ideaId === currentBoardIdeaId`
  // — `pathname` updates synchronously with the route, but `idea` only
  // updates once the new page's `AnnounceBoardIdea` runs its effect, one
  // render later. Requiring an exact match created a real one-tick window,
  // on every single board switch, where the dock was hidden then immediately
  // reshown — a genuine (if brief) unmount/remount of TerminalDock, tearing
  // its socket down exactly like the bug this shell exists to fix. Showing
  // the dock as soon as we're on ANY board page, using whatever idea was
  // last announced (even if it's a tick stale), removes that gap entirely —
  // TerminalDock never unmounts, it just receives fresh props a moment
  // later. See `AnnounceBoardIdea`'s useLayoutEffect below for how that
  // "moment later" is kept as small as physically possible.
  const currentBoardIdeaId = pathname.match(/^\/ideas\/([^/]+)\/board(?:\/|$)/)?.[1] ?? null;
  const showDock = !!currentBoardIdeaId && !!idea;

  const ctxValue = useMemo(() => ({ announce: setIdea }), []);

  return (
    <TerminalDockAnnounceContext.Provider value={ctxValue}>
      {children}
      {showDock && idea && (
        <TerminalDock
          ideaId={idea.ideaId}
          ideaTitle={idea.ideaTitle}
          ideaGithubUrl={idea.ideaGithubUrl}
          recordedProjectPaths={idea.recordedProjectPaths}
        />
      )}
    </TerminalDockAnnounceContext.Provider>
  );
}

/**
 * Rendered by the board page itself (server-fetched data as props) to
 * register as the dock's current target. Renders nothing — see
 * `TerminalDockShell` above for why there's no unmount cleanup to pair it.
 */
export function AnnounceBoardIdea({ ideaId, ideaTitle, ideaGithubUrl, recordedProjectPaths }: TerminalDockIdea) {
  const ctx = useContext(TerminalDockAnnounceContext);
  const pathsKey = recordedProjectPaths.map((p) => `${p.hostname}:${p.absolute_path}`).join("|");

  // useLayoutEffect, not useEffect: this fires synchronously after DOM
  // mutations but before the browser paints, so on a board switch the new
  // idea lands before the user ever sees a frame with the old one — a plain
  // useEffect (deferred to a later macrotask) would leave the dock's marker
  // computation briefly reading the WRONG "currently viewed board" against
  // the new url. `TerminalDockShell` no longer unmounts the dock over this
  // gap either way (see its own comment), so this is purely about shrinking
  // the window where a cross-board marker could be momentarily wrong, not
  // about preventing a teardown.
  useLayoutEffect(() => {
    ctx?.announce({ ideaId, ideaTitle, ideaGithubUrl, recordedProjectPaths });
    // recordedProjectPaths intentionally tracked via pathsKey, not itself —
    // it's a fresh array reference every render, pathsKey is the stable value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, ideaId, ideaTitle, ideaGithubUrl, pathsKey]);

  return null;
}
