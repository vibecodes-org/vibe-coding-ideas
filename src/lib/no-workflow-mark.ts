/**
 * Whether a board card shows the grey "No workflow" pill: no workflow steps,
 * no open suggestion, not archived, not in a Done column, and no label-driven
 * workflow still being attached.
 */
export function shouldShowNoWorkflowBadge(args: {
  workflowStepTotal: number;
  hasSuggestion: boolean;
  isArchived: boolean;
  columnIsDone: boolean;
  isWiring: boolean;
}): boolean {
  return (
    args.workflowStepTotal === 0 &&
    !args.hasSuggestion &&
    !args.isArchived &&
    !args.columnIsDone &&
    !args.isWiring
  );
}
