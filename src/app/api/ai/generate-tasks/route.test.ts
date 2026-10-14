// Regression tests for "AI Generate Tasks cuts off on a large idea" (card 5df56c02):
// the output cap was too small, a length cut was treated as a normal finish (so a
// half-written task was offered), the 120 s timeout threw every task away, and
// there was no way to ask for the rest of the list.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { streamObjectMock } = vi.hoisted(() => ({ streamObjectMock: vi.fn() }));

vi.mock("ai", () => ({ streamObject: (...args: unknown[]) => streamObjectMock(...args) }));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/ai-helpers", () => ({
  AI_MODEL: "test-model",
  ANTHROPIC_STRUCTURED_OUTPUT_OPTIONS: {},
  chargeAiUsage: vi.fn().mockResolvedValue(undefined),
  chargeAiUpfront: vi.fn().mockResolvedValue(undefined),
  resolveAiProvider: vi.fn().mockResolvedValue({
    ok: true,
    anthropic: (id: string) => ({ id }),
    keyType: "byok",
  }),
}));

vi.mock("@/lib/ai-prompt-helpers", () => ({
  buildPromptContextParts: (opts: { ideaDescription: string | null }) => [
    "CONTEXT",
    opts.ideaDescription ?? "",
  ],
  buildAutoRuleMappings: () => [],
}));

let ideaDescription = "A short sample idea.";

vi.mock("@/lib/supabase/server", () => {
  function makeChain() {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockImplementation(async () => ({
      data: { id: "idea-1", title: "Sample idea", description: ideaDescription, author_id: "user-1" },
    }));
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: [] });
    return chain;
  }
  return {
    createClient: vi.fn().mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: vi.fn().mockImplementation(() => makeChain()),
    }),
  };
});

import { POST } from "./route";

type Task = { title: string; columnName?: string; labels?: string[]; dueDate?: string };

function request(extra: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/ai/generate-tasks", {
    method: "POST",
    body: JSON.stringify({ ideaId: "idea-1", prompt: "Make tasks", ...extra }),
  });
}

