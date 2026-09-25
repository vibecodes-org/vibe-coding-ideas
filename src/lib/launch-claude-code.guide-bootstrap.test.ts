import { describe, it, expect } from "vitest";
import {
  buildBoundedDeepLink,
  buildClaudeDeepLink,
  buildCompactBootstrapPromptParts,
  buildCompactPromptEssentials,
  buildGuideBootstrapStep,
  formEncodedLength,
  slugifyIdeaTitle,
  DEFAULT_NEW_PROJECT_PARENT,
  MAX_DEEP_LINK_URL_LENGTH,
  type CompactBootstrapArgs,
  type CompactPromptEssentials,
} from "./launch-claude-code";
import { buildLaunchDeepLink, MAX_LAUNCH_URL_LENGTH } from "./terminal/deep-link";
import { parseLaunchDeepLink } from "../../terminal/shared/deep-link.mjs";

// ── Task b563f4da: agent-guide bootstrap on fresh browser launches ──────────
// Spec: docs/browser-agent-guide-bootstrap-ux-design.html (approved 25 Sep).
// A fresh in-browser Claude Code session reads CLAUDE.md (native) or, when
// only AGENTS.md exists, creates CLAUDE.md from it; Codex the other way
// round. The browser can't see the user's files, so all of this rides the
// bootstrap prompt as one required step — whole, or the launch is refused.
//
// These tests prove the INSTRUCTION, not a model's filesystem behaviour
// (the design says so explicitly); representative launched-agent runs are
// validated separately.

const APP_URL = "https://vibecodes.co.uk";
const IDEA_ID = "10a56f30-da8b-46a6-b989-646496d2dc12";
const TASK_ID = "042d9505-4902-422a-990b-6371fbf1128f";
const RELAY = "wss://vibecodes-terminal-relay.nickball.workers.dev";
const SESSION = "3960fe51-6010-44e8-9e77-a3c5882afffd";
const REAL_TOKEN = "x".repeat(283); // measured length of a real HMAC-signed token
const AGENTS = ["claude", "codex"] as const;
type Agent = (typeof AGENTS)[number];

// The design's "Compact guide block" copy, verbatim — the implementation
// contract. If the wording ever changes, the design doc changes first.
const DESIGN_CLAUDE_BLOCK =
  "In the safe current checkout root, before work: read/follow CLAUDE.md if present; else if AGENTS.md exists, read it and create CLAUDE.md without clobbering, preserving project guidance and adapting only agent-specific CLI/workflow directions; then read/follow CLAUDE.md. Never overwrite/merge/sync existing guides, including races. Neither exists: create neither. Read/create errors: explain and pause.";
const DESIGN_CODEX_BLOCK =
  "In the safe current checkout root, before work: read/follow AGENTS.md if present; else if CLAUDE.md exists, read it and create AGENTS.md without clobbering, preserving project guidance and adapting only agent-specific CLI/workflow directions; then read/follow AGENTS.md. Never overwrite/merge/sync existing guides, including races. Neither exists: create neither. Read/create errors: explain and pause.";

/** Exactly what use-terminal-session.ts's fresh-launch closure fires, at the
 * largest realistic overhead: both tokens, real dims, model (+ Codex effort),
 * auto mode, and the worktree flag where a known folder makes it possible. */
function browserLink(agent: Agent, helperToken: string | undefined, worktree: boolean) {
  return (parts: { prompt: string; cwd?: string }): string =>
    buildLaunchDeepLink({
      relay: RELAY,
      session: SESSION,
      token: REAL_TOKEN,
      helperToken,
      cwd: parts.cwd,
      prompt: parts.prompt,
      cols: 213,
      rows: 33,
      model: agent === "codex" ? "gpt-6-astra" : "claude-sonnet-5",
      effort: agent === "codex" ? "medium" : undefined,
      permissionMode: "auto",
      worktree: worktree && !!parts.cwd,
      agent,
    });
}

