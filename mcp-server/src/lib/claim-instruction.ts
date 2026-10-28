// The `instruction` text of a claim_next_step reply (card 5e654dd1, stage 2).
//
// Pure: it builds the words from facts about the step, so the size and the
// safety rules can be tested without a database. It replaces a block of
// string-building that used to live inside claimNextStep.
//
// What changed from the older hand-off, on purpose:
//  - Earlier steps' write-ups are no longer copied into the reply. The reply
//    lists them (`prior_steps`) and the helper fetches them itself with
//    get_task(step_ids), so a builder never works from a summary.
//  - Each fact is said once: rework feedback and approval notes live in their
//    own fields with a one-line pointer here; expected deliverables are in one
//    top-level field.
//  - The persona is not repeated when a named native helper already has it.
//  - The "append a summary to the task description" paragraph is gone.
//
// Safety wording that must survive any future trimming is pinned by
// claim-instruction.test.ts: model/effort reporting, the fresh-helper rule and
// its reason, the claim token never going to a helper, the human-approval stop,
// fail_step with reset_to_step_id, SAVE-POINT COMMIT and PROTECT PRIOR WORK
// word for word, retry/resume, the inline exception, and the usage command.

export type AgentKind = "claude" | "codex";

export interface PriorStepRef {
  step_id: string;
  title: string;
  output_chars: number;
}

/**
 * The ready-to-paste lookup the helper runs, with the real values filled in
 * (the helper never sees the claim reply, so placeholders would be useless).
 * Above STEP_IDS_PER_CALL ids it becomes several calls of that many each.
 */
export function priorStepsLookup(taskId: string, ideaId: string, ids: string[]): string {
  const groups: string[] = [];
  for (let n = 0; n < ids.length; n += STEP_IDS_PER_CALL) {
    const part = ids.slice(n, n + STEP_IDS_PER_CALL).map((id) => `"${id}"`).join(", ");
    groups.push(`get_task(task_id "${taskId}", idea_id "${ideaId}", step_ids [${part}])`);
  }
  return groups.join(" and ");
}

export interface ClaimInstructionInput {
  agent: AgentKind;
  /** The card and board ids, written into the earlier-steps lookup line. */
  taskId: string;
  ideaId: string;
  /** The MANDATORY MODEL clause (or MODEL SWITCH notice); "" on an Auto step. */
  modelTierInstruction: string;
  /** "the X (Role) persona" or "an appropriate persona for the "Role" role". */
  personaRef: string;
  /** `"<bot id>"`, or a phrase naming the chosen agent's bot_id. */
  agentIdArg: string;
  /** The step has an assigned agent (so the available_agents list is not sent). */
  assigned: boolean;
  /** The role to pick an agent for, when no agent is assigned. */
  agentRole: string | null;
  /** The reply carries `persona_prompt` (persona text or skills exist AND no native helper is named). */
  personaPromptSent: boolean;
  /** The agent has persona text or skills at all, so persona_used can be reported. */
  personaEmbeddable: boolean;
  /** The NATIVE SUBAGENT paragraph, when a native helper is named. */
  nativeInstruction: string | null;
  /** The SKILLS paragraph ("" when the agent has no skills). */
  skillsInstruction: string;
  /** A work_token was minted (the step has an agent to speak as). */
  hasWorkToken: boolean;
  gated: boolean;
  priorSteps: PriorStepRef[];
  /** The step being claimed; written into the helper's save line. */
  stepId: string;
  /** null = no rework feedback. this_step = sent back; earlier_step = background. */
  reworkScope: "this_step" | "earlier_step" | null;
  /** A re-claim of an in-progress step that already has a saved write-up (0 = none). */
  savedOutputChars: number;
  /** How many approval notes ride in `approval_notes`. */
  approvalNotesCount: number;
  /** The persona already carries the PROTECT PRIOR WORK rule. */
  personaCarriesProtectRule: boolean;
  /** EXPECTED DELIVERABLES block, "" when none. */
  deliverablesBlock: string;
  /** A deliverable names a file format, so the file-output block applies. */
  fileDeliverable: boolean;
}

