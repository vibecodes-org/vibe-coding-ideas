import { describe, expect, it } from "vitest";
import { offerStripCopy, stillWorkingLine } from "./offer-copy";

const base = { status: "offered" as const, nextTitle: "Fix the footer", stillWorkingOn: 0, phone: false, sameBoard: true };

describe("offerStripCopy", () => {
  it("offers Not now and Start when a next card exists", () => {
    const c = offerStripCopy(base);
    expect(c.variant).toBe("offered");
    expect(c.cardTitle).toBe("Fix the footer");
    expect(c.actions).toEqual(["notNow", "start"]);
    expect(c.detail).toBe("A fresh session starts small, so each step costs less.");
  });
  it("says nothing is waiting, with Dismiss and Close this session", () => {
    const c = offerStripCopy({ ...base, nextTitle: null });
    expect(c.title).toBe("Card finished. Nothing is waiting in To Do or Backlog.");
    expect(c.actions).toEqual(["dismiss", "close"]);
  });
  it("keeps the session open while it still works on other cards", () => {
    const c = offerStripCopy({ ...base, nextTitle: null, stillWorkingOn: 2 });
    expect(c.variant).toBe("still-working");
    expect(c.detail).toBe("This session is still working on 2 other cards, so it stays open for them.");
    expect(c.actions).toEqual(["dismiss"]);
    expect(stillWorkingLine(1)).toContain("1 other card,");
  });
  it("after Start, says it started and offers Close this session", () => {
    const c = offerStripCopy({ ...base, status: "started" });
    expect(c.title).toBe("Started the next card in its own tab.");
    expect(c.detail).toContain("resume it later from My sessions");
    expect(c.actions).toEqual(["dismiss", "close"]);
  });
  it("after Start, never offers Close while other cards are running", () => {
    expect(offerStripCopy({ ...base, status: "started", stillWorkingOn: 1 }).actions).toEqual(["dismiss"]);
  });
  it("on a phone shows Dismiss only", () => {
    const c = offerStripCopy({ ...base, phone: true });
    expect(c.variant).toBe("phone");
    expect(c.actions).toEqual(["dismiss"]);
    expect(c.detail).toBe("Start it from your Mac: launching isn't available on a phone.");
  });
  it("on another board gives no start button", () => {
    const c = offerStripCopy({ ...base, sameBoard: false, boardTitle: "Garden app" });
    expect(c.variant).toBe("other-board");
    expect(c.detail).toBe("Open Garden app to start it.");
    expect(c.actions).toEqual(["notNow"]);
  });
});