function boundedBrowserLink(
  essentials: CompactPromptEssentials,
  cwd: string | undefined,
  agent: Agent,
  helperToken: string | undefined,
  cap = MAX_LAUNCH_URL_LENGTH
) {
  return buildBoundedDeepLink({
    essentials,
    cwd,
    cap,
    promptKeyOverhead: "&prompt=".length,
    cwdPolicy: "keep",
    promptMeasure: formEncodedLength,
    buildLink: browserLink(agent, helperToken, !!essentials.isolate),
  });
}

/** fireLaunchDeepLink's order: with the helper token first, then without it
 * when the launch was refused or lost its full work step. */
function fireLikeTheHook(essentials: CompactPromptEssentials, cwd: string | undefined, agent: Agent, cap?: number) {
  const withToken = boundedBrowserLink(essentials, cwd, agent, REAL_TOKEN, cap);
  const promptOf = (r: typeof withToken) => (r.ok ? parseLaunchDeepLink(r.url)?.prompt ?? "" : "");
  if (withToken.ok && promptOf(withToken).includes(essentials.work as string)) return withToken;
  const withoutToken = boundedBrowserLink(essentials, cwd, agent, undefined, cap);
  return withoutToken.ok ? withoutToken : withToken;
}

/** The required-bootstrap contract: every head step of the essentials (or of
 * their packed form) whole, a whole work step, the guide whole, and never a
 * guide fragment. Returns the decoded prompt. */
function expectCompleteBootstrap(url: string, essentials: CompactPromptEssentials, label: string): string {
  const prompt = parseLaunchDeepLink(url)?.prompt ?? "";
  expect(prompt, label).toContain(essentials.guideStep as string);
  const forms = [essentials, essentials.packed].filter(Boolean) as CompactPromptEssentials[];
  const form = forms.find((f) => (f.headSteps ?? []).every((s) => prompt.includes(s)));
  expect(form, `${label}: every head step whole (full or packed form)`).toBeDefined();
  const f = form as CompactPromptEssentials;
  expect(
    prompt.includes(f.work as string) || prompt.includes(f.workCompact as string),
    `${label}: a whole work step`
  ).toBe(true);
  expect(prompt, label).not.toContain("…(truncated)");
  return prompt;
}

type Shape = "known-folder" | "new-project" | "repo-no-folder" | "repo-known-folder";
const SHAPES: Shape[] = ["known-folder", "new-project", "repo-no-folder", "repo-known-folder"];
const REPO = "https://github.com/nicholasmball/personal-spending-and-financial-analysis";

function shapeArgs(
  shape: Shape,
  agent: Agent,
  opts: { title: string; taskId?: string; folder?: string }
): { args: CompactBootstrapArgs; cwd: string | undefined } {
  const folder = opts.folder ?? "/Users/nickball/projects/personal-spending-and-financial-analysis";
  const base = {
    appUrl: APP_URL,
    ideaId: IDEA_ID,
    ideaTitle: opts.title,
    taskId: opts.taskId,
    agent,
    guideBootstrap: true,
  };
  switch (shape) {
    case "known-folder":
      return { args: { ...base, mode: "existing", repoUrl: null, existingPath: folder }, cwd: folder };
    case "repo-known-folder":
      return { args: { ...base, mode: "existing", repoUrl: REPO, existingPath: folder }, cwd: folder };
    case "repo-no-folder":
      return { args: { ...base, mode: "existing", repoUrl: REPO }, cwd: undefined };
    case "new-project":
      return {
        args: {
          ...base,
          mode: "new",
          repoUrl: null,
          newProject: { newProjectPath: `${DEFAULT_NEW_PROJECT_PARENT}/${slugifyIdeaTitle(opts.title)}` },
        },
        cwd: undefined,
      };
  }
}