/** The most steps get_task(step_ids) accepts in one call. */
export const STEP_IDS_PER_CALL = 10;

const PROTECT_PRIOR_WORK =
  `PROTECT PRIOR WORK: Include this verbatim in your spawned subagent's brief — 'Never revert, reset, ` +
  "`git checkout`/`restore`, `git clean`, stash, or delete changes you did not make. Unexplained uncommitted " +
  `changes in the working tree are someone else's intentional prior work, not a mess to clean up — build on them. ` +
  `If something looks wrong, conflicting, or unexplained, STOP and report it in your output instead of removing ` +
  `or resetting it.'`;

const SAVE_POINT_COMMIT =
  `SAVE-POINT COMMIT: Before spawning this step's subagent, if this project is a git repository and a previous step's completed work is still uncommitted, commit it locally now on the branch you are already on. Do not create a branch, worktree or folder for this, and never push. Skip this if there is nothing to commit or the project is not a git repository. Never commit secrets or files covered by \`.gitignore\`.`;

const HUMAN_APPROVAL =
  `HUMAN APPROVAL REQUIRED: This step requires human approval. After calling complete_step you MUST STOP. Do NOT call approve_step yourself. Show the user the helper's summary (fetch the full write-up with get_task step_ids only if they ask) and wait for them to explicitly instruct you to approve it.`;

/**
 * The line the session pastes into the helper's brief, with the real step id
 * filled in (the helper never sees the claim reply). The helper saves its own
 * full write-up and hands back only a short summary (card 5e654dd1, stage 3).
 */
export function saveLine(stepId: string): string {
  return (
    `'When you finish, save your full write-up with save_step_output (step_id "${stepId}", work_token), ` +
    `then reply only "Saved N characters" and a summary of at most 2,000 characters: the result, every decision the user must make, ` +
    `and anything I must do next. If you can't save, say so and hand back the full write-up.'`
  );
}

const FILE_DELIVERABLE =
  `DELIVERABLE: This step requires file-based output. For each deliverable with a format in parentheses (e.g. "(HTML)", "(JSON)"):\n` +
  `1. Write the file to the docs/ directory using a descriptive filename based on the step title (e.g. docs/design-review.html)\n` +
  `2. Save a brief summary of what you produced + the file path with save_step_output\n` +
  `3. Do NOT paste the full file content into the saved output — it will be truncated and unreadable\n` +
  `The saved output is for a summary and file path reference only.`;

function claudeIdentity(i: ClaimInstructionInput): string {
  const pick = i.assigned
    ? ""
    : `0. Review the available_agents list and pick the best match for the "${i.agentRole}" role.\n`;

  // Who the helper is.
  let personaLine: string;
  if (i.personaPromptSent) {
    personaLine = `Spawn it with the "persona_prompt" field in this response as its system prompt (${i.personaRef}, included in full).`;
  } else if (i.nativeInstruction) {
    personaLine = `Spawn the NATIVE SUBAGENT below (${i.personaRef}).`;
  } else {
    personaLine = `Call get_agent_prompt with agent_id ${i.agentIdArg} to fetch ${i.personaRef}'s full system prompt, and spawn it with that as its system prompt.`;
  }
  const brief =
    `Brief: this step's description, the work_token` +
    (i.reworkScope ? `, rework_instructions` : "") +
    (i.approvalNotesCount > 0 ? `, approval_notes` : "") +
    `, and this line word for word: ${saveLine(i.stepId)}`;
  const personaUsed = i.personaEmbeddable ? ` persona_used (verbatim/adapted/none),` : ``;

  return (
    `FRESH SUBAGENT: run this step in a fresh subagent that you spawn with your Agent/Task tool, not in this conversation: ` +
    `the persona, model and effort only take effect inside it, and its separate context keeps this step independent of the others, ` +
    `so don't do it yourself because it seems simpler.\n` +
    pick +
    `1. Keep the claim_token (ct_…) yourself and never give it to the helper; the helper gets the work_token (wt_…) so it comments in the persona's voice.\n` +
    `2. ${personaLine} ${brief}\n` +
    `3. RELIABILITY: if the helper errors or drops, retry or resume it (you have its agent id) rather than finishing the step yourself.\n` +
    `4. When it returns, run the usage_command (swap AGENT_ID for the helper's agentId) and pass its JSON line as usage (omit usage on NO_TRANSCRIPT; never let it hold up the step). ` +
    `Call complete_step with this step's id, the claim_token, usage,${personaUsed} model_used and reasoning_effort_used (honest self-report, never blocks completion), without output, because the helper saved it (after asking it for changes, have it save again first). ` +
    `If it couldn't save, pass its full write-up as output, never the summary. On failure call fail_step the same way.\n` +
    `EXCEPTION: only if your client has no subagent/Agent tool at all, do the step inline as that persona (persona_prompt, or get_agent_prompt with as_persona true), ` +
    `pass the work_token on comments, and call complete_step with the claim_token and your full write-up as output, stating verbatim in your output: "Completed inline — no subagent capability." and reporting persona_used "adapted" (an inline run is never verbatim). ` +
    `This is the only exception.`
  );
}

