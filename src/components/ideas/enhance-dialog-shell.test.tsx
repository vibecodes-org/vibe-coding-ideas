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

  it("toasts the REAL message from a structured { error } result and stays on configure (prod-masking fix)", async () => {
    // Expected AI failures are RETURNED as data, not thrown — Next.js prod
    // builds mask thrown Server Action messages, so this is the only path
    // that surfaces the real provider diagnostic to the user.
    const generateQuestions = vi.fn().mockResolvedValue({
      error: "Your credit balance is too low to access the Anthropic API.",
    });
    setup({ generateQuestions });

    fireEvent.click(screen.getByRole("button", { name: /Next/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Your credit balance is too low to access the Anthropic API."
      );
    });
    // Still on configure phase — no transition to questions
    expect(screen.getByRole("button", { name: /Next/i })).toBeDefined();
    expect(screen.queryByText(/Answer a few questions/i)).toBeNull();
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

// ── Long-result handling (card 4b371198) ─────────────────────────────

function streamResponse(chunks: string[], opts: { failAfter?: boolean } = {}) {
  const encoder = new TextEncoder();
  // Pull-based so each chunk is delivered before a failure (error() would drop queued chunks).
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else if (opts.failAfter) {
        controller.error(new Error("network error"));
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200 });
}

/** Runs the dialog to a finished/partial result using a stubbed fetch. */
async function runToResult(responses: Response[]) {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fetchMock);
  const buildStreamBody = vi.fn().mockImplementation((args) => args);
  const utils = setup({ buildStreamBody });
  fireEvent.click(screen.getByRole("checkbox")); // skip the questions round
  fireEvent.click(screen.getByRole("button", { name: /^Enhance$/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  return { fetchMock, buildStreamBody, ...utils };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EnhanceDialogShell — Continue after a length cut", () => {
  it("appends the new text to the existing text and sends continueFrom", async () => {
    const { fetchMock, buildStreamBody } = await runToResult([
      streamResponse(["Part one", "\n\n__TRUNCATED__"]),
      streamResponse([" part two"]),
    ]);

    const continueBtn = await screen.findByRole("button", { name: "Continue" });
    fireEvent.click(continueBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getAllByTestId("md").some((el) => el.textContent === "Part one part two")).toBe(true);
    });
    expect(buildStreamBody.mock.calls[1][0]).toMatchObject({ continueFrom: "Part one" });
    expect(buildStreamBody.mock.calls[1][0].previousEnhanced).toBeUndefined();
  });
});

describe("EnhanceDialogShell — dropped connection", () => {
  it("keeps the text on the result screen with the amber bar and Continue, and still toasts", async () => {
    await runToResult([streamResponse(["Part one"], { failAfter: true })]);

    expect(await screen.findByText("The connection dropped before it finished.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDefined();
    expect(screen.getAllByTestId("md").some((el) => el.textContent === "Part one")).toBe(true);
    expect(toast.error).toHaveBeenCalled();
    // Not back on the first screen
    expect(screen.queryByRole("button", { name: /^Enhance$/ })).toBeNull();
  });

  it("goes back to the first screen when no text had arrived", async () => {
    await runToResult([streamResponse([], { failAfter: true })]);

    expect(await screen.findByRole("button", { name: /^Enhance$/ })).toBeDefined();
    expect(toast.error).toHaveBeenCalled();
  });
});

describe("EnhanceDialogShell — ask before discarding a result", () => {
  it("Regenerate asks first; keeping leaves the result, discarding goes back", async () => {
    await runToResult([streamResponse(["Finished text"])]);

    fireEvent.click(await screen.findByRole("button", { name: /Regenerate/ }));
    expect(await screen.findByText("Discard this result?")).toBeDefined();

    // Keep: result stays
    fireEvent.click(screen.getByRole("button", { name: "Keep result" }));
    await waitFor(() => expect(screen.queryByText("Discard this result?")).toBeNull());
    expect(screen.getAllByTestId("md").some((el) => el.textContent === "Finished text")).toBe(true);

    // Discard: back to the first screen
    fireEvent.click(screen.getByRole("button", { name: /Regenerate/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(await screen.findByRole("button", { name: /^Enhance$/ })).toBeDefined();
  });

  it("closing the dialog asks first; Keep leaves it open, Discard closes it", async () => {
    const { props } = await runToResult([streamResponse(["Finished text"])]);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Discard this result?")).toBeDefined();
    expect(props.onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep result" }));
    expect(props.onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("an outside click on the confirm keeps the result and leaves the main dialog open", async () => {
    const { props } = await runToResult([streamResponse(["Finished text"])]);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Discard this result?")).toBeDefined();

    const overlays = document.querySelectorAll('[data-slot="dialog-overlay"]');
    const topOverlay = overlays[overlays.length - 1] as HTMLElement;
    fireEvent.pointerDown(topOverlay);
    fireEvent.pointerUp(topOverlay);
    fireEvent.click(topOverlay);

    await waitFor(() => expect(screen.queryByText("Discard this result?")).toBeNull());
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("md").some((el) => el.textContent === "Finished text")).toBe(true);
  });

  it("Escape on the confirm keeps the result and leaves the main dialog open", async () => {
    const { props } = await runToResult([streamResponse(["Finished text"])]);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    const title = await screen.findByText("Discard this result?");

    fireEvent.keyDown(title, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByText("Discard this result?")).toBeNull());
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("md").some((el) => el.textContent === "Finished text")).toBe(true);
  });
});
