import { VIBECODES_USER_ID } from "@/lib/constants";

export interface CloneSource {
  id: string;
  name: string;
  is_published: boolean;
  owner_id: string;
}

export type CloneSourceDisplay =
  | { kind: "link"; id: string; name: string }
  | { kind: "text"; text: string };

/**
 * "Cloned from X" is a link only when the viewer can open the source: it is
 * published, or the viewer owns it. A hidden source shows plain text, so no
 * link leads to an "Agent not found" page.
 */
export function cloneSourceDisplay(source: CloneSource, viewerId: string | null): CloneSourceDisplay {
  if (source.is_published || (viewerId !== null && source.owner_id === viewerId)) {
    return { kind: "link", id: source.id, name: source.name };
  }
  if (source.owner_id === VIBECODES_USER_ID) {
    return { kind: "text", text: `Cloned from ${source.name}, a retired built-in agent` };
  }
  return { kind: "text", text: `Cloned from ${source.name} (no longer shared)` };
}
