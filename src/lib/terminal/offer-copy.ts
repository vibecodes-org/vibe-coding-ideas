// In-app terminal: what the "next card" bar under a session says and which
// buttons it shows. Wording follows the approved mock
// (docs/fresh-session-next-card-mock.html, Option C). Pure, so the component
// only draws what this returns and the test pins every string.

export type OfferStripAction = "notNow" | "start" | "dismiss" | "close";

export interface OfferStripInput {
  status: "offered" | "started";
  nextTitle: string | null;
  stillWorkingOn: number;
  /** The panel is on a phone-sized screen. */
  phone: boolean;
  /** The panel shows the same board the offer is about. */
  sameBoard: boolean;
  /** Name of the offer's board, used when it is not the one on screen. */
  boardTitle?: string | null;
}

export interface OfferStripCopy {
  variant: "offered" | "nothing-next" | "still-working" | "started" | "phone" | "other-board";
  /** Bold first line. */
  title: string;
  /** Card name shown after the title, when there is one. */
  cardTitle: string | null;
  /** Smaller second line. */
  detail: string;
  actions: OfferStripAction[];
}

export function stillWorkingLine(n: number): string {
  return `This session is still working on ${n} other ${n === 1 ? "card" : "cards"}, so it stays open for them.`;
}

export function offerStripCopy(input: OfferStripInput): OfferStripCopy {
  const { status, nextTitle, stillWorkingOn, phone, sameBoard, boardTitle } = input;
  const busy = stillWorkingOn > 0;

  if (status === "started") {
    if (busy) {
      return { variant: "still-working", title: "Started the next card in its own tab.", cardTitle: null, detail: stillWorkingLine(stillWorkingOn), actions: ["dismiss"] };
    }
    return {
      variant: "started",
      title: "Started the next card in its own tab.",
      cardTitle: null,
      detail: "This session is idle. Close it when you're done with it; you can resume it later from My sessions.",
      actions: ["dismiss", "close"],
    };
  }

  if (!nextTitle) {
    if (busy) {
      return { variant: "still-working", title: "Card finished. Nothing is waiting in To Do or Backlog.", cardTitle: null, detail: stillWorkingLine(stillWorkingOn), actions: ["dismiss"] };
    }
    return {
      variant: "nothing-next",
      title: "Card finished. Nothing is waiting in To Do or Backlog.",
      cardTitle: null,
      detail: "Close this session when you're done with it.",
      actions: ["dismiss", "close"],
    };
  }

  if (phone) {
    return { variant: "phone", title: "Card finished. Next up:", cardTitle: nextTitle, detail: "Start it from your Mac: launching isn't available on a phone.", actions: ["dismiss"] };
  }
  if (!sameBoard) {
    return {
      variant: "other-board",
      title: "Card finished. Next up:",
      cardTitle: nextTitle,
      detail: `Open ${boardTitle?.trim() || "that board"} to start it.`,
      actions: ["notNow"],
    };
  }
  return {
    variant: "offered",
    title: "Card finished. Next up:",
    cardTitle: nextTitle,
    detail: "A fresh session starts small, so each step costs less.",
    actions: ["notNow", "start"],
  };
}
