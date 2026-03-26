/**
 * Determines whether a user has graduated from the first-run dashboard
 * to the standard dashboard.
 *
 * Activation requires:
 * 1. Meaningful tasks (3+ board tasks on any single board)
 * 2. At least one advanced feature discovered (agents, workflows, or MCP)
 * 3. Manual board interaction OR MCP connection (prevents premature
 *    graduation after onboarding auto-creates content via kits)
 */
export function computeIsActivated({
  hasTasks,
  hasAgents,
  hasWorkflows,
  hasMcpConnection,
  hasUserActivity,
}: {
  hasTasks: boolean;
  hasAgents: boolean;
  hasWorkflows: boolean;
  hasMcpConnection: boolean;
  hasUserActivity: boolean;
}): boolean {
  const hasAdvancedFeature = hasAgents || hasWorkflows || hasMcpConnection;
  const hasManualEngagement = hasUserActivity || hasMcpConnection;
  return hasTasks && hasAdvancedFeature && hasManualEngagement;
}
