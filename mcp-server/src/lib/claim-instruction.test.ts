import { describe, it, expect } from "vitest";
import { buildClaimInstruction, priorStepsLookup, STEP_IDS_PER_CALL, type ClaimInstructionInput } from "./claim-instruction";

// The safety rules in a claim hand-off (card 5e654dd1, stage 2). The fine
// wording is pinned in workflows.test.ts; this file pins what must never be
// lost and the size of the slimmed text.

const base: ClaimInstructionInput = {
  agent: "claude",
  taskId: "task-9",
  ideaId: "idea-7",
  modelTierInstruction: "",
  personaRef: "the Atlas (Full Stack Engineer) persona",
  agentIdArg: '"bot-1"',
  assigned: true,
  agentRole: "developer",
  personaPromptSent: false,
  personaEmbeddable: true,
  nativeInstruction: "NATIVE SUBAGENT: spawn vc-atlas.",
  skillsInstruction: "",
  hasWorkToken: true,
  gated: false,
  priorSteps: [],
  hasRework: false,
  approvalNotesCount: 0,
  personaCarriesProtectRule: false,
  deliverablesBlock: "",
  fileDeliverable: false,
};

const build = (over: Partial<ClaimInstructionInput> = {}) => buildClaimInstruction({ ...base, ...over });

describe("buildClaimInstruction", () => {
  it("keeps the claim token away from the helper and gives the helper the work token", () => {
    const text = build();
    expect(text).toContain("never give it to the helper");
    expect(text).toContain("work_token");
  });

  it("makes the finish rules explicit: full deliverable as output to complete_step, fail_step on failure", () => {
    const text = build();
    expect(text).toContain("the helper's full deliverable as output");
    expect(text).toContain("fail_step");
  });

  it("adds the stop-for-approval rule only on a gated step, and never lets the session approve", () => {
    expect(build({ gated: false })).not.toContain("HUMAN APPROVAL REQUIRED");
    const gated = build({ gated: true });
    expect(gated).toContain("HUMAN APPROVAL REQUIRED");
    expect(gated).toContain("Do NOT call approve_step yourself");
  });

  it("gives the real get_task call (task, idea and step ids) and lists no step titles or write-ups", () => {
    const text = build({
      priorSteps: [
        { step_id: "s1", title: "Secret Title", output_chars: 99 },
        { step_id: "s2", title: "Other", output_chars: 5 },
      ],
    });
    expect(text).toContain('get_task(task_id "task-9", idea_id "idea-7", step_ids ["s1", "s2"])');
    expect(text).not.toContain("the step_id values from prior_steps");
    expect(text).not.toContain("Secret Title");
    expect(STEP_IDS_PER_CALL).toBe(10);
  });

  it("splits more than 10 earlier steps into calls of 10, for Claude and Codex", () => {
    const ids = Array.from({ length: 12 }, (_, n) => `s${n + 1}`);
    const lookup = priorStepsLookup("task-9", "idea-7", ids);
    expect(lookup.split(" and ")).toHaveLength(2);
    expect(lookup.split(" and ")[1]).toBe('get_task(task_id "task-9", idea_id "idea-7", step_ids ["s11", "s12"])');
    const priorSteps = ids.map((step_id) => ({ step_id, title: "T", output_chars: 1 }));
    for (const agent of ["claude", "codex"] as const) {
      const text = build({ agent, priorSteps });
      expect(text).toContain(lookup);
    }
  });

  it("only tells the session to pick from available_agents when no agent is assigned (the list is sent only then)", () => {
    expect(build({ assigned: true })).not.toContain("available_agents");
    expect(build({ assigned: true, agent: "codex" })).not.toContain("available_agents");
    expect(build({ assigned: false })).toContain("available_agents");
    expect(build({ assigned: false, agent: "codex" })).toContain("available_agents");
  });

  it("only allows inline work when the client has no subagent tool at all", () => {
    const text = build();
    expect(text).toContain("Completed inline — no subagent capability.");
    expect(text).toContain("no subagent/Agent tool");
  });

  it("is much shorter than the old hand-off for the common case (native helper, no notes)", () => {
    expect(build().length).toBeLessThanOrEqual(3500);
  });

  it("keeps the rework and cascade rules when there is rework or earlier work", () => {
    const text = build({ hasRework: true, priorSteps: [{ step_id: "s1", title: "A", output_chars: 1 }] });
    expect(text).toContain("rework_instructions");
    expect(text).toContain("reset_to_step_id");
  });

  it("gives Codex its own full rulebook instead of relying on server instructions", () => {
    const codex = build({ agent: "codex", gated: true });
    expect(codex).toContain("Keep claim_token in the orchestrator only");
    expect(codex).toContain("or approve anything");
    expect(codex).toContain("complete_step");
    expect(codex).toContain("Do NOT call approve_step yourself");
  });
});