function streamOf(partials: Task[][], finishReason = "stop") {
  return {
    partialObjectStream: (async function* () {
      for (const tasks of partials) yield { tasks };
    })(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
    finishReason: Promise.resolve(finishReason),
  };
}

async function lines(res: Response) {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const A: Task = { title: "Task A", columnName: "To Do", labels: ["setup"] };
const B: Task = { title: "Task B", columnName: "To Do" };

beforeEach(() => {
  vi.clearAllMocks();
  ideaDescription = "A short sample idea.";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/ai/generate-tasks — length cut", () => {
  it("drops the half-written last task and says the list was cut short", async () => {
    streamObjectMock.mockReturnValue(
      streamOf([[A], [A, B], [A, B, { title: "C", columnName: "Backl" }]], "length")
    );
    const out = await lines(await POST(request()));
    const last = out[out.length - 1];
    expect(last).toEqual({ tasks: [A, B], final: true, cutShort: "length" });
    expect(JSON.stringify(last)).not.toContain("Backl");
  });

  it("sends the existing error line when nothing finished on a first run", async () => {
    streamObjectMock.mockReturnValue(streamOf([[{ title: "C" }]], "length"));
    const out = await lines(await POST(request()));
    expect(out[out.length - 1]).toHaveProperty("error");
    expect(out.some((l) => l.final)).toBe(false);
  });
});

describe("POST /api/ai/generate-tasks — budget", () => {
  it("allows at least 32,000 output tokens", async () => {
    streamObjectMock.mockReturnValue(streamOf([[A]]));
    await (await POST(request())).text();
    expect(streamObjectMock.mock.calls[0][0].maxOutputTokens).toBeGreaterThanOrEqual(32000);
  });
});

describe("POST /api/ai/generate-tasks — deadline", () => {
  it("keeps finished tasks at 270 s, and nothing ends the run at 120 s", async () => {
    vi.useFakeTimers();
    streamObjectMock.mockReturnValue({
      partialObjectStream: (async function* () {
        yield { tasks: [A] };
        yield { tasks: [A, B] };
        yield { tasks: [A, B, { title: "C" }] };
        await new Promise(() => {}); // hangs forever, ignores the abort
      })(),
      usage: new Promise(() => {}),
      finishReason: new Promise(() => {}),
    });

    const res = await POST(request());
    let closed = false;
    const bodyPromise = res.text().then((t) => {
      closed = true;
      return t;
    });

    await vi.advanceTimersByTimeAsync(125_000);
    expect(closed).toBe(false);
    expect(streamObjectMock.mock.calls[0][0].abortSignal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(170_000);
    const body = await bodyPromise;
    const parsed = body.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(parsed[parsed.length - 1]).toEqual({ tasks: [A, B], final: true, cutShort: "time" });
    expect(parsed.some((l) => l.error)).toBe(false);
    expect(streamObjectMock.mock.calls[0][0].abortSignal.aborted).toBe(true);
  });
});

describe("POST /api/ai/generate-tasks — deadline that the stream notices", () => {
  type Opts = { abortSignal: AbortSignal; onError: (e: { error: unknown }) => void };
  function abortAware(opts: Opts, onAbort: "end" | "error") {
    return {
      partialObjectStream: (async function* () {
        yield { tasks: [A] };
        yield { tasks: [A, B] };
        yield { tasks: [A, B, { title: "C" }] };
        await new Promise<void>((resolve) =>
          opts.abortSignal.addEventListener("abort", () => resolve())
        );
        if (onAbort === "error") opts.onError({ error: new Error("aborted") });
      })(),
      usage: new Promise(() => {}),
      finishReason: new Promise(() => {}),
    };
  }

  for (const how of ["end", "error"] as const) {
    it(`reports cutShort "time" (no error line) when the stream ${how === "end" ? "ends" : "calls onError"} on abort`, async () => {
      vi.useFakeTimers();
      streamObjectMock.mockImplementation((opts: Opts) => abortAware(opts, how));
      const res = await POST(request());
      const bodyPromise = res.text();
      await vi.advanceTimersByTimeAsync(300_000);
      const parsed = (await bodyPromise)
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      expect(parsed[parsed.length - 1]).toEqual({ tasks: [A, B], final: true, cutShort: "time" });
      expect(parsed.some((l) => l.error)).toBe(false);
    });
  }
});

describe("POST /api/ai/generate-tasks — other finish reasons", () => {
  for (const reason of ["content-filter", "other"]) {
    it(`treats "${reason}" as a cut: drops the half task and sends cutShort`, async () => {
      streamObjectMock.mockReturnValue(
        streamOf([[A], [A, B], [A, B, { title: "C", columnName: "Backl" }]], reason)
      );
      const out = await lines(await POST(request()));
      expect(out[out.length - 1]).toEqual({ tasks: [A, B], final: true, cutShort: "length" });
    });
  }

  it("treats a finish reason that never arrives as a cut", async () => {
    vi.useFakeTimers();
    streamObjectMock.mockReturnValue({
      ...streamOf([[A], [A, B], [A, B, { title: "C" }]]),
      finishReason: new Promise(() => {}),
    });
    const res = await POST(request());
    const bodyPromise = lines(res);
    await vi.advanceTimersByTimeAsync(10_000);
    const out = await bodyPromise;
    expect(out[out.length - 1]).toEqual({ tasks: [A, B], final: true, cutShort: "length" });
  });
});

describe("POST /api/ai/generate-tasks — normal finish", () => {
  it("keeps every task and sends a final line without a cut flag", async () => {
    streamObjectMock.mockReturnValue(streamOf([[A], [A, B]], "stop"));
    const out = await lines(await POST(request()));
    expect(out[out.length - 1]).toEqual({ tasks: [A, B], final: true });
  });
});

describe("POST /api/ai/generate-tasks — error after tasks", () => {
  it("sends the error line (the dialog keeps the finished tasks itself)", async () => {
    streamObjectMock.mockImplementation((opts: { onError: (e: { error: unknown }) => void }) => ({
      partialObjectStream: (async function* () {
        yield { tasks: [A] };
        yield { tasks: [A, B] };
        opts.onError({ error: new Error("boom") });
      })(),
      usage: new Promise(() => {}),
      finishReason: new Promise(() => {}),
    }));
    const out = await lines(await POST(request()));
    expect(out[out.length - 1]).toHaveProperty("error");
  });
});

describe("POST /api/ai/generate-tasks — Generate the rest", () => {
  it("ends the prompt with the continuation block, after the large-idea nudge", async () => {
    ideaDescription = "x".repeat(13000);
    streamObjectMock.mockReturnValue(streamOf([[]]));
    await (await POST(request({ continueAfter: [A, B] }))).text();
    const prompt = streamObjectMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Task A");
    expect(prompt).toContain("[To Do]");
    expect(prompt).toContain("Generate ONLY tasks");
    expect(prompt).toContain("Do NOT repeat");
    expect(prompt.indexOf("Break it into separate tasks")).toBeGreaterThan(-1);
    expect(prompt.indexOf("Generate ONLY tasks")).toBeGreaterThan(
      prompt.indexOf("Break it into separate tasks")
    );
  });

  it("leaves the continuation block out of a first run", async () => {
    streamObjectMock.mockReturnValue(streamOf([[A]]));
    await (await POST(request())).text();
    expect(streamObjectMock.mock.calls[0][0].prompt).not.toContain("Generate ONLY tasks");
  });

  it.each([
    ["not an array", "x"],
    ["too many items", Array.from({ length: 1001 }, (_, i) => ({ title: `T${i}` }))],
    ["an item without a title", [{ columnName: "To Do" }]],
  ])("rejects continueAfter that is %s with 400", async (_name, value) => {
    const res = await POST(request({ continueAfter: value }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid continueAfter" });
    expect(streamObjectMock).not.toHaveBeenCalled();
  });

  it("treats an empty continueAfter as a normal first run", async () => {
    streamObjectMock.mockReturnValue(streamOf([[A]]));
    const res = await POST(request({ continueAfter: [] }));
    expect(res.status).toBe(200);
    await res.text();
    expect(streamObjectMock.mock.calls[0][0].prompt).not.toContain("Generate ONLY tasks");
  });

  it("sends a final line with no tasks (not the error line) when nothing more is needed", async () => {
    streamObjectMock.mockReturnValue(streamOf([[]], "stop"));
    const out = await lines(await POST(request({ continueAfter: [A] })));
    expect(out[out.length - 1]).toEqual({ tasks: [], final: true });
  });

  it("sends a cut final line with no tasks when a continuation is cut with nothing finished", async () => {
    streamObjectMock.mockReturnValue(streamOf([[{ title: "C" }]], "length"));
    const out = await lines(await POST(request({ continueAfter: [A] })));
    expect(out[out.length - 1]).toEqual({ tasks: [], final: true, cutShort: "length" });
  });
});
