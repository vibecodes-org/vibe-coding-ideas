---
paths:
  - "src/actions/user-templates*"
  - "src/components/board/*template*"
---

# Area rules: personal template library (moved from CLAUDE.md)

### Personal Template Library
- Users can save per-idea workflow templates to `user_workflow_templates` for reuse across boards
- "Save to My Templates" button on template detail header (emerald styled, transitions to "Saved")
- Unified "Add Template" dialog with 3 tabs: My Templates / Platform Templates / Create New
- Smart default tab: opens on "My Templates" if user has saved templates, else "Platform Templates"
- Single "+" button in workflows sidebar replaces old book + plus icons
- Server actions in `src/actions/user-templates.ts`: save, list, delete, isTemplateSaved, importFromMyTemplate
- Copy-based: templates are copied, not referenced — no cross-idea dependencies
