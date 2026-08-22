import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_INSTRUCTIONS } from "./steering-copy";

/**
 * AC-4.1: both MCP transports must send the identical, single-sourced
 * `SERVER_INSTRUCTIONS` constant as the server's `instructions` at
 * construction (docs/mcp-usage-steering-design.html §3, §8).
 *
 * index.ts calls `new McpServer(...)` synchronously but also starts the
 * stdio transport and can `process.exit` on failure — not safe to import
 * directly in a test process. route.ts pulls in `mcp-handler` and
 * `next/server`-adjacent env-dependent client construction at module load.
 * Both are exercised end-to-end by their respective mode's smoke tests
 * elsewhere; what this guard pins down is the wiring itself: that each file's
 * source imports `SERVER_INSTRUCTIONS` from the shared module and passes it
 * as `instructions` to its server construction call, so the two transports
 * cannot silently drift onto different copy.
 */
describe("SERVER_INSTRUCTIONS wiring (both transports)", () => {
  const repoRoot = process.cwd();
  const stdioSource = readFileSync(join(repoRoot, "mcp-server/src/index.ts"), "utf8");
  const remoteSource = readFileSync(
    join(repoRoot, "src/app/api/mcp/[[...transport]]/route.ts"),
    "utf8"
  );

  it("stdio (index.ts) imports SERVER_INSTRUCTIONS from the shared steering-copy module", () => {
    expect(stdioSource).toMatch(/import\s*\{\s*SERVER_INSTRUCTIONS\s*\}\s*from\s*"\.\/steering-copy"/);
  });

  it("stdio (index.ts) passes SERVER_INSTRUCTIONS as the McpServer instructions option", () => {
    expect(stdioSource).toMatch(/instructions:\s*SERVER_INSTRUCTIONS/);
  });

  it("remote (route.ts) imports SERVER_INSTRUCTIONS from the shared steering-copy module", () => {
    expect(remoteSource).toMatch(
      /import\s*\{\s*SERVER_INSTRUCTIONS\s*\}\s*from\s*"\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/mcp-server\/src\/steering-copy"/
    );
  });

  it("remote (route.ts) passes SERVER_INSTRUCTIONS as the createMcpHandler server option", () => {
    expect(remoteSource).toMatch(/instructions:\s*SERVER_INSTRUCTIONS/);
  });

  it("neither transport defines a second, locally-duplicated instructions string", () => {
    // Guards against a future edit reintroducing a literal copy of the
    // instructions text in either file instead of importing the constant.
    const suspiciousLiteral = /instructions:\s*["'`]/;
    expect(suspiciousLiteral.test(stdioSource)).toBe(false);
    expect(suspiciousLiteral.test(remoteSource)).toBe(false);
  });

  it("sanity: the shared constant both files reference is non-empty and exported", () => {
    expect(typeof SERVER_INSTRUCTIONS).toBe("string");
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0);
  });
});