function codexIdentity(i: ClaimInstructionInput): string {
  const pick = i.assigned
    ? ""
    : `0. Review the available_agents list and pick the best match for the "${i.agentRole}" role.\n`;
  const personaItem = i.personaPromptSent
    ? `2. Use persona_prompt verbatim as the child's persona instructions: ${i.personaRef}. It is already included; do not call get_agent_prompt.\n`
    : i.nativeInstruction
      ? `2. The child's persona is ${i.personaRef}. The NATIVE SUBAGENT note below names an agent type that already carries it; if none is available, call get_agent_prompt with agent_id ${i.agentIdArg} and as_persona true, and use its persona_prompt verbatim as the child's persona instructions.\n`
      : `2. Call get_agent_prompt with agent_id ${i.agentIdArg} to obtain ${i.personaRef}'s full persona instructions.\n`;
  const priorLine =
    i.priorSteps.length > 0
      ? `earlier steps (tell the child to read them in full with ${priorStepsLookup(i.taskId, i.ideaId, i.priorSteps.map((p) => p.step_id))} before starting; do not paste or summarise them), `
      : ``;
  return (
    `MANDATORY: execute each workflow step in a FRESH SUBAGENT using Codex's native spawn_agent capability (it may be namespaced as collaboration.spawn_agent).\n` +
    pick +
    `1. Keep claim_token in the orchestrator only. Never forward the entire claim response, because it contains this completion credential.\n` +
    personaItem +
    `3. Start a fresh child: copy execution.model and execution.reasoning_effort into the spawn tool's model and reasoning_effort parameters, and supply a unique task_name and the worker message. Omit null model/effort values on Auto steps. When fork_turns is supported use "none"; otherwise select the client's fresh-context equivalent. Do not pass the entire execution object as tool arguments. In the child's message include the full persona, task requirements from get_task, step title/description/IDs, expected_deliverables, ${priorLine}approval_notes, rework_instructions, work_token, and the actual working directory. Tell the child that its VibeCodes board tools (add_task_comment, add_step_comment, get_task, save_step_output) come from the same VibeCodes MCP server you use, so it should look for them in its full tool list, including MCP or deferred tools, before concluding it has none. Preserve human approval constraints and prior-step feedback. Include this line in the child's message word for word: ${saveLine(i.stepId)} Do not forward unrelated conversation history or substitute a persona summary. If the tool has no system-prompt field, put the full persona at the start of its message as instructions; do not claim to have changed the child's system prompt.\n` +
    `4. The child does this step's work, comments with work_token, saves its deliverable with save_step_output, and returns a short summary and any failure/rework request. It must not claim another step, complete/fail this step, or approve anything. The orchestrator owns those transitions.\n` +
    `5. Wait for that child to finish; retry/resume the same child if interrupted, or if it reports having no VibeCodes board tools (point it at them once; if it still has none, take its full deliverable and pass it as output). Complete only after the child reports the save, using agent: "codex", claim_token, no output, model_used and reasoning_effort_used from the accepted launch, and persona_used (verbatim/adapted/none). Report launch metadata separately from the child's deliverable; never infer it from the child's prose or from your own session default. On failure use fail_step with the same reporting fields; preserve any requested reset_to_step_id. Respect human_check_required and stop at awaiting_approval.\n` +
    `CAPABILITY CHECK: inspect the actual spawn tool schema. If it cannot set both model and effort for a tiered step, or there is no supported subagent capability, do not pretend an inline /model command or a model name in the prompt changes execution. Report the capability gap with a work_token comment and stop before doing the work; do not complete it as a successful tier test. Only report unknown when no accepted launch/runtime configuration is available.\n` +
    `AUTO: when execution.model is null the tier makes no model promise; choose a supported model/effort for the fresh child and record what you actually launched.`
  );
}

