import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TerminalOfferStrip } from "./terminal-offer-strip";

function setup(over: Partial<React.ComponentProps<typeof TerminalOfferStrip>> = {}) {
  const fns = { onNotNow: vi.fn(), onStart: vi.fn(), onDismiss: vi.fn(), onClose: vi.fn() };
  render(
    <TerminalOfferStrip
      status="offered"
      nextTitle="Fix the footer"
      stillWorkingOn={0}
      phone={false}
      sameBoard
      {...fns}
      {...over}
    />
  );
  return fns;
}

describe("TerminalOfferStrip", () => {
  it("shows the next card with Not now and Start in a new tab", () => {
    const f = setup();
    expect(screen.getByText("Fix the footer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Start in a new tab/ }));
    expect(f.onStart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(f.onNotNow).toHaveBeenCalledTimes(1);
  });

  it("starts only once on a double click", () => {
    const f = setup();
    const b = screen.getByRole("button", { name: /Start in a new tab/ });
    fireEvent.click(b);
    fireEvent.click(b);
    expect(f.onStart).toHaveBeenCalledTimes(1);
  });

  it("on a phone shows Dismiss only", () => {
    setup({ phone: true });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Dismiss"]);
  });

  it("on another board has no start button", () => {
    setup({ sameBoard: false, boardTitle: "Garden app" });
    expect(screen.queryByRole("button", { name: /Start in a new tab/ })).toBeNull();
    expect(screen.getByText("Open Garden app to start it.")).toBeTruthy();
  });

  it("closes the session in one click when nothing is next", () => {
    const f = setup({ nextTitle: null });
    fireEvent.click(screen.getByRole("button", { name: "Close this session" }));
    expect(f.onClose).toHaveBeenCalledTimes(1);
  });

  it("is a polite status message", () => {
    setup();
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});
