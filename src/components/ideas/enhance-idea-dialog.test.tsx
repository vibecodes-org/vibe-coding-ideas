import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Capture the props handed to the shared shell so we can assert on
// kitContextLabel without rendering the full enhance UI.
const shellProps: Array<Record<string, unknown>> = [];
vi.mock("./enhance-dialog-shell", () => ({
  EnhanceDialogShell: (props: Record<string, unknown>) => {
    shellProps.push(props);
    return null;
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/actions/ai", () => ({
  applyEnhancedDescription: vi.fn(),
  generateClarifyingQuestions: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EnhanceIdeaDialog } from "./enhance-idea-dialog";

afterEach(cleanup);
beforeEach(() => {
  shellProps.length = 0;
});

function renderDialog(kitName?: string | null) {
  render(
    <EnhanceIdeaDialog
      open
      onOpenChange={vi.fn()}
      ideaId="idea-1"
      ideaTitle="My idea"
      currentDescription="A description"
      bots={[]}
      kitName={kitName}
    />
  );
  return shellProps[0];
}

describe("EnhanceIdeaDialog — kitContextLabel pass-through (AC-12)", () => {
  it("passes the kit name as kitContextLabel when a kit is applied", () => {
    const props = renderDialog("SaaS Web App");
    expect(props.kitContextLabel).toBe("SaaS Web App");
  });

  it("passes undefined kitContextLabel when no kit is applied (no chip)", () => {
    const props = renderDialog(null);
    expect(props.kitContextLabel).toBeUndefined();
  });

  it("passes undefined kitContextLabel when kitName prop is omitted", () => {
    const props = renderDialog(undefined);
    expect(props.kitContextLabel).toBeUndefined();
  });
});
