import type { ComponentProps } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

// Regression guard for the "double-render" bug documented in the approved
// design (docs/design-github-link-any-repo.html §01): the old dialog rendered
// the connection ? <Tabs>… Browse/Create block AND a separate
// mode === "manual" block simultaneously whenever mode was "manual" and a
// connection existed. The refactor makes "Paste URL" a real TabsContent peer
// of Browse/Create so only one panel is ever in the tree at a time.

vi.mock("@/actions/github", () => ({
  getGithubConnection: vi.fn(),
  listMyGithubRepos: vi.fn(),
  createGithubRepo: vi.fn(),
  linkRepoToIdea: vi.fn(),
  verifyRepoAccess: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GithubLinkDialog } from "./github-link-dialog";
import {
  getGithubConnection,
  listMyGithubRepos,
  verifyRepoAccess,
  type GithubConnectionInfo,
} from "@/actions/github";

const mockGetConnection = vi.mocked(getGithubConnection);
const mockListRepos = vi.mocked(listMyGithubRepos);
const mockVerify = vi.mocked(verifyRepoAccess);

const CONNECTED: GithubConnectionInfo = {
  github_login: "ada",
  github_avatar_url: null,
  scopes: ["repo", "read:user"],
  connected_at: "2026-01-01T00:00:00Z",
};

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mockListRepos.mockResolvedValue([]);
});

function setup(props: Partial<ComponentProps<typeof GithubLinkDialog>> = {}) {
  render(
    <GithubLinkDialog
      open
      onOpenChange={vi.fn()}
      ideaId="idea-1"
      ideaTitle="My Idea"
      currentUrl={props.currentUrl ?? null}
      onLinked={vi.fn()}
      {...props}
    />
  );
}

/** The modal Dialog's content element (scope queries to it, like task-edit-dialog.test.tsx). */
function getDialogContent() {
  return document.querySelector<HTMLElement>("[data-slot='dialog-content']")!;
}

describe("GithubLinkDialog — smart default tab (design §03/§04)", () => {
  it("connected, no existing link → opens on My repos", async () => {
    mockGetConnection.mockResolvedValue(CONNECTED);
    setup();

    expect(await screen.findByRole("tab", { name: "My repos" })).toHaveAttribute(
      "data-state",
      "active"
    );
    expect(screen.getByPlaceholderText("Filter your repos…")).toBeInTheDocument();
  });

  it("disconnected → opens on Paste URL (no dead-end connect gate)", async () => {
    mockGetConnection.mockResolvedValue(null);
    setup();

    expect(await screen.findByRole("tab", { name: /Paste URL/i })).toHaveAttribute(
      "data-state",
      "active"
    );
    expect(screen.getByPlaceholderText("https://github.com/owner/repo")).toBeInTheDocument();
  });

  it("connected but editing an existing link → opens on Paste URL, prefilled", async () => {
    mockGetConnection.mockResolvedValue(CONNECTED);
    setup({ currentUrl: "https://github.com/foo/bar" });

    expect(await screen.findByRole("tab", { name: /Paste URL/i })).toHaveAttribute(
      "data-state",
      "active"
    );
    expect(screen.getByDisplayValue("https://github.com/foo/bar")).toBeInTheDocument();
  });
});