describe("buildGuideBootstrapStep — the design's compact guide block, verbatim", () => {
  it("Claude Code: CLAUDE.md is native, AGENTS.md the fallback", () => {
    expect(buildGuideBootstrapStep("claude")).toBe(DESIGN_CLAUDE_BLOCK);
    expect(buildGuideBootstrapStep()).toBe(DESIGN_CLAUDE_BLOCK);
  });

  it("Codex: AGENTS.md is native, CLAUDE.md the fallback", () => {
    expect(buildGuideBootstrapStep("codex")).toBe(DESIGN_CODEX_BLOCK);
  });

  // The four filesystem states, per agent — each has an explicit instruction.
  describe.each([
    { agent: "claude" as const, native: "CLAUDE.md", fallback: "AGENTS.md" },
    { agent: "codex" as const, native: "AGENTS.md", fallback: "CLAUDE.md" },
  ])("$agent: every guide state is covered", ({ agent, native, fallback }) => {
    const step = buildGuideBootstrapStep(agent);

    it("both files / native only → read and follow the native guide first", () => {
      expect(step).toContain(`read/follow ${native} if present`);
      expect(step.indexOf(`read/follow ${native} if present`)).toBeLessThan(step.indexOf(`else if ${fallback}`));
    });

    it("fallback only → read it, create the native guide without clobbering, preserving project guidance", () => {
      expect(step).toContain(`else if ${fallback} exists, read it and create ${native} without clobbering`);
      expect(step).toContain("preserving project guidance and adapting only agent-specific CLI/workflow directions");
      expect(step).toContain(`then read/follow ${native}`);
    });

    it("existing guides are never overwritten, merged or synced — including a concurrent create", () => {
      expect(step).toContain("Never overwrite/merge/sync existing guides, including races.");
    });

    it("neither file → create neither (no invented guide)", () => {
      expect(step).toContain("Neither exists: create neither.");
    });

    it("read or create failures pause the session before work", () => {
      expect(step).toContain("Read/create errors: explain and pause.");
    });

    it("only ever works in the safe current checkout, before task work", () => {
      expect(step.startsWith("In the safe current checkout root, before work:")).toBe(true);
    });
  });
});