/** Builds the full `instruction` string for a claim. */
export function buildClaimInstruction(i: ClaimInstructionInput): string {
  const identity = i.agent === "codex" ? codexIdentity(i) : claudeIdentity(i);
  const blocks: string[] = [];

  if (i.agent === "codex") {
    blocks.push(
      `CLAIM TOKEN: This response includes a one-time "claim_token" for this step. Keep it and pass it as the "claim_token" parameter of complete_step (or fail_step). If you lose it (e.g. after context compaction), call claim_next_step again to re-claim and receive a fresh one.`
    );
    if (i.hasWorkToken) {
      blocks.push(
        `AGENT VOICE: the "work_token" (wt_…) is for ${i.personaRef}. Give it to the child; comments that pass it post in the persona's voice, and it stops working when the step completes, fails or is reset.`
      );
    }
  }

  if (!i.personaCarriesProtectRule) blocks.push(PROTECT_PRIOR_WORK);


  if (i.approvalNotesCount > 0) {
    blocks.push(
      `APPROVER GUIDANCE: a human approved ${i.approvalNotesCount} prior step(s) with notes (see "approval_notes"). Each note is a BINDING requirement on this and all later steps — put them in the helper's brief.`
    );
  }

  if (i.deliverablesBlock) blocks.push(i.deliverablesBlock);
  if (i.gated) blocks.push(HUMAN_APPROVAL);

  if (i.priorSteps.length > 0) {
    // Codex reads the earlier steps via its own child-message line (codexIdentity).
    if (i.agent === "claude") {
      blocks.push(
        `PRIOR STEPS: ${i.priorSteps.length} earlier write-up(s) are listed in "prior_steps" (ids, titles, sizes), not copied. ` +
          `Put this in the helper's brief: "Before starting, read the earlier steps in full with ${priorStepsLookup(i.taskId, i.ideaId, i.priorSteps.map((p) => p.step_id))}; build on them and flag anything your work contradicts." ` +
          `Don't paste or summarise them yourself.`
      );
    }
    blocks.push(
      `CASCADE REJECTION: If you find issues with prior work, use fail_step with reset_to_step_id (ids in "prior_steps") to send work back to the responsible step instead of fixing it yourself.`
    );
    blocks.push(SAVE_POINT_COMMIT);
  }

  if (i.fileDeliverable) blocks.push(FILE_DELIVERABLE);

  if (i.reworkScope === "this_step") {
    blocks.push(
      `⚠️ REWORK REQUIRED: this step was sent back. Address rework_instructions.feedback first.`
    );
  } else if (i.reworkScope === "earlier_step") {
    blocks.push(
      `Earlier in this run, work was sent back; rework_instructions.feedback is background: check it was dealt with.`
    );
  }

  if (i.savedOutputChars > 0) {
    blocks.push(
      `SAVED WRITE-UP: ${i.savedOutputChars} characters are already saved on this step from the earlier claim. If the helper that wrote it finished, complete the step without output; otherwise run the step as normal (a new save replaces it).`
    );
  }

  return [i.modelTierInstruction, identity, i.nativeInstruction, i.skillsInstruction, ...blocks]
    .filter(Boolean)
    .join("\n\n");
}
