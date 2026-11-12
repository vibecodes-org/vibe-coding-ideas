import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExplainerBanner } from "./explainer-banner";

describe("ExplainerBanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("shows when nothing is stored", async () => {
    render(<ExplainerBanner storageKey="k1">Hello <strong>there</strong></ExplainerBanner>);
    expect(await screen.findByText("there")).toBeInTheDocument();
  });

  it("hides on Dismiss and remembers it under the given key", async () => {
    render(<ExplainerBanner storageKey="k1">Hello</ExplainerBanner>);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
    expect(localStorage.getItem("k1")).toBe("1");
  });

  it("stays hidden when already dismissed", async () => {
    localStorage.setItem("k1", "1");
    const { container } = render(<ExplainerBanner storageKey="k1">Hello</ExplainerBanner>);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it("is not affected by a different key", async () => {
    localStorage.setItem("other", "1");
    render(<ExplainerBanner storageKey="k1">Hello</ExplainerBanner>);
    expect(await screen.findByText("Hello")).toBeInTheDocument();
  });

  it("still works when storage throws on read and write", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ExplainerBanner storageKey="k1">Hello</ExplainerBanner>);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
  });
});
