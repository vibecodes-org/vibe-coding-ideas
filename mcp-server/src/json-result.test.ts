import { describe, it, expect } from "vitest";
import { jsonResult } from "./register-tools";
import { RESPONSE_REMINDER } from "./steering-copy";

/**
 * Design Review note 2: `jsonResult`'s `{ live: true }` envelope (design doc
 * §4) is opt-in, applied to exactly get_board/get_task/get_my_tasks at their
 * call sites in register-tools.ts. These tests exercise the helper itself:
 * the plain-object guard, the tool's-own-generated_at-wins spread order, and
 * key ordering (generated_at first, _reminder last).
 */
describe("jsonResult", () => {
  function parse(result: { content: Array<{ text: string }> }) {
    return JSON.parse(result.content[0].text);
  }

  it("leaves non-live calls unchanged", () => {
    const data = { columns: [{ id: "c1" }] };
    const result = jsonResult(data);

    expect(parse(result)).toEqual(data);
  });

  it("stamps generated_at first and _reminder last for a live plain-object payload", () => {
    const data = { columns: [{ id: "c1" }], excluded_done_columns: ["Done"] };
    const result = jsonResult(data, { live: true });
    const parsed = parse(result);

    const keys = Object.keys(parsed);
    expect(keys[0]).toBe("generated_at");
    expect(keys[keys.length - 1]).toBe("_reminder");
    expect(keys).toEqual(["generated_at", "columns", "excluded_done_columns", "_reminder"]);
  });

  it("stamps generated_at as a valid ISO timestamp", () => {
    const result = jsonResult({ foo: "bar" }, { live: true });
    const parsed = parse(result);

    expect(parsed.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(parsed.generated_at).toString()).not.toBe("Invalid Date");
  });

  it("stamps the exact RESPONSE_REMINDER text as _reminder", () => {
    const result = jsonResult({ foo: "bar" }, { live: true });
    const parsed = parse(result);

    expect(parsed._reminder).toBe(RESPONSE_REMINDER);
  });

  it("lets a tool's own generated_at value win over the envelope's default", () => {
    const data = { generated_at: "tool-supplied-value", foo: "bar" };
    const result = jsonResult(data, { live: true });
    const parsed = parse(result);

    // Spread order (`{ generated_at: <default>, ...data, _reminder }`) means
    // the tool's own value overwrites the envelope default, while the key's
    // position (set by its first assignment) still lands first.
    expect(parsed.generated_at).toBe("tool-supplied-value");
    expect(Object.keys(parsed)[0]).toBe("generated_at");
  });

  it("does not stamp an array payload even when live is requested", () => {
    const data = [{ id: "1" }, { id: "2" }];
    const result = jsonResult(data, { live: true });

    expect(parse(result)).toEqual(data);
  });

  it("does not stamp a primitive payload even when live is requested", () => {
    expect(parse(jsonResult("just a string", { live: true }))).toBe("just a string");
    expect(parse(jsonResult(42, { live: true }))).toBe(42);
    expect(parse(jsonResult(null, { live: true }))).toBeNull();
  });

  it("RESPONSE_REMINDER itself stays within the 200-char budget stamped on every live response", () => {
    expect(RESPONSE_REMINDER.length).toBeLessThanOrEqual(200);
  });
});