describe("GithubLinkDialog — no double-render (binding bug fix)", () => {
  it("Browse content and the URL input never render at the same time", async () => {
    mockGetConnection.mockResolvedValue(CONNECTED);
    setup();

    await screen.findByPlaceholderText("Filter your repos…");
    expect(screen.queryByPlaceholderText("https://github.com/owner/repo")).not.toBeInTheDocument();

    const pasteTab = await screen.findByRole("tab", { name: /Paste URL/i });
    fireEvent.mouseDown(pasteTab);
    expect(await screen.findByPlaceholderText("https://github.com/owner/repo")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Filter your repos…")).not.toBeInTheDocument();
  });
});

describe("GithubLinkDialog — disconnected tabs stay visible with an inline connect prompt", () => {
  it("clicking My repos while disconnected shows a connect prompt, not a blank dead end", async () => {
    mockGetConnection.mockResolvedValue(null);
    setup();

    const browseTab = await screen.findByRole("tab", { name: "My repos" });
    fireEvent.mouseDown(browseTab);
    expect(
      await screen.findByText(/Connect GitHub to browse and link one of your own repos\./)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect GitHub/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Filter your repos…")).not.toBeInTheDocument();
  });

  it("clicking New repo while disconnected shows a connect prompt", async () => {
    mockGetConnection.mockResolvedValue(null);
    setup();

    const createTab = await screen.findByRole("tab", { name: "New repo" });
    fireEvent.mouseDown(createTab);
    expect(
      await screen.findByText(/Connect GitHub to create a new repo here\./)
    ).toBeInTheDocument();
  });

  it("always shows the FR-4 helper copy on the Paste URL panel, connected or not", async () => {
    mockGetConnection.mockResolvedValue(null);
    setup();

    await screen.findByPlaceholderText("https://github.com/owner/repo");
    const dialogContent = getDialogContent();
    expect(within(dialogContent).getByText(/local Git credentials/i)).toBeInTheDocument();
  });
});

describe("GithubLinkDialog — repo reachability verification panel", () => {
  it("malformed URL shows V5 inline, disables Save, and never calls verifyRepoAccess", async () => {
    mockGetConnection.mockResolvedValue(CONNECTED);
    setup();

    const pasteTab = await screen.findByRole("tab", { name: /Paste URL/i });
    fireEvent.mouseDown(pasteTab);
    const input = await screen.findByPlaceholderText("https://github.com/owner/repo");
    fireEvent.change(input, { target: { value: "https://gitlab.com/foo/bar" } });

    expect(await screen.findByText("That's not a GitHub repo URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("V2 — public repo found: Save stays enabled, plain 'Save' label", async () => {
    mockGetConnection.mockResolvedValue(CONNECTED);
    mockVerify.mockResolvedValue({ state: "ok_public", owner: "vercel", repo: "next.js" });
    setup();

    const pasteTab = await screen.findByRole("tab", { name: /Paste URL/i });
    fireEvent.mouseDown(pasteTab);
    const input = await screen.findByPlaceholderText("https://github.com/owner/repo");
    fireEvent.change(input, { target: { value: "https://github.com/vercel/next.js" } });
    fireEvent.blur(input);

    expect(await screen.findByText(/Public repository on GitHub\./)).toBeInTheDocument();
    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).not.toBeDisabled();
  });

  it("V4 — not found / no access: Save stays enabled but relabels to 'Save anyway'", async () => {
    mockGetConnection.mockResolvedValue(CONNECTED);
    mockVerify.mockResolvedValue({
      state: "not_found_or_no_access",
      owner: "acme",
      repo: "internal-tool",
    });
    setup();

    const pasteTab = await screen.findByRole("tab", { name: /Paste URL/i });
    fireEvent.mouseDown(pasteTab);
    const input = await screen.findByPlaceholderText("https://github.com/owner/repo");
    fireEvent.change(input, { target: { value: "https://github.com/acme/internal-tool" } });
    fireEvent.blur(input);

    expect(await screen.findByText(/Couldn.t find/)).toBeInTheDocument();
    const saveBtn = await screen.findByRole("button", { name: "Save anyway" });
    expect(saveBtn).not.toBeDisabled();
  });

  it("V1 — no connection: verifyRepoAccess is never called, panel says so, Save enabled", async () => {
    mockGetConnection.mockResolvedValue(null);
    mockVerify.mockResolvedValue({ state: "no_connection", owner: "foo", repo: "bar" });
    setup();

    const input = await screen.findByPlaceholderText("https://github.com/owner/repo");
    fireEvent.change(input, { target: { value: "https://github.com/foo/bar" } });
    fireEvent.blur(input);

    expect(await screen.findByText("Connect GitHub to verify repos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("a verifyRepoAccess rejection (network/timeout) degrades to the neutral V6 panel, never an unhandled rejection", async () => {
    mockGetConnection.mockResolvedValue(CONNECTED);
    mockVerify.mockRejectedValue(new Error("network down"));
    setup();

    const pasteTab = await screen.findByRole("tab", { name: /Paste URL/i });
    fireEvent.mouseDown(pasteTab);
    const input = await screen.findByPlaceholderText("https://github.com/owner/repo");
    fireEvent.change(input, { target: { value: "https://github.com/foo/bar" } });
    fireEvent.blur(input);

    expect(await screen.findByText("Couldn't verify right now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });
});
