import { describe, it, expect } from "vitest";
import {
  INITIAL_UPDATE_FLOW_STATE,
  updateFlowReducer,
  updateConfirmBody,
  type UpdateFlowState,
} from "./helper-update-flow";

describe("updateFlowReducer", () => {
  it("no live sessions -> update-clicked skips the confirm, straight to quiescing", () => {
    const next = updateFlowReducer(INITIAL_UPDATE_FLOW_STATE, { type: "update-clicked", sessionCount: 0 });
    expect(next).toEqual({ phase: "quiescing" });
  });

  it("live sessions -> update-clicked goes to confirming with the count carried", () => {
    const next = updateFlowReducer(INITIAL_UPDATE_FLOW_STATE, { type: "update-clicked", sessionCount: 2 });
    expect(next).toEqual({ phase: "confirming", sessionCount: 2 });
  });

  it("confirming -> confirmed -> quiescing", () => {
    const confirming: UpdateFlowState = { phase: "confirming", sessionCount: 2 };
    expect(updateFlowReducer(confirming, { type: "confirmed" })).toEqual({ phase: "quiescing" });
  });

  it("confirming -> cancelled -> idle (cancel is free, nothing happened yet)", () => {
    const confirming: UpdateFlowState = { phase: "confirming", sessionCount: 2 };
    expect(updateFlowReducer(confirming, { type: "cancelled" })).toEqual({ phase: "idle" });
  });

  it("quiescing -> quiesce-settled -> ready", () => {
    const quiescing: UpdateFlowState = { phase: "quiescing" };
    expect(updateFlowReducer(quiescing, { type: "quiesce-settled" })).toEqual({ phase: "ready" });
  });

  it("quiescing -> quiesce-timed-out -> quiesce-timeout", () => {
    const quiescing: UpdateFlowState = { phase: "quiescing" };
    expect(updateFlowReducer(quiescing, { type: "quiesce-timed-out" })).toEqual({ phase: "quiesce-timeout" });
  });

  it("reset returns to idle from any phase", () => {
    expect(updateFlowReducer({ phase: "ready" }, { type: "reset" })).toEqual(INITIAL_UPDATE_FLOW_STATE);
    expect(updateFlowReducer({ phase: "quiesce-timeout" }, { type: "reset" })).toEqual(INITIAL_UPDATE_FLOW_STATE);
  });

  it("out-of-phase events are no-ops (never transition from an unrelated phase)", () => {
    expect(updateFlowReducer(INITIAL_UPDATE_FLOW_STATE, { type: "confirmed" })).toEqual(INITIAL_UPDATE_FLOW_STATE);
    expect(updateFlowReducer(INITIAL_UPDATE_FLOW_STATE, { type: "quiesce-settled" })).toEqual(
      INITIAL_UPDATE_FLOW_STATE,
    );
    const ready: UpdateFlowState = { phase: "ready" };
    expect(updateFlowReducer(ready, { type: "cancelled" })).toEqual(ready);
  });
});

describe("updateConfirmBody", () => {
  it("pluralizes the session count", () => {
    expect(updateConfirmBody(1)).toBe(
      "Your 1 running session will end first — Claude stops on your machine, and your files stay where they are. You can start fresh sessions as soon as the update finishes.",
    );
    expect(updateConfirmBody(2)).toBe(
      "Your 2 running sessions will end first — Claude stops on your machine, and your files stay where they are. You can start fresh sessions as soon as the update finishes.",
    );
  });
});
