-- Standardise project-kit descriptions to one voice: imperative, outcome-led.
--
-- Follow-up to task 7a4d0598 (descriptions now render on the picker card, which
-- exposed three mixed styles: noun phrases for Web/Mobile/API, "Your AI team for…"
-- for AI App + Marketing Site, and an imperative for Custom). Align the preset
-- kits on one imperative, outcome-led voice. Custom is intentionally left as-is
-- (it's the no-preset escape hatch, already imperative).
--
-- Data-only; idempotent (fixed-value UPDATEs matched by name). Must be applied to
-- prod manually like 00123/00124/00126 (see docs/release-process.md → "Migration
-- tracking drift").

BEGIN;

UPDATE project_kits SET description = 'Ship a full-stack web app, end to end'       WHERE name = 'Web Application';
UPDATE project_kits SET description = 'Build an iOS, Android, or cross-platform app' WHERE name = 'Mobile App';
UPDATE project_kits SET description = 'Build a REST/GraphQL API or backend service'  WHERE name = 'API / Backend';
UPDATE project_kits SET description = 'Build an AI-powered app or agent'             WHERE name = 'AI App / Agent';
UPDATE project_kits SET description = 'Ship a landing page that converts'            WHERE name = 'Marketing Site';

COMMIT;
