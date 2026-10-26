// Card 5e654dd1 (stage 15): the helper drops the "Re-confirm the folder ...
// call record_project_path" step from the start-up message after it saved the
// folder itself (terminal/shared/launch-prompt.mjs). This runs that function
// over the app's REAL prompt builders (Claude and Codex, board and card, known
// folder, new project, repo board, and the packed form) so a wording change
// there can't silently stop the step being recognised.
import { describe, expect, it } from "vitest";
import {
  buildBoundedDeepLink,
  buildCompactBootstrapPromptParts,
  buildCompactPromptEssentials,
  formEncodedLength,
  DEFAULT_NEW_PROJECT_PARENT,
  slugifyIdeaTitle,
  type CompactBootstrapArgs,
} from "@/lib/launch-claude-code";
import { buildLaunchDeepLink, MAX_LAUNCH_URL_LENGTH } from "./deep-link";
import { parseLaunchDeepLink } from "../../../terminal/shared/deep-link.mjs";
import { withoutFolderRecordStep } from "../../../terminal/shared/launch-prompt.mjs";

const APP_URL = "https://vibecodes.co.uk";
const IDEA_ID = "10a56f30-da8b-46a6-b989-646496d2dc12";
const TASK_ID = "042d9505-4902-422a-990b-6371fbf1128f";
const REPO = "https://github.com/example-owner/example-repo";
const FOLDER = "/Users/devuser1/projects/example-repo";

type Agent = "claude" | "codex";
const SHAPES = ["known-folder", "new-project", "repo-no-folder", "repo-known-folder"] as const;

function argsFor(shape: (typeof SHAPES)[number], agent: Agent, title: string, taskId?: string): CompactBootstrapArgs {
  const base = { appUrl: APP_URL, ideaId: IDEA_ID, ideaTitle: title, taskId, agent, guideBootstrap: true };
  switch (shape) {
    case "known-folder":
      return { ...base, mode: "existing", repoUrl: null, existingPath: FOLDER };
    case "repo-known-folder":
      return { ...base, mode: "existing", repoUrl: REPO, existingPath: FOLDER };
    case "repo-no-folder":
      return { ...base, mode: "existing", repoUrl: REPO };
    case "new-project":
      return {
        ...base,
        mode: "new",
        repoUrl: null,
        newProject: { newProjectPath: `${DEFAULT_NEW_PROJECT_PARENT}/${slugifyIdeaTitle(title)}` },
      };
  }
}

/** Every prompt the builders can hand the helper for one launch. */
function promptsFor(shape: (typeof SHAPES)[number], agent: Agent, title: string, taskId?: string): string[] {
  const args = argsFor(shape, agent, title, taskId);
  const cwd = shape === "known-folder" || shape === "repo-known-folder" ? FOLDER : undefined;
  const out: string[] = [];
  const parts = buildCompactBootstrapPromptParts(args);
  out.push(parts.head + parts.tail);
  const essentials = buildCompactPromptEssentials(args);
  // A roomy cap (full form) and a tight one (packed / compact fallbacks).
  for (const cap of [MAX_LAUNCH_URL_LENGTH, 1700, 1500]) {
    const r = buildBoundedDeepLink({
      essentials,
      cwd,
      cap,
      promptKeyOverhead: "&prompt=".length,
      cwdPolicy: "keep",
      promptMeasure: formEncodedLength,
      buildLink: (p: { prompt: string; cwd?: string }) =>
        buildLaunchDeepLink({
          relay: "wss://vibecodes-terminal-relay.nickball.workers.dev",
          session: "3960fe51-6010-44e8-9e77-a3c5882afffd",
          token: "t".repeat(283),
          cwd: p.cwd,
          prompt: p.prompt,
          agent: agent === "codex" ? "codex" : undefined,
        }),
    });
    if (r.ok) out.push(parseLaunchDeepLink(r.url)?.prompt ?? "");
  }
  return out;
}

const RECORD = /^\d+\. Re-confirm the folder .*record_project_path/;

function check(prompt: string, label: string) {
  const lines = prompt.split("\n");
  const recordLines = lines.filter((l) => RECORD.test(l));
  expect(recordLines, label).toHaveLength(1);
  const result = withoutFolderRecordStep(prompt);
  const after = result.split("\n");
  expect(result, label).not.toContain("record_project_path");
  expect(after.length, label).toBe(lines.length - 1);
  // Numbered steps run 1..n with no gap.
  const numbers = after.map((l) => /^(\d+)\. /.exec(l)?.[1]).filter(Boolean).map(Number);
  expect(numbers, label).toEqual(numbers.map((_, i) => i + 1));
  // Every other line is unchanged, word for word and in order (numbers aside).
  const strip = (l: string) => l.replace(/^\d+\. /, "");
  expect(after.map(strip), label).toEqual(lines.filter((l) => !RECORD.test(l)).map(strip));
  // A prompt without the step comes back unchanged.
  expect(withoutFolderRecordStep(result), label).toBe(result);
}

describe("withoutFolderRecordStep over the real prompt builders", () => {
  for (const agent of ["claude", "codex"] as const) {
    for (const shape of SHAPES) {
      for (const taskId of [TASK_ID, undefined]) {
        it(`${agent} · ${shape} · ${taskId ? "card" : "board"}`, () => {
          for (const title of ["VibeCodes", "A".repeat(80) + " past the header cap"]) {
            const prompts = promptsFor(shape, agent, title, taskId);
            expect(prompts.length).toBeGreaterThan(0);
            for (const [i, prompt] of prompts.entries()) {
              // A compacted-to-head-only prompt always keeps the record step too.
              check(prompt, `${agent}/${shape}/${taskId ? "card" : "board"}/title=${title.length}/#${i}`);
            }
          }
        });
      }
    }
  }
});
