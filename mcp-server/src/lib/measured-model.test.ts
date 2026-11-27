import { describe, it, expect } from "vitest";
import {
  modelFamily,
  mainMeasuredModel,
  measuredModelMismatch,
  modelMismatchComment,
  modelMismatchNotice,
} from "./measured-model";

const row = (model: string, out: number) => ({
  model,
  calls: 1,
  input_tokens: 1,
  output_tokens: out,
  cache_read_tokens: 0,
  cache_write_5m_tokens: 0,
  cache_write_1h_tokens: 0,
});

describe("modelFamily", () => {
  it("strips claude- and the version", () => {
    expect(modelFamily("claude-opus-4-7")).toBe("opus");
    expect(modelFamily("claude-fable-5-2")).toBe("fable");
    expect(modelFamily("Sonnet")).toBe("sonnet");
    expect(modelFamily("claude-haiku-4-5-20251001")).toBe("haiku");
  });
  it("is null for unknown or empty", () => {
    expect(modelFamily("gpt-5")).toBeNull();
    expect(modelFamily(null)).toBeNull();
    expect(modelFamily("")).toBeNull();
  });
});

describe("mainMeasuredModel", () => {
  it("picks the model with the most output tokens", () => {
    expect(mainMeasuredModel({ models: [row("claude-opus-4-7", 9000), row("claude-sonnet-4-6", 500)] })).toBe("opus");
  });
  it("a small haiku share does not win", () => {
    expect(mainMeasuredModel({ models: [row("claude-haiku-4-5", 300), row("claude-sonnet-4-6", 4000)] })).toBe("sonnet");
  });
  it("adds versions of one family together", () => {
    expect(mainMeasuredModel({ models: [row("claude-opus-4-6", 600), row("claude-opus-4-7", 600), row("claude-sonnet-4-6", 1000)] })).toBe("opus");
  });
  it("ties go to the first listed", () => {
    expect(mainMeasuredModel({ models: [row("claude-sonnet-4-6", 100), row("claude-opus-4-7", 100)] })).toBe("sonnet");
  });
  it("is null with no rows or no recognised model", () => {
    expect(mainMeasuredModel(null)).toBeNull();
    expect(mainMeasuredModel({ models: [] })).toBeNull();
    expect(mainMeasuredModel({ models: [row("mystery", 10)] })).toBeNull();
  });
});

describe("measuredModelMismatch", () => {
  it("returns the asked family on a mismatch", () => {
    expect(measuredModelMismatch("opus", "sonnet", "haiku")).toBe("sonnet");
    // Callers pass the backup only when no asked-for model was saved, so with
    // a saved one these are flagged.
    expect(measuredModelMismatch("opus", "sonnet")).toBe("sonnet");
    expect(measuredModelMismatch("opus", "fable")).toBe("fable");
  });
  it("accepts the backup only when one is passed (no saved asked-for model)", () => {
    expect(measuredModelMismatch("opus", "sonnet", "opus")).toBeNull();
  });
  it("is null on a match, or when either side is unrecognised or missing", () => {
    expect(measuredModelMismatch("sonnet", "claude-sonnet-4-6")).toBeNull();
    expect(measuredModelMismatch(null, "sonnet")).toBeNull();
    expect(measuredModelMismatch("opus", "gpt-5")).toBeNull();
    expect(measuredModelMismatch("opus", null)).toBeNull();
  });
});

describe("wording", () => {
  it("uses the approved sentences", () => {
    expect(modelMismatchComment("opus", "sonnet")).toBe(
      "This step ran on opus, not sonnet as your settings ask. This session's helpers were loaded before the setting changed. Later steps will be told to use sonnet; if it happens again, restart or resume the session."
    );
    expect(modelMismatchNotice("opus", "sonnet")).toBe(
      "This step's helper ran on opus but your settings ask for sonnet. From now on spawn each helper with the model and effort the claim gives. If your Agent tool can't take them, tell the user: 'Your model setting changed after this session started. Restart or Resume the session to use it.'"
    );
  });
});
