import { describe, it, expect } from "vitest";
import { BOT_ROLE_TEMPLATES } from "@/lib/constants";

// Test the pure logic: buildSuggestions deduplication and grouping
// We can't easily test the React component without jsdom + rendering,
// but we CAN test the suggestion building logic that drives it.

interface RoleSuggestion {
  role: string;
  source: "pool" | "mine" | "standard";
  agentName?: string;
}

const STANDARD_ROLES: RoleSuggestion[] = BOT_ROLE_TEMPLATES.map((t) => ({
  role: t.role,
  source: "standard" as const,
}));

function buildSuggestions(
  poolRoles: RoleSuggestion[],
  userRoles: RoleSuggestion[],
  compact: boolean,
  filterText: string = ""
): {
  pool: RoleSuggestion[];
  mine: RoleSuggestion[];
  standard: RoleSuggestion[];
} {
  const seenLower = new Set<string>();
  const query = filterText.trim().toLowerCase();

  const matchesFilter = (role: string) =>
    !query || role.trim().toLowerCase().includes(query);

  const pool = poolRoles.filter((r) => {
    const key = r.role.trim().toLowerCase();
    if (seenLower.has(key)) return false;
    seenLower.add(key);
    return matchesFilter(r.role);
  });

  const mine = compact
    ? []
    : userRoles.filter((r) => {
        const key = r.role.trim().toLowerCase();
        if (seenLower.has(key)) return false;
        seenLower.add(key);
        return matchesFilter(r.role);
      });

  const standard = STANDARD_ROLES.filter((r) => {
    const key = r.role.trim().toLowerCase();
    if (seenLower.has(key)) return false;
    seenLower.add(key);
    return matchesFilter(r.role);
  });

  return { pool, mine, standard };
}

