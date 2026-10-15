/** Size of a skill's text as shown on the agent page: characters / 1000, one decimal place. */
export function formatSkillSize(length: number): string {
  return `${(length / 1000).toFixed(1)} KB`;
}
