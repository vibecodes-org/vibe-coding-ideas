// Regression tests for the "enhancing a long idea times out" bug (card 4b371198):
// the output cap was too small for long ideas, there was no deadline before the
// platform's 5-minute kill, and Continue was handled as a refinement.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { streamTextMock, chargeAiUsageMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  chargeAiUsageMock: vi.fn(),
}));

vi.mock("ai", () => ({ streamText: (...args: unknown[]) => streamTextMock(...args) }));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/ai-helpers", () => ({
  AI_MODEL: "test-model",
  chargeAiUsage: (...args: unknown[]) => chargeAiUsageMock(...args),
  chargeAiUpfront: vi.fn().mockResolvedValue(undefined),
  resolveAiProvider: vi.fn().mockResolvedValue({
    ok: true,
    anthropic: (id: string) => ({ id }),
    keyType: "byok",
  }),
}));

vi.mock("@/lib/attachment-context", () => ({
  getAttachmentContext: vi.fn().mockResolvedValue({ promptBlock: "ATTACHMENT-BLOCK", usage: null }),
  encodeAttachmentUsageHeader: vi.fn().mockReturnValue(null),
  appendAttachmentBlock: (prompt: string, block?: string) => (block ? `${prompt}\n\n${block}` : prompt),
}));

vi.mock("@/lib/supabase/server", () => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({
    data: {
      id: "idea-1",
      title: "Sample idea",
      description: "Original sample description.",
      author_id: "user-1",
      project_kit: null,
    },
  });
  return {
    createClient: vi.fn().mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: vi.fn().mockReturnValue(chain),
    }),
  };
}) ;

import { POST } from "./route";

function request(extra: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/ai/enhance", {
    method: "POST",
    body: JSON.stringify({ ideaId: "idea-1", prompt: "Make it better", ...extra }),
  });
}

function finishedStream(chunks: string[], finishReason = "stop") {
  return {
    textStream: (async function* () {
      for (const c of chunks) yield c;
    })(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
    finishReason: Promise.resolve(finishReason),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/ai/enhance — deadline", () => {
  it("ends like a length cut (marker + close) when the stream never ends, and aborts the model call", async () => {
    vi.useFakeTimers();
    streamTextMock.mockReturnValue({
      // Yields once, then hangs forever and ignores the abort signal.
      textStream: (async function* () {
        yield "Part one";
        await new Promise(() => {});
      })(),
      usage: new Promise(() => {}),
      finishReason: new Promise(() => {}),
    });

    const res = await POST(request());
    const bodyPromise = res.text();
    await vi.advanceTimersByTimeAsync(290_000);
    const body = await bodyPromise;

    expect(body).toBe("Part one\n\n__TRUNCATED__");
    const signal = streamTextMock.mock.calls[0][0].abortSignal as AbortSignal;
    expect(signal.aborted).toBe(true);
  });
});

describe("POST /api/ai/enhance — deadline, stream closes cleanly on abort", () => {
  it("still takes the deadline path (marker, no wait on finishReason)", async () => {
    vi.useFakeTimers();
    streamTextMock.mockImplementation((opts: { abortSignal: AbortSignal }) => ({
      // Ends normally once the signal aborts (no error thrown).
      textStream: (async function* () {
        yield "Part one";
        await new Promise<void>((resolve) =>
          opts.abortSignal.addEventListener("abort", () => resolve(), { once: true })
        );
      })(),
      usage: new Promise(() => {}),
      finishReason: new Promise(() => {}),
    }));

    const res = await POST(request());
    const bodyPromise = res.text();
    await vi.advanceTimersByTimeAsync(290_000);
    expect(await bodyPromise).toBe("Part one\n\n__TRUNCATED__");
  });
});

describe("POST /api/ai/enhance — output budget", () => {
  it("allows at least 32,000 output tokens", async () => {
    streamTextMock.mockReturnValue(finishedStream(["ok"]));
    const res = await POST(request());
    await res.text();
    expect(streamTextMock.mock.calls[0][0].maxOutputTokens).toBeGreaterThanOrEqual(32000);
  });
});

describe("POST /api/ai/enhance — continueFrom", () => {
  it("asks for only the remaining part, not a revision", async () => {
    streamTextMock.mockReturnValue(finishedStream([" rest of it"]));
    const res = await POST(request({ continueFrom: "The text so far." }));
    await res.text();

    const prompt = streamTextMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("The text so far.");
    expect(prompt).toContain("Original sample description.");
    expect(prompt).toMatch(/ONLY the remaining part/);
    expect(prompt).not.toContain("Revise the enhanced description");
  });

  it("puts the remaining-part instruction last, after any attachment block", async () => {
    streamTextMock.mockReturnValue(finishedStream([" rest"]));
    const res = await POST(request({ continueFrom: "The text so far." }));
    await res.text();
    const prompt = streamTextMock.mock.calls[0][0].prompt as string;
    expect(prompt.indexOf("ATTACHMENT-BLOCK")).toBeGreaterThan(-1);
    expect(prompt.search(/ONLY the remaining part/)).toBeGreaterThan(prompt.indexOf("ATTACHMENT-BLOCK"));
  });
});
