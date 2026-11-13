/**
 * Pure helper functions for building AI task generation prompts.
 * Extracted for testability — no side effects or DB access.
 */

export interface AutoRuleMapping {
  labelName: string;
  templateName: string;
  templateDescription: string | null;
}

export interface PromptContext {
  prompt: string;
  ideaTitle: string;
  ideaDescription: string | null;
  existingColumns: string[];
  existingLabels: string[];
  autoRuleMappings: AutoRuleMapping[];
}

/**
 * Build the context parts array for the AI generate-tasks prompt.
 */
export function buildPromptContextParts(ctx: PromptContext): string[] {
  const userPrompt = ctx.prompt.trim();
  const parts = [
    "Generate a structured task board for this idea.",
    ...(userPrompt ? [`**Extra guidance from the user:**\n${userPrompt}`] : []),
    `---`,
    `**Idea Title:** ${ctx.ideaTitle}`,
    `**Idea Description:**\n${ctx.ideaDescription}`,
  ];

  if (ctx.existingColumns.length > 0) {
    parts.push(
      `**Existing Board Columns:** ${ctx.existingColumns.join(", ")}`,
      `Use existing column names where appropriate, or suggest new ones if needed.`
    );
  }

  if (ctx.existingLabels.length > 0) {
    parts.push(
      `**Existing Board Labels:** ${ctx.existingLabels.join(", ")}`,
      `Use these exact label names when labelling tasks. You may also create new labels if needed.`
    );
  }

  if (ctx.autoRuleMappings.length > 0) {
    const ruleLines = ctx.autoRuleMappings.map((r) =>
      `- Label "${r.labelName}" → applies workflow "${r.templateName}"${r.templateDescription ? ` (${r.templateDescription})` : ""}`
    );
    parts.push(
      `**Workflow Triggers:** The following labels have workflow templates that are automatically applied when the label is assigned to a task:\n${ruleLines.join("\n")}`,
      `Classify each task and assign the most appropriate label(s) from the workflow triggers above. For example, a feature task should be labelled "${ctx.autoRuleMappings.find((r) => r.labelName.toLowerCase().includes("feature"))?.labelName ?? ctx.autoRuleMappings[0].labelName}", a bug fix should use the bug label, etc. You may also assign additional labels beyond these.`
    );
  }

  return parts;
}

/**
 * Build auto-rule mappings from raw DB query results.
 */
export function buildAutoRuleMappings(
  labels: { id: string; name: string }[],
  autoRules: { label_id: string; template: { name: string; description: string | null } | null }[]
): AutoRuleMapping[] {
  const labelById = new Map(labels.map((l) => [l.id, l.name]));
  return autoRules
    .map((r) => {
      const labelName = labelById.get(r.label_id);
      if (!labelName || !r.template) return null;
      return {
        labelName,
        templateName: r.template.name,
        templateDescription: r.template.description,
      };
    })
    .filter(Boolean) as AutoRuleMapping[];
}