describe("guideBootstrap is opt-in — every other launch is byte-identical to before", () => {
  const args: CompactBootstrapArgs = {
    appUrl: APP_URL,
    ideaId: IDEA_ID,
    ideaTitle: "Horse Racing Predictor",
    mode: "existing",
    repoUrl: null,
    existingPath: "/Users/nickball/projects/horse-racing-predictor",
    taskId: TASK_ID,
  };

  it.each(AGENTS)("%s: without the flag there is no guide step, no packed form, and the prompt never mentions the guides", (agent) => {
    const off = buildCompactPromptEssentials({ ...args, agent });
    const explicitOff = buildCompactPromptEssentials({ ...args, agent, guideBootstrap: false });
    expect(explicitOff).toEqual(off);
    expect(off.guideStep).toBeUndefined();
    expect(off.packed).toBeUndefined();
    expect(off.headSteps).toHaveLength(2); // connect + record, exactly as before
    const { head, tail } = buildCompactBootstrapPromptParts({ ...args, agent });
    expect(head + tail).not.toContain("AGENTS.md");
    expect(head + tail).not.toContain("checkout root");
  });

  it("the claude-cli:// terminal-window launch (default 'degrade' ladder) never carries the guide", () => {
    const essentials = buildCompactPromptEssentials({ ...args, includeIsolationAdvisory: true });
    const result = buildBoundedDeepLink({
      essentials,
      cwd: args.existingPath,
      cap: MAX_DEEP_LINK_URL_LENGTH,
      buildLink: ({ prompt, cwd }) => buildClaudeDeepLink({ prompt, cwd }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(decodeURIComponent(result.url)).not.toContain("checkout root");
  });
});

describe("guide step placement and surrounding safeguards", () => {
  it.each(AGENTS)("%s: guide comes after the create-folder step, before board setup, record and work", (agent) => {
    const { args } = shapeArgs("new-project", agent, { title: "My First App", taskId: TASK_ID });
    const e = buildCompactPromptEssentials(args);
    const steps = e.headSteps ?? [];
    expect(steps[0]).toContain("Project folder FIRST");
    expect(steps[1]).toBe(buildGuideBootstrapStep(agent));
    expect(steps[2]).toContain(agent === "codex" ? "codex mcp add" : "claude mcp add");
    expect(steps[3]).toContain("record_project_path");
    expect(e.guideStep).toBe(steps[1]);
    // The un-budgeted parts builder puts it in the same place.
    const { head } = buildCompactBootstrapPromptParts(args);
    expect(head.indexOf(buildGuideBootstrapStep(agent))).toBeGreaterThan(head.indexOf("Project folder FIRST"));
    expect(head.indexOf(buildGuideBootstrapStep(agent))).toBeLessThan(head.indexOf("record_project_path"));
  });

  it.each(AGENTS)("%s: a known-folder launch keeps its worktree 'stay put' echo, isolation flag and main-folder recording", (agent) => {
    const { args } = shapeArgs("known-folder", agent, { title: "VibeCodes" });
    const e = buildCompactPromptEssentials(args);
    expect(e.isolate).toBe(true);
    expect(e.directoryEcho).toContain("do NOT `cd` from a worktree into the main folder");
    expect(e.headSteps?.[0]).toBe(buildGuideBootstrapStep(agent));
    expect(e.headSteps?.[2]).toContain("call record_project_path");
  });

  it("each agent keeps its own MCP connection and workflow-attribution directions", () => {
    const claude = buildCompactPromptEssentials(shapeArgs("known-folder", "claude", { title: "X" }).args);
    const codex = buildCompactPromptEssentials(shapeArgs("known-folder", "codex", { title: "X" }).args);
    const claudeHead = (claude.headSteps ?? []).join("\n");
    const codexHead = (codex.headSteps ?? []).join("\n");
    expect(claudeHead).toContain("claude mcp add -s local --transport http vibecodes");
    expect(claudeHead).not.toContain("codex mcp");
    expect(codexHead).toContain("codex mcp add vibecodes --url");
    expect(codexHead).toContain('Pass agent: "codex" to claim_next_step/complete_step/fail_step');
  });

  it.each(AGENTS)("%s: task and board contexts keep their ids and safeguards", (agent) => {
    const task = buildCompactPromptEssentials(shapeArgs("known-folder", agent, { title: "X", taskId: TASK_ID }).args);
    expect(task.work).toContain(`get_task (task_id ${TASK_ID}, idea_id ${IDEA_ID})`);
    expect(task.workCompact).toContain(`task_id ${TASK_ID}`);
    const board = buildCompactPromptEssentials(shapeArgs("known-folder", agent, { title: "X" }).args);
    expect(board.work).toContain(`get_board (idea_id ${IDEA_ID})`);
    expect(board.work).toContain("ASK first");
    expect(board.workCompact).toContain("ASK first");
    expect(board.workCompact).toContain("wait for my reply");
  });
});

describe("the packed form keeps every required instruction (semantic equivalence)", () => {
  it("title-free header, same task/board framing", () => {
    const task = buildCompactPromptEssentials(shapeArgs("known-folder", "claude", { title: "Long Title", taskId: TASK_ID }).args);
    const board = buildCompactPromptEssentials(shapeArgs("known-folder", "claude", { title: "Long Title" }).args);
    expect(task.packed?.header).toBe("Set up VibeCodes and work a board task.");
    expect(board.packed?.header).toBe("Set up VibeCodes and pick up board work.");
    // Guide, work steps and isolation are unchanged by packing.
    expect(task.packed?.guideStep).toBe(task.guideStep);
    expect(task.packed?.work).toBe(task.work);
    expect(task.packed?.workCompact).toBe(task.workCompact);
    expect(task.packed?.isolate).toBe(task.isolate);
  });

  it("create-new step: folder first, mkdir + cd, reuse if it exists, never home, git init/clone", () => {
    const { args } = shapeArgs("new-project", "claude", { title: "My First App" });
    const p = "~/projects/my-first-app";
    const step = buildCompactPromptEssentials(args).packed?.headSteps?.[0] ?? "";
    expect(step).toContain("Project folder FIRST, even for planning/research");
    expect(step).toContain(`\`mkdir -p ${p} && cd ${p}\``);
    expect(step).toContain("an existing folder is reused as-is");
    expect(step).toContain("Never work in your home directory (if empty, `git init`)");
  });

  it("Codex connect step: add + login, never Claude's commands, agent attribution, fresh subagent per step", () => {
    const e = buildCompactPromptEssentials(shapeArgs("repo-no-folder", "codex", { title: "X" }).args);
    const step = e.packed?.headSteps?.find((s) => s.includes("codex mcp add")) ?? "";
    expect(step).toContain(`\`codex mcp add vibecodes --url ${APP_URL}/api/mcp\``);
    expect(step).toContain("`codex mcp login vibecodes` (ChatGPT/OpenAI sign-in)");
    expect(step).toContain("never `claude mcp add` or `/mcp`");
    expect(step).toContain('Pass agent: "codex" to claim_next_step/complete_step/fail_step.');
    expect(step).toContain("Run each workflow step in a fresh subagent with claim_next_step's model/effort and context");
    expect(step).toContain("report its launch settings");
  });

  it("Claude's connect step is not rewritten; the record step only loses its em dash", () => {
    const e = buildCompactPromptEssentials(shapeArgs("known-folder", "claude", { title: "X" }).args);
    expect(e.packed?.headSteps?.[1]).toBe(e.headSteps?.[1]);
    expect(e.packed?.headSteps?.[2]).toBe(
      `Re-confirm the folder (never \`/\` or home; cd in first): call record_project_path (idea_id ${IDEA_ID}, machine \`hostname\`, \`pwd\`) so future launches reopen here.`
    );
  });
});

describe("the guide policy survives the real URL budget", () => {
  const TITLES = [
    "VibeCodes",
    "Personal spending and financial analysis and tracking",
    "A".repeat(80) + " past the header cap",
  ];

  // Every realistic fresh browser launch: both agents × task/board × every
  // folder situation × short/typical/maximum titles, at the largest real
  // overhead. None may be refused, and each carries the full bootstrap.
  for (const agent of AGENTS) {
    for (const shape of SHAPES) {
      for (const taskId of [TASK_ID, undefined]) {
        it(`${agent} · ${shape} · ${taskId ? "task" : "board"}: fits with the complete bootstrap, folder kept`, () => {
          for (const title of TITLES) {
            const { args, cwd } = shapeArgs(shape, agent, { title, taskId });
            const essentials = buildCompactPromptEssentials(args);
            const result = fireLikeTheHook(essentials, cwd, agent);
            const label = `${agent}/${shape}/${taskId ? "task" : "board"}/title=${title.length}`;
            expect(result.ok, label).toBe(true);
            if (!result.ok) continue;
            expect(result.url.length, label).toBeLessThanOrEqual(MAX_LAUNCH_URL_LENGTH);
            expect(result.droppedCwd, label).toBe(false);
            const parsed = parseLaunchDeepLink(result.url);
            expect(parsed?.cwd, label).toBe(cwd);
            const prompt = expectCompleteBootstrap(result.url, essentials, label);
            expect(prompt, label).toContain(taskId ? `task_id ${taskId}` : `get_board (idea_id ${IDEA_ID})`);
            expect(prompt, label).toContain(agent === "codex" ? 'agent: "codex"' : "claude mcp add");
          }
        });
      }
    }
  }

  it("the design's long-folder example — spaces and non-ASCII in the path — still launches whole", () => {
    const folder = "/Users/Alex/Projects/Customer portal – shared checkout";
    for (const agent of AGENTS) {
      const { args, cwd } = shapeArgs("known-folder", agent, { title: "Customer portal", taskId: TASK_ID, folder });
      const essentials = buildCompactPromptEssentials(args);
      const result = fireLikeTheHook(essentials, cwd, agent);
      expect(result.ok, agent).toBe(true);
      if (!result.ok) continue;
      expect(parseLaunchDeepLink(result.url)?.cwd).toBe(folder);
      expectCompleteBootstrap(result.url, essentials, agent);
    }
  });

  it("a long Unicode title never costs any required content (the header is what gives way)", () => {
    const title = "Überprüfung der Kundenzufriedenheit 📊 — 顧客満足度の分析とレポート作成ツール".repeat(2);
    for (const agent of AGENTS) {
      const { args, cwd } = shapeArgs("new-project", agent, { title });
      const essentials = buildCompactPromptEssentials(args);
      const result = fireLikeTheHook(essentials, cwd, agent);
      expect(result.ok, agent).toBe(true);
      if (result.ok) expectCompleteBootstrap(result.url, essentials, agent);
    }
  });

  it("a tight budget either fires the complete bootstrap or refuses — never a partial guide, never a missing folder", () => {
    let refused = 0;
    let fired = 0;
    for (const agent of AGENTS) {
      for (const shape of SHAPES) {
        for (const taskId of [TASK_ID, undefined]) {
          const { args, cwd } = shapeArgs(shape, agent, { title: "Personal spending", taskId });
          const essentials = buildCompactPromptEssentials(args);
          for (let cap = 1200; cap <= MAX_LAUNCH_URL_LENGTH; cap += 37) {
            const result = boundedBrowserLink(essentials, cwd, agent, undefined, cap);
            if (!result.ok) {
              refused++;
              continue;
            }
            fired++;
            const label = `${agent}/${shape}/cap=${cap}`;
            expect(result.url.length, label).toBeLessThanOrEqual(cap);
            expect(parseLaunchDeepLink(result.url)?.cwd, label).toBe(cwd);
            expectCompleteBootstrap(result.url, essentials, label);
          }
        }
      }
    }
    // The sweep genuinely exercises both outcomes.
    expect(refused).toBeGreaterThan(0);
    expect(fired).toBeGreaterThan(0);
  });

  it("the packed form is only reached when the full one doesn't fit — a roomy launch keeps the title header", () => {
    const { args, cwd } = shapeArgs("known-folder", "claude", { title: "VibeCodes", taskId: TASK_ID });
    const essentials = buildCompactPromptEssentials(args);
    const result = boundedBrowserLink(essentials, cwd, "claude", undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(parseLaunchDeepLink(result.url)?.prompt).toContain('work a board task for "VibeCodes"');
  });

  it("a guide launch through the default 'degrade' policy refuses rather than trading setup steps for the folder", () => {
    const { args, cwd } = shapeArgs("known-folder", "claude", { title: "X" });
    const essentials = buildCompactPromptEssentials(args);
    const result = buildBoundedDeepLink({
      essentials,
      cwd,
      cap: 900, // far too small for the whole setup
      promptKeyOverhead: "&prompt=".length,
      promptMeasure: formEncodedLength,
      buildLink: browserLink("claude", undefined, false),
    });
    expect(result.ok).toBe(false);
  });
});

// QA (Sentinel): the sweep above steps the cap by 37, so it never lands on
// the exact edge. Pin the boundary itself — at the smallest cap that fires,
// one char less refuses, and every cap from there up fires the SAME complete
// link (never a different, shorter, partial one).
describe("the exact launch-cap boundary: cap-1 refuses, cap and cap+1 fire whole", () => {
  for (const agent of AGENTS) {
    for (const shape of SHAPES) {
      for (const taskId of [TASK_ID, undefined]) {
        it(`${agent} · ${shape} · ${taskId ? "task" : "board"}`, () => {
          const { args, cwd } = shapeArgs(shape, agent, { title: "Personal spending", taskId });
          const essentials = buildCompactPromptEssentials(args);
          let minCap = -1;
          for (let cap = 900; cap <= MAX_LAUNCH_URL_LENGTH; cap++) {
            if (boundedBrowserLink(essentials, cwd, agent, undefined, cap).ok) {
              minCap = cap;
              break;
            }
          }
          expect(minCap).toBeGreaterThan(0);
          expect(boundedBrowserLink(essentials, cwd, agent, undefined, minCap - 1).ok).toBe(false);
          for (const cap of [minCap, minCap + 1]) {
            const result = boundedBrowserLink(essentials, cwd, agent, undefined, cap);
            expect(result.ok, `cap=${cap}`).toBe(true);
            if (!result.ok) continue;
            expect(result.url.length).toBeLessThanOrEqual(cap);
            expect(parseLaunchDeepLink(result.url)?.cwd).toBe(cwd);
            expectCompleteBootstrap(result.url, essentials, `${agent}/${shape}/cap=${cap}`);
          }
        });
      }
    }
  }
});
