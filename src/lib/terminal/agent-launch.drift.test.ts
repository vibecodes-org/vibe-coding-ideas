// Real drift guard between the app-side launch resolver (agent-launch.ts) and
// the bridge's own copy (terminal/bridge/src/resume-cmd.js). The terminal
// suites don't run in CI, so this vitest file imports the bridge module
// directly (tsconfig allowJs, same as deep-link.test.ts importing the shared
// .mjs) and asserts both resolvers agree on every combination (task 5c8969cc).
import { describe, it, expect } from "vitest";
import { resolveAgentLaunch } from "./agent-launch";
import { resolveAgentLaunch as resolveBridgeAgentLaunch } from "../../../terminal/bridge/src/resume-cmd.js";

const MINTED = "11111111-2222-3333-4444-555555555555";
const RESUME_ID = "99999999-8888-7777-6666-555555555555";

function* combinations() {
  for (const agent of ["claude", "codex", undefined] as const)
    for (const explicitCmd of [undefined, "bash"])
      for (const resumeId of [undefined, RESUME_ID])
        for (const resume of [false, true])
          for (const model of [undefined, "opus"])
            for (const permissionMode of [undefined, "auto", "acceptEdits", "bypassPermissions"])
              for (const worktree of [false, true])
                for (const remoteControl of [false, true])
                  for (const codexPair of [{}, { codexModel: "gpt-5-codex", codexEffort: "high" }])
                    yield {
                      agent,
                      explicitCmd,
                      resumeId,
                      resume,
                      model,
                      permissionMode,
                      worktree,
                      remoteControl,
                      ...codexPair,
                    };
}

describe("agent-launch.ts vs terminal/bridge/src/resume-cmd.js (drift)", () => {
  it("app and bridge resolvers agree on every combination", () => {
    let checked = 0;
    for (const opts of combinations()) {
      const app = resolveAgentLaunch({ ...opts, mintId: () => MINTED });
      const bridge = resolveBridgeAgentLaunch({ ...opts, mintId: () => MINTED });
      expect(app, JSON.stringify(opts)).toEqual(bridge);
      checked++;
    }
    expect(checked).toBe(3 * 2 * 2 * 2 * 2 * 4 * 2 * 2 * 2);
  });
});
