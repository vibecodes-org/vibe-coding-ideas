import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardModeSwitch } from "./dashboard-mode-switch";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("DashboardModeSwitch", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it("shows standard content when isActivated is true", () => {
    render(
      <DashboardModeSwitch
        isActivated={true}
        firstRunContent={<div data-testid="first-run">First Run</div>}
        standardContent={<div data-testid="standard">Standard</div>}
      />
    );

    expect(screen.getByTestId("standard")).toBeInTheDocument();
    expect(screen.queryByTestId("first-run")).not.toBeInTheDocument();
  });

  it("shows first-run content when isActivated is false and no localStorage override", () => {
    render(
      <DashboardModeSwitch
        isActivated={false}
        firstRunContent={<div data-testid="first-run">First Run</div>}
        standardContent={<div data-testid="standard">Standard</div>}
      />
    );

    expect(screen.getByTestId("first-run")).toBeInTheDocument();
    expect(screen.queryByTestId("standard")).not.toBeInTheDocument();
  });

  it("shows standard content when isActivated is false but localStorage override is set", () => {
    localStorageMock.setItem("first-run-dashboard-dismissed", "true");

    render(
      <DashboardModeSwitch
        isActivated={false}
        firstRunContent={<div data-testid="first-run">First Run</div>}
        standardContent={<div data-testid="standard">Standard</div>}
      />
    );

    // After mount + useEffect, should show standard
    expect(screen.getByTestId("standard")).toBeInTheDocument();
  });

  it("never shows both first-run and standard content simultaneously", () => {
    render(
      <DashboardModeSwitch
        isActivated={false}
        firstRunContent={<div data-testid="first-run">First Run</div>}
        standardContent={<div data-testid="standard">Standard</div>}
      />
    );

    // Can't have both visible at the same time
    const firstRun = screen.queryByTestId("first-run");
    const standard = screen.queryByTestId("standard");
    expect(firstRun === null || standard === null).toBe(true);
  });
});
