import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Card 9c51d88d: `pkill -f` / `killall` match every process on the machine,
// including other agents' in-app Claude sessions. Shipped skill text must tell
// agents to stop a server by its own process id instead.
const SKILLS_DIR = join(process.cwd(), "docs", "skills");

const skillFiles = existsSync(SKILLS_DIR)
  ? readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(SKILLS_DIR, d.name, "SKILL.md"))
      .filter((p) => existsSync(p))
  : [];

describe("shipped agent skill wording", () => {
  it("finds the skills folder", () => {
    expect(skillFiles.length).toBeGreaterThan(0);
  });

  it.each(skillFiles)("%s gives no pattern-kill advice", (file) => {
    const text = readFileSync(file, "utf8");
    // "never use pkill -f" style warnings are fine; flag only advice to run it.
    const advice = text
      .split("\n")
      .filter(
        (l) =>
          /\b(pkill|killall)\b/.test(l) && !/\b(never|don't|do not)\b/i.test(l)
      );
    expect(advice).toEqual([]);
  });

  it("browser skill stops its server by process id", () => {
    const text = readFileSync(
      join(SKILLS_DIR, "checking-pages-in-a-browser", "SKILL.md"),
      "utf8"
    );
    // Each agent command runs in a fresh shell, so a saved $pid variable is
    // empty in the next command: the number must be printed and passed by hand.
    expect(text).toContain("& echo $!");
    expect(text).toContain("kill <that number>");
    expect(text).not.toContain("$pid");
    expect(text).toMatch(/never[^\n]*pkill -f[^\n]*killall/i);
  });
});
