/**
 * Pure label -> workflow template matcher, safe to import in the browser.
 * The New Task dialog preview and the server-side attach both use it, so the
 * preview can never disagree with what Create does.
 *
 * Rule: walk the labels in the order they were ticked; the first label that has
 * an auto-rule decides the template. (Matches the per-label loop in
 * addLabelsToTask, where the first applied rule wins.)
 */
export type AutoRuleLite = { label_id: string; template_id: string };

export type AutoRulePick = {
  templateId: string | null;
  sourceLabelId: string | null;
  /** Later labels whose rule points at a different template (they lose). */
  otherMatchedLabelIds: string[];
};

export function pickAutoRuleTemplate(
  labelIdsInOrder: string[],
  rules: AutoRuleLite[]
): AutoRulePick {
  const byLabel = new Map<string, string>();
  for (const r of rules) {
    if (!byLabel.has(r.label_id)) byLabel.set(r.label_id, r.template_id);
  }

  let templateId: string | null = null;
  let sourceLabelId: string | null = null;
  const otherMatchedLabelIds: string[] = [];

  for (const labelId of labelIdsInOrder) {
    const t = byLabel.get(labelId);
    if (!t) continue;
    if (templateId === null) {
      templateId = t;
      sourceLabelId = labelId;
    } else if (t !== templateId) {
      otherMatchedLabelIds.push(labelId);
    }
  }

  return { templateId, sourceLabelId, otherMatchedLabelIds };
}
