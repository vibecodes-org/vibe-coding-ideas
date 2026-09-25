// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseHeldList, makeIsRecorded, classify, heldListProblems } from "./migration-drift.mjs";

describe("parseHeldList", () => {
  it("treats empty / missing content as an empty list", () => {
    expect(parseHeldList("")).toEqual({ stems: [], errors: [] });
    expect(parseHeldList(undefined)).toEqual({ stems: [], errors: [] });
  });

  it("ignores comment lines, blank lines and trailing comments", () => {
    const text = [
      "# Migrations deliberately not applied to production yet.",
      "",
      "   ",
      "00161_drop_mcp_agent_sessions   # waits for Phase B release",
      "\t# indented comment",
      "00162_other",
    ].join("\n");
    expect(parseHeldList(text)).toEqual({
      stems: ["00161_drop_mcp_agent_sessions", "00162_other"],
      errors: [],
    });
  });

  it("handles CRLF line endings, a trailing .sql and duplicates", () => {
    const text = "00161_a.sql\r\n00161_a\r\n";
    expect(parseHeldList(text)).toEqual({ stems: ["00161_a"], errors: [] });
  });

  it("reports malformed lines with their line number", () => {
    const { stems, errors } = parseHeldList("# header\nnot-a-stem\n00161_a 00162_b\n161_short\n");
    expect(stems).toEqual([]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(errors[1].reason).toMatch(/one migration per line/);
    expect(errors[0].reason).toMatch(/not a migration stem/);
  });
});

describe("makeIsRecorded — historical record formats", () => {
  const isRecorded = makeIsRecorded([
    { version: "20260611191754", name: "00126_refresh_ai_app_agent_labels" }, // current
    { version: "20250301120000", name: "add_product_owner_to_kits" }, // desc-only name
    { version: "00001_create_users", name: null }, // oldest: version = stem
    { version: "00096", name: "" }, // mid-era: version = prefix
  ]);

  it("matches name === full stem", () => {
    expect(isRecorded("00126_refresh_ai_app_agent_labels")).toBe(true);
  });
  it("matches name === description only", () => {
    expect(isRecorded("00110_add_product_owner_to_kits")).toBe(true);
  });
  it("matches version === full stem", () => {
    expect(isRecorded("00001_create_users")).toBe(true);
  });
  it("matches version === numeric prefix", () => {
    expect(isRecorded("00096_anything")).toBe(true);
  });
  it("does not match an unrecorded migration", () => {
    expect(isRecorded("00161_new_thing")).toBe(false);
  });
});

describe("classify", () => {
  const rows = [
    { version: "20260101000000", name: "00001_a" },
    { version: "20260101000001", name: "00002_b" },
    { version: "20260101000002", name: "00004_d" },
  ];
  const stems = ["00004_d", "00001_a", "00002_b", "00003_c", "00005_e"];

  it("with no hold list: recorded vs missing", () => {
    expect(classify({ stems, heldStems: [], rows })).toEqual({
      recorded: ["00001_a", "00002_b", "00004_d"],
      missing: ["00003_c", "00005_e"],
      held: [],
      heldButApplied: [],
      unknownHeld: [],
    });
  });

  it("puts every bucket in play", () => {
    expect(classify({ stems, heldStems: ["00005_e", "00004_d", "00009_typo"], rows })).toEqual({
      recorded: ["00001_a", "00002_b"],
      missing: ["00003_c"],
      held: ["00005_e"],
      heldButApplied: ["00004_d"],
      unknownHeld: ["00009_typo"],
    });
  });

  it("each repo migration lands in exactly one bucket", () => {
    const r = classify({ stems, heldStems: ["00005_e", "00004_d"], rows });
    const all = [...r.recorded, ...r.missing, ...r.held, ...r.heldButApplied].sort();
    expect(all).toEqual([...stems].sort());
  });
});

describe("heldListProblems", () => {
  it("is empty for a clean list", () => {
    expect(heldListProblems(parseHeldList("# only comments\n"), ["00001_a"])).toEqual([]);
    expect(heldListProblems(parseHeldList("00001_a\n"), ["00001_a"])).toEqual([]);
  });

  it("reports malformed lines and unknown stems", () => {
    const problems = heldListProblems(parseHeldList("garbage\n00009_typo\n"), ["00001_a"]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^line 1: "garbage"/);
    expect(problems[1]).toMatch(/00009_typo.*no such file/);
  });
});
