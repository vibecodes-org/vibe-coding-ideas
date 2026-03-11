import { describe, it, expect } from "vitest";
import {
  STATUS_CONFIG,
  COMMENT_TYPE_CONFIG,
  LABEL_COLORS,
  ACTIVITY_ACTIONS,
  DEFAULT_BOARD_COLUMNS,
  POSITION_GAP,
  SORT_OPTIONS,
  BOT_ROLE_TEMPLATES,
  SUGGESTED_TAGS,
} from "./constants";
import type { IdeaStatus, CommentType } from "@/types";

// ── STATUS_CONFIG completeness ────────────────────────────────────────

describe("STATUS_CONFIG", () => {
  const ALL_STATUSES: IdeaStatus[] = [
    "open",
    "in_progress",
    "completed",
    "archived",
  ];

  it("has an entry for every idea status", () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_CONFIG[status]).toBeDefined();
      expect(STATUS_CONFIG[status].label).toBeTruthy();
      expect(STATUS_CONFIG[status].color).toBeTruthy();
      expect(STATUS_CONFIG[status].bgColor).toBeTruthy();
    }
  });

  it("has no extra entries beyond known statuses", () => {
    expect(Object.keys(STATUS_CONFIG).sort()).toEqual(
      [...ALL_STATUSES].sort()
    );
  });
});

// ── COMMENT_TYPE_CONFIG completeness ──────────────────────────────────

describe("COMMENT_TYPE_CONFIG", () => {
  const ALL_COMMENT_TYPES: CommentType[] = [
    "comment",
    "suggestion",
    "question",
  ];

  it("has an entry for every comment type", () => {
    for (const type of ALL_COMMENT_TYPES) {
      expect(COMMENT_TYPE_CONFIG[type]).toBeDefined();
      expect(COMMENT_TYPE_CONFIG[type].label).toBeTruthy();
    }
  });

  it("has no extra entries beyond known types", () => {
    expect(Object.keys(COMMENT_TYPE_CONFIG).sort()).toEqual(
      [...ALL_COMMENT_TYPES].sort()
    );
  });
});

// ── LABEL_COLORS + validation sync ────────────────────────────────────

describe("LABEL_COLORS", () => {
  it("has at least one color", () => {
    expect(LABEL_COLORS.length).toBeGreaterThan(0);
  });

  it("each color has required fields", () => {
    for (const color of LABEL_COLORS) {
      expect(color.value).toBeTruthy();
      expect(color.label).toBeTruthy();
      expect(color.badgeClass).toBeTruthy();
      expect(color.swatchColor).toBeTruthy();
    }
  });

  it("has no duplicate color values", () => {
    const values = LABEL_COLORS.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

// ── ACTIVITY_ACTIONS ──────────────────────────────────────────────────

describe("ACTIVITY_ACTIONS", () => {
  it("each action has label and icon", () => {
    for (const [key, config] of Object.entries(ACTIVITY_ACTIONS)) {
      expect(config.label, `${key} missing label`).toBeTruthy();
      expect(config.icon, `${key} missing icon`).toBeTruthy();
    }
  });

  it("includes key actions used in code", () => {
    const expected = [
      "created",
      "moved",
      "assigned",
      "archived",
      "unarchived",
      "bulk_imported",
    ];
    for (const action of expected) {
      expect(ACTIVITY_ACTIONS[action]).toBeDefined();
    }
  });
});

// ── DEFAULT_BOARD_COLUMNS ─────────────────────────────────────────────

describe("DEFAULT_BOARD_COLUMNS", () => {
  it("has 6 default columns", () => {
    expect(DEFAULT_BOARD_COLUMNS).toHaveLength(6);
  });

  it("positions are ascending", () => {
    for (let i = 1; i < DEFAULT_BOARD_COLUMNS.length; i++) {
      expect(DEFAULT_BOARD_COLUMNS[i].position).toBeGreaterThan(
        DEFAULT_BOARD_COLUMNS[i - 1].position
      );
    }
  });

  it("exactly one column is marked as done", () => {
    const doneCols = DEFAULT_BOARD_COLUMNS.filter((c) => c.is_done_column);
    expect(doneCols).toHaveLength(1);
    expect(doneCols[0].title).toBe("Done");
  });

  it("positions use POSITION_GAP spacing", () => {
    for (let i = 1; i < DEFAULT_BOARD_COLUMNS.length; i++) {
      expect(DEFAULT_BOARD_COLUMNS[i].position).toBe(i * POSITION_GAP);
    }
  });
});

// ── SORT_OPTIONS ──────────────────────────────────────────────────────

describe("SORT_OPTIONS", () => {
  it("has at least one option", () => {
    expect(SORT_OPTIONS.length).toBeGreaterThan(0);
  });

  it("each option has a value and label", () => {
    for (const option of SORT_OPTIONS) {
      expect(option.value).toBeTruthy();
      expect(option.label).toBeTruthy();
    }
  });

  it("has no duplicate values", () => {
    const values = SORT_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

// ── BOT_ROLE_TEMPLATES ───────────────────────────────────────────────

describe("BOT_ROLE_TEMPLATES", () => {
  it("has at least one template", () => {
    expect(BOT_ROLE_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("each template has role, prompt, and structured fields", () => {
    for (const template of BOT_ROLE_TEMPLATES) {
      expect(template.role).toBeTruthy();
      expect(template.prompt).toBeTruthy();
      expect(template.structured).toBeDefined();
      expect(template.structured.goal).toBeTruthy();
      expect(template.structured.constraints).toBeTruthy();
      expect(template.structured.approach).toBeTruthy();
    }
  });

  it("has no duplicate roles", () => {
    const roles = BOT_ROLE_TEMPLATES.map((t) => t.role);
    expect(new Set(roles).size).toBe(roles.length);
  });
});

// ── SUGGESTED_TAGS ───────────────────────────────────────────────────

describe("SUGGESTED_TAGS", () => {
  it("has at least one tag", () => {
    expect(SUGGESTED_TAGS.length).toBeGreaterThan(0);
  });

  it("all tags are non-empty strings", () => {
    for (const tag of SUGGESTED_TAGS) {
      expect(typeof tag).toBe("string");
      expect(tag.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate tags", () => {
    expect(new Set(SUGGESTED_TAGS).size).toBe(SUGGESTED_TAGS.length);
  });
});

