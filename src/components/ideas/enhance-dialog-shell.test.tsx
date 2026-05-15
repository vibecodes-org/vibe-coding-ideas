import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/ui/markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="md">{children}</div>,
}));

vi.mock("@/components/ai/prompt-template-selector", () => ({
  PromptTemplateSelector: () => <div data-testid="template-selector" />,
}));

import { EnhanceDialogShell, type EnhanceDialogBot } from "./enhance-dialog-shell";
import { toast } from "sonner";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

const noBots: EnhanceDialogBot[] = [];

function setup(overrides: Partial<React.ComponentProps<typeof EnhanceDialogShell>> = {}) {
  const props: React.ComponentProps<typeof EnhanceDialogShell> = {
    open: true,
    onOpenChange: vi.fn(),
    bots: noBots,
    currentDescription: "An app for managing tasks.",
    generateQuestions: vi.fn().mockResolvedValue([
      { id: "q1", question: "Who is the target user?", placeholder: "e.g. solo devs" },
    ]),
    enhanceStreamUrl: "/api/ai/enhance",
    buildStreamBody: vi.fn().mockReturnValue({}),
    applyResult: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { props, ...render(<EnhanceDialogShell {...props} />) };
}

describe("EnhanceDialogShell — configure phase", () => {
  it("renders the dialog header and configure-phase content", () => {
    setup();
    expect(screen.getByText("Enhance with AI")).toBeDefined();
    expect(screen.getByText(/Configure how AI should enhance/i)).toBeDefined();
    // Default Next button (askQuestions checked by default)
    expect(screen.getByRole("button", { name: /Next/i })).toBeDefined();
  });

  it("renders the kit-context chip when kitContextLabel is set", () => {
    setup({ kitContextLabel: "Web Application" });
    expect(screen.getByText(/Tailoring for/i)).toBeDefined();
    expect(screen.getByText("Web Application")).toBeDefined();
  });

  it("omits the kit-context chip when kitContextLabel is unset", () => {
    setup();
    expect(screen.queryByText(/Tailoring for/i)).toBeNull();
  });

  it("shows the soft empty-state hint when currentDescription is blank", () => {
    setup({ currentDescription: "" });
    expect(
      screen.getByText(/Your draft description will appear here/i)
    ).toBeDefined();
  });

  it("renders the Markdown preview when currentDescription is set", () => {
    setup({ currentDescription: "Some real content" });
    expect(screen.queryByText(/Your draft description will appear here/i)).toBeNull();
    expect(screen.getAllByTestId("md").some((el) => el.textContent === "Some real content")).toBe(true);
  });
});

describe("EnhanceDialogShell — question generation (regression test for the original bug)", () => {
  it("shows the AiProgressSteps overlay while generating questions", async () => {
    // Block resolution so we can observe the loading overlay
    let resolveQuestions: (qs: { id: string; question: string }[]) => void = () => {};
    const generateQuestions = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveQuestions = resolve; })
    );
    setup({ generateQuestions });

    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    // The overlay shows the named question-generation steps
    await waitFor(() => {
      expect(screen.getByText("Reading your idea")).toBeDefined();
      expect(screen.getByText("Crafting targeted questions")).toBeDefined();
      expect(screen.getByText("Preparing")).toBeDefined();
    });

    // Resolve and clean up the pending promise
    resolveQuestions([]);
    await waitFor(() => {
      expect(screen.queryByText("Reading your idea")).toBeNull();
    });
  });

  it("calls generateQuestions with the prompt and persona when Next is clicked", async () => {
    const generateQuestions = vi.fn().mockResolvedValue([]);
    setup({ generateQuestions });

    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    await waitFor(() => {
      expect(generateQuestions).toHaveBeenCalledTimes(1);
    });
    const callArg = generateQuestions.mock.calls[0][0];
    expect(callArg).toHaveProperty("prompt");
    expect(callArg).toHaveProperty("personaPrompt", null); // default persona
  });

  it("transitions to questions phase after successful generation", async () => {
    const generateQuestions = vi.fn().mockResolvedValue([
      { id: "q1", question: "Who is the target user?", placeholder: "e.g. solo devs" },
      { id: "q2", question: "What's the killer feature?" },
    ]);
    setup({ generateQuestions });

    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByText(/1\. Who is the target user\?/)).toBeDefined();
      expect(screen.getByText(/2\. What's the killer feature\?/)).toBeDefined();
      // Configure-phase Next button is gone
      expect(screen.queryByRole("button", { name: /^Next$/i })).toBeNull();
    });
  });

  it("toasts an error and stays on configure when generation fails", async () => {
    const generateQuestions = vi.fn().mockRejectedValue(new Error("AI down"));
    setup({ generateQuestions });

    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("AI down");
    });
    // Still on configure phase — Next button is back, no questions rendered
    expect(screen.getByRole("button", { name: /Next/i })).toBeDefined();
  });
});

describe("EnhanceDialogShell — wrapper compatibility", () => {
  it("uses defaultPrompt override when supplied", () => {
    const customPrompt = "Custom enhancement instructions for this wrapper";
    setup({ defaultPrompt: customPrompt });
    expect(
      screen.getByDisplayValue(customPrompt)
    ).toBeDefined();
  });

  it("renders persona dropdown only when there are active bots", () => {
    const { rerender } = setup();
    expect(screen.queryByText(/AI Persona/i)).toBeNull();

    const bots: EnhanceDialogBot[] = [
      { id: "b1", name: "Atlas", role: "Engineer", system_prompt: "...", is_active: true },
    ];
    rerender(
      <EnhanceDialogShell
        open
        onOpenChange={vi.fn()}
        bots={bots}
        currentDescription="x"
        generateQuestions={vi.fn()}
        enhanceStreamUrl="/x"
        buildStreamBody={vi.fn()}
        applyResult={vi.fn()}
      />
    );
    expect(screen.getByText(/AI Persona/i)).toBeDefined();
  });
});
