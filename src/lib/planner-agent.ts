// The Planner as part of the product (task 472d5672): a platform agent any
// board can copy, and the first starting template in the create-agent screens.
// The text now lives with the other four platform agents in platform-agents.ts
// (stage 3); this file keeps the Planner's own exports for callers that only
// need it. Migration 00190 writes the platform row with the same text.

import { generateInstructions } from "./agent-instructions";
import { PLATFORM_AGENTS } from "./platform-agents";

const planner = PLATFORM_AGENTS.find((a) => a.role === "Planner");
if (!planner) throw new Error("platform-agents.ts has no Planner");

export const PLANNER_AGENT_ID = planner.id;
export const PLANNER_ROLE = planner.role;
export const PLANNER_BIO = planner.bio;
export const PLANNER_INSTRUCTIONS = planner.instructions;

/** The stored text: identical in the platform row and the starting template. */
export const PLANNER_PROMPT = generateInstructions(PLANNER_INSTRUCTIONS);
