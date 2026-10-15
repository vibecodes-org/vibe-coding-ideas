// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  PLANNER_AGENT_ID,
  PLANNER_BIO,
  PLANNER_INSTRUCTIONS,
  PLANNER_PROMPT,
  PLANNER_ROLE,
} from "./planner-agent";
import { BOT_ROLE_TEMPLATES } from "./constants";
import { generateInstructions, parseInstructions } from "./agent-instructions";

const MIGRATIONS = path.join(__dirname, "../../supabase/migrations");
// 00187 seeded the row; 00190 (stage 3) rewrote its text and tagline. The
// current text is pinned in platform-agents.test.ts.
const migrationFile = readdirSync(MIGRATIONS).find((f) => f.startsWith("00190_"));
const migration = migrationFile ? readFileSync(path.join(MIGRATIONS, migrationFile), "utf8") : "";

describe("Planner as a product agent", () => {
  it("the platform migration carries exactly the same text as the code constant", () => {
    const m = migration.match(
      new RegExp(`SET system_prompt = \\$agent\\$([\\s\\S]*?)\\$agent\\$,\\s+bio = [^;]*?WHERE id = '${PLANNER_AGENT_ID}';`)
    );
    expect(m, "00190 must hold the Planner between $agent$ markers").not.toBeNull();
    expect(m![1]).toBe(PLANNER_PROMPT);
  });

  it("the migration carries the same id, role and tagline", () => {
    expect(migration).toContain(`'${PLANNER_AGENT_ID}'`);
    expect(migration).toContain(PLANNER_BIO);
    expect(PLANNER_ROLE).toBe("Planner");
  });

  it("is the first starting template, on Full access, with the same text as the platform agent", () => {
    const first = BOT_ROLE_TEMPLATES[0];
    expect(first.role).toBe("Planner");
    expect(first.toolAccess).toBe("full");
    expect(generateInstructions(first.fields)).toBe(PLANNER_PROMPT);
  });

  it("is in the new layout and reads back into the same boxes", () => {
    expect(parseInstructions(PLANNER_PROMPT, PLANNER_ROLE)).toEqual({
      fields: PLANNER_INSTRUCTIONS,
      source: "new",
    });
  });

  it("is board-neutral: no product name, no person, no machine-specific command", () => {
    expect(PLANNER_PROMPT).not.toMatch(/VibeCodes|\bNick\b|\bopen <path|on his Mac/);
    expect(PLANNER_PROMPT).toContain("whoever approves it");
  });
});