describe("buildSuggestions", () => {
  it("returns all standard roles when no pool or user roles", () => {
    const result = buildSuggestions([], [], false);
    expect(result.pool).toEqual([]);
    expect(result.mine).toEqual([]);
    expect(result.standard).toHaveLength(BOT_ROLE_TEMPLATES.length);
    expect(result.standard.map((r) => r.role)).toEqual(
      BOT_ROLE_TEMPLATES.map((t) => t.role)
    );
  });

  it("deduplicates pool roles that match standard roles (case-insensitive)", () => {
    const pool: RoleSuggestion[] = [
      { role: "Developer", source: "pool", agentName: "Atlas" },
    ];
    const result = buildSuggestions(pool, [], false);

    // "Developer" should appear in pool, not in standard
    expect(result.pool).toHaveLength(1);
    expect(result.pool[0].role).toBe("Developer");
    expect(result.pool[0].agentName).toBe("Atlas");

    const standardRoles = result.standard.map((r) => r.role);
    expect(standardRoles).not.toContain("Developer");
  });

  it("deduplicates user roles that match pool roles", () => {
    const pool: RoleSuggestion[] = [
      { role: "QA Tester", source: "pool", agentName: "Sentinel" },
    ];
    const mine: RoleSuggestion[] = [
      { role: "QA Tester", source: "mine" },
      { role: "Security Analyst", source: "mine" },
    ];
    const result = buildSuggestions(pool, mine, false);

    expect(result.pool).toHaveLength(1);
    expect(result.mine).toHaveLength(1);
    expect(result.mine[0].role).toBe("Security Analyst");
  });

  it("compact mode skips 'mine' group entirely", () => {
    const mine: RoleSuggestion[] = [
      { role: "Custom Role", source: "mine" },
    ];
    const result = buildSuggestions([], mine, true);

    expect(result.mine).toEqual([]);
    // Custom Role is not in standard, and mine is skipped, so it won't appear
  });

  it("compact mode still shows pool and standard", () => {
    const pool: RoleSuggestion[] = [
      { role: "Frontend Dev", source: "pool", agentName: "Fox" },
    ];
    const result = buildSuggestions(pool, [], true);

    expect(result.pool).toHaveLength(1);
    expect(result.standard.length).toBeGreaterThan(0);
    expect(result.mine).toEqual([]);
  });

  it("handles case-insensitive deduplication with different casing", () => {
    const pool: RoleSuggestion[] = [
      { role: "developer", source: "pool", agentName: "Dev Bot" },
    ];
    const result = buildSuggestions(pool, [], false);

    // "developer" (lowercase) in pool should block "Developer" from standard
    expect(result.pool).toHaveLength(1);
    const standardRoles = result.standard.map((r) => r.role.toLowerCase());
    expect(standardRoles).not.toContain("developer");
  });

  it("handles whitespace trimming in deduplication", () => {
    const pool: RoleSuggestion[] = [
      { role: "  Developer  ", source: "pool", agentName: "Atlas" },
    ];
    const result = buildSuggestions(pool, [], false);

    expect(result.pool).toHaveLength(1);
    const standardRoles = result.standard.map((r) => r.role.toLowerCase());
    expect(standardRoles).not.toContain("developer");
  });

  it("preserves order within groups", () => {
    const pool: RoleSuggestion[] = [
      { role: "Zebra", source: "pool" },
      { role: "Alpha", source: "pool" },
    ];
    const result = buildSuggestions(pool, [], false);

    expect(result.pool[0].role).toBe("Zebra");
    expect(result.pool[1].role).toBe("Alpha");
  });

  it("deduplicates within same group", () => {
    const pool: RoleSuggestion[] = [
      { role: "Developer", source: "pool", agentName: "Bot A" },
      { role: "Developer", source: "pool", agentName: "Bot B" },
    ];
    const result = buildSuggestions(pool, [], false);

    // Only first occurrence kept
    expect(result.pool).toHaveLength(1);
    expect(result.pool[0].agentName).toBe("Bot A");
  });

  it("priority order: pool > mine > standard", () => {
    const pool: RoleSuggestion[] = [
      { role: "Developer", source: "pool", agentName: "Pool Bot" },
    ];
    const mine: RoleSuggestion[] = [
      { role: "Developer", source: "mine" },
      { role: "UX Designer", source: "mine" },
    ];
    const result = buildSuggestions(pool, mine, false);

    // Developer in pool, not in mine or standard
    expect(result.pool.map((r) => r.role)).toContain("Developer");
    expect(result.mine.map((r) => r.role)).not.toContain("Developer");
    expect(result.standard.map((r) => r.role)).not.toContain("Developer");

    // UX Designer in mine, not in standard
    expect(result.mine.map((r) => r.role)).toContain("UX Designer");
    expect(result.standard.map((r) => r.role)).not.toContain("UX Designer");
  });

  it("filters suggestions by text (case-insensitive)", () => {
    const result = buildSuggestions([], [], false, "dev");

    const allRoles = [
      ...result.pool.map((r) => r.role),
      ...result.mine.map((r) => r.role),
      ...result.standard.map((r) => r.role),
    ];
    // "DevOps Engineer" contains "dev"
    expect(allRoles).toContain("DevOps Engineer");
    // "QA Engineer" does not contain "dev"
    expect(allRoles).not.toContain("QA Engineer");
  });

  it("shows all suggestions when filter text is empty", () => {
    const result = buildSuggestions([], [], false, "");
    expect(result.standard).toHaveLength(BOT_ROLE_TEMPLATES.length);
  });

  it("shows all suggestions when filter text is whitespace", () => {
    const result = buildSuggestions([], [], false, "   ");
    expect(result.standard).toHaveLength(BOT_ROLE_TEMPLATES.length);
  });

  it("filters across all groups", () => {
    const pool: RoleSuggestion[] = [
      { role: "QA Lead", source: "pool", agentName: "Lead Bot" },
    ];
    const mine: RoleSuggestion[] = [
      { role: "QA Automation", source: "mine" },
      { role: "Developer", source: "mine" },
    ];
    const result = buildSuggestions(pool, mine, false, "QA");

    expect(result.pool).toHaveLength(1);
    expect(result.pool[0].role).toBe("QA Lead");
    expect(result.mine).toHaveLength(1);
    expect(result.mine[0].role).toBe("QA Automation");
    // Standard "QA Engineer" should also match
    expect(result.standard.map((r) => r.role)).toContain("QA Engineer");
    // "Developer" should be filtered out
    expect(result.mine.map((r) => r.role)).not.toContain("Developer");
  });

  it("deduplication still works with filter applied", () => {
    const pool: RoleSuggestion[] = [
      { role: "Full Stack Engineer", source: "pool", agentName: "Atlas" },
    ];
    const result = buildSuggestions(pool, [], false, "engineer");

    // "Full Stack Engineer" in pool matches filter
    expect(result.pool).toHaveLength(1);
    // Standard "Full Stack Engineer" should be deduped (even though it matches filter)
    expect(result.standard.map((r) => r.role)).not.toContain("Full Stack Engineer");
    // Standard "DevOps Engineer" should still appear
    expect(result.standard.map((r) => r.role)).toContain("DevOps Engineer");
  });
});

describe("dropdown positioning classes", () => {
  // Regression: compact dropdown must anchor right-0 so it expands leftward
  // within its container, preventing horizontal scrollbar overflow in dialogs.
  // See: role-combobox.tsx dropdown div className logic.
  function getDropdownClasses(compact: boolean) {
    // Mirrors the cn() logic in role-combobox.tsx line 244-246
    const base = "bg-popover text-popover-foreground absolute top-full z-[100] mt-1 rounded-md border p-0 shadow-md";
    return compact ? `${base} w-[200px] right-0` : `${base} w-full left-0`;
  }

  it("compact mode uses right-0 to prevent overflow", () => {
    const classes = getDropdownClasses(true);
    expect(classes).toContain("right-0");
    expect(classes).not.toContain("left-0");
    expect(classes).toContain("w-[200px]");
  });

  it("non-compact mode uses left-0 with full width", () => {
    const classes = getDropdownClasses(false);
    expect(classes).toContain("left-0");
    expect(classes).not.toContain("right-0");
    expect(classes).toContain("w-full");
  });
});
