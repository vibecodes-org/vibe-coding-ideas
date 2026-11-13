import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const dir = join(process.cwd(), "supabase/migrations");
const sql = readFileSync(join(dir, "00212_reshape_workflow_run.sql"), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("00212 reshape_workflow_run", () => {
  it("runs as the signed-in user", () => {
    expect(code).toMatch(/SECURITY INVOKER/);
  });

  it("does not call any function whose EXECUTE was revoked from authenticated", () => {
    const revoked = new Set<string>();
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "00212")) {
      const text = readFileSync(join(dir, f), "utf8");
      for (const m of text.matchAll(
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?(\w+)\s*\([^)]*\)\s+FROM\s+([^;]+);/gi,
      )) {
        if (/authenticated/i.test(m[2])) revoked.add(m[1]);
      }
    }
    expect(revoked.has("workflow_live_run_id")).toBe(true); // guard: the scan finds 00199
    for (const name of revoked) {
      expect(code).not.toMatch(new RegExp(`\\b${name}\\s*\\(`));
    }
  });
});
