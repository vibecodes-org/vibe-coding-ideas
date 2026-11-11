// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Card 6b672ffd: mcp-server shares source with the app (src/lib files reached
// through its tool code, and the app imports mcp-server/src), so it must be an
// intentional npm workspace of the root. That gives one install, one copy of
// zod, and declared deps that match what its import graph actually uses.
const root = path.resolve(__dirname, "../..");
const read = (p: string) => JSON.parse(readFileSync(path.join(root, p), "utf8"));
const rootPkg = read("package.json");
const mcpPkg = read("mcp-server/package.json");
const major = (range: string) => range.replace(/^[^\d]*/, "").split(".")[0];

describe("mcp-server packaging", () => {
  it("is a workspace of the root, not a walk-up accident", () => {
    expect(rootPkg.workspaces).toContain("mcp-server");
  });

  it("uses the same zod major as the root", () => {
    expect(major(mcpPkg.dependencies.zod)).toBe(major(rootPkg.dependencies.zod));
  });

  it.each(["ai", "@ai-sdk/anthropic"])(
    "declares %s, which its import graph reaches via src/lib/ai-*.ts",
    (dep) => {
      expect(mcpPkg.dependencies[dep]).toBeDefined();
      expect(major(mcpPkg.dependencies[dep])).toBe(major(rootPkg.dependencies[dep]));
    },
  );

  it("has no second lockfile beside the root one", () => {
    expect(() => readFileSync(path.join(root, "mcp-server/package-lock.json"))).toThrow();
  });
});
