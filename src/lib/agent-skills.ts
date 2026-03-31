/**
 * Default skills mapping for agent roles.
 *
 * Derived from the project kit agent_roles — uses the most generic/universal
 * skills for each role (not project-type-specific variants).
 *
 * Used as a fallback when creating agents without explicit skills, and for
 * backfilling existing agents with empty skills arrays.
 */

const DEFAULT_SKILLS: Record<string, string[]> = {
  "full stack engineer": ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL"],
  "front end engineer": ["React", "TypeScript", "CSS/Tailwind", "Accessibility", "Responsive Design"],
  "frontend developer": ["React", "TypeScript", "CSS/Tailwind", "Accessibility", "Responsive Design"],
  "backend engineer": ["Node.js", "PostgreSQL", "API Design (REST)", "Caching", "Auth"],
  "backend developer": ["Node.js", "PostgreSQL", "API Design (REST)", "Caching", "Auth"],
  "backend & api engineer": ["API Design (REST/GraphQL)", "PostgreSQL", "Caching", "Message Queues"],
  "ux designer": ["Wireframing", "Accessibility (WCAG 2.1)", "Responsive Design", "User Flows"],
  "ui/ux designer": ["Wireframing", "Accessibility (WCAG 2.1)", "Responsive Design", "User Flows"],
  "qa engineer": ["E2E Testing", "Cross-browser", "Accessibility Audit", "Performance Budget"],
  "qa & test automation lead": ["E2E Testing", "Cross-browser", "Load Testing", "Schema Validation"],
  "devops engineer": ["CI/CD", "Docker", "Monitoring", "Database Migrations", "Health Checks"],
  "database & devops engineer": ["CI/CD", "Docker", "Database Migrations", "Monitoring"],
  "developer": ["TypeScript", "React", "Node.js", "PostgreSQL"],
  "product owner": ["Prioritisation", "User Stories", "Acceptance Criteria"],
  "business analyst": ["Requirements Analysis", "Success Metrics", "Use Case Validation", "Data Analysis"],
  "code reviewer": ["Code Quality", "Security Review", "Performance Analysis", "Best Practices"],
  "security engineer": ["OWASP Top 10", "Auth/AuthZ", "XSS/CSRF Prevention", "RLS"],
  "security & performance lead": ["OWASP Top 10", "Performance Profiling", "Load Testing", "Auth/AuthZ"],
  "mobile developer": ["React Native", "Mobile APIs", "Offline-first", "Touch Targets"],
  "mobile & frontend engineer": ["React Native", "TypeScript", "Mobile APIs", "Responsive Design"],
  "data engineer": ["Data Pipelines", "PostgreSQL", "ETL", "Data Modelling"],
  "senior ml engineer": ["Python", "ML Frameworks (PyTorch/TF)", "Model Deployment", "Data Pipelines"],
};

/**
 * Returns default skills for an agent role, or an empty array if no match.
 * Matching is case-insensitive.
 */
export function getDefaultSkillsForRole(role: string | null): string[] {
  if (!role) return [];
  return DEFAULT_SKILLS[role.trim().toLowerCase()] ?? [];
}
