// Card 6b2cb8ac: the bridge resolves the project folder on the Mac with a JS
// port of the app's folder checks (terminal/shared/project-path.mjs). This
// runs both copies over one table so they can't drift apart.
import { describe, expect, it } from "vitest";
import {
  isValidAbsolutePath,
  isPlausibleProjectPath,
  stripClaudeWorktreeSuffix,
} from "@/lib/launch-claude-code";
import * as js from "../../../terminal/shared/project-path.mjs";

const TABLE = [
  "/",
  "/tmp",
  "/Users",
  "/Users/",
  "/Users/x",
  "/Users/x/",
  "/home/x",
  "/Users/x/p",
  "/Users/x/projects/p/",
  "/opt/work",
  "~/p",
  "~",
  "relative/p",
  "./p",
  "$HOME/p",
  "",
  "   ",
  "/Users/x/p/.claude/worktrees/abc",
  "/Users/x/p/.claude/worktrees/abc/.claude/worktrees/d",
  "/Users/x/p/.claude/worktrees",
  "/.claude/worktrees/x",
  "C:\\",
  "C:\\Users",
  "C:\\Users\\x",
  "C:\\Users\\x\\p",
  "C:/Users/x/p",
  "C:\\x\\p\\.claude\\worktrees\\a",
  "\\\\srv\\share",
  "\\\\srv\\share\\p",
  " /Users/x/p ",
];

describe("project-path.mjs matches launch-claude-code.ts", () => {
  it.each(TABLE)("%j", (p) => {
    expect(js.isValidAbsolutePath(p)).toBe(isValidAbsolutePath(p));
    expect(js.isPlausibleProjectPath(p)).toBe(isPlausibleProjectPath(p));
    expect(js.stripClaudeWorktreeSuffix(p)).toBe(stripClaudeWorktreeSuffix(p));
  });
});
