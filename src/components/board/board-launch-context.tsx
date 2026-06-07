"use client";

import { createContext, useContext } from "react";

/**
 * Idea-level context for the "Launch Claude Code" feature so per-task surfaces
 * (card menu, detail dialog) can build deep links without prop-drilling
 * ideaTitle / github_url through the board tree.
 */
export interface BoardLaunchContextValue {
  ideaId: string;
  ideaTitle: string;
  /** Idea's shared github_url (raw), used for the create-new clone step. */
  ideaGithubUrl: string | null;
}

const BoardLaunchContext = createContext<BoardLaunchContextValue | null>(null);

export function BoardLaunchProvider({
  value,
  children,
}: {
  value: BoardLaunchContextValue;
  children: React.ReactNode;
}) {
  return <BoardLaunchContext.Provider value={value}>{children}</BoardLaunchContext.Provider>;
}

/** Returns the launch context, or null when rendered outside a board (e.g. read-only). */
export function useBoardLaunch(): BoardLaunchContextValue | null {
  return useContext(BoardLaunchContext);
}
