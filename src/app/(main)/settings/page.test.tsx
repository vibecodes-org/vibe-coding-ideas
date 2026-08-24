import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { UserRound } from "lucide-react";

// This is a server-component page (fetches from Supabase, calls requireAuth),
// which this repo has no pattern for rendering in Vitest/jsdom. Per the
// project's fallback convention, we test the pure, exported piece instead:
// `SettingsRow`, the building block every row on the page is made from. It
// has no server-only dependencies, so it's safe to import directly even
// though it lives in page.tsx.
import { SettingsRow } from "./page";

afterEach(() => cleanup());

describe("SettingsRow", () => {
  it("renders an icon, title, description and the supplied action control", () => {
    render(
      <SettingsRow
        icon={UserRound}
        title="Profile"
        description="Name, avatar, bio, and contact info."
        action={<button>Edit</button>}
      />
    );

    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByText("Name, avatar, bio, and contact info.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    // Not an href row, so it shouldn't render as a link.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders as a link to href when no action is given (e.g. Manage agents)", () => {
    render(
      <SettingsRow
        icon={UserRound}
        title="Manage agents"
        description="View and configure the agents on your boards."
        href="/agents"
      />
    );

    const link = screen.getByRole("link", { name: /Manage agents/ });
    expect(link).toHaveAttribute("href", "/agents");
  });

  it("renders without crashing when description is an empty string (missing/edge data)", () => {
    render(<SettingsRow icon={UserRound} title="GitHub" description="" action={null} />);

    expect(screen.getByText("GitHub")).toBeInTheDocument();
  });
});
