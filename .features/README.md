# Feature Requests

This directory contains feature requests and planned work for cv-hub. Each feature is a separate markdown file with structured metadata designed for easy AI parsing.

## Directory Structure

```
.features/
├── backlog/        # Planned features not yet started
├── in-progress/    # Features currently being worked on
├── completed/      # Finished features (for reference)
├── _TEMPLATE.md    # Template for new features
└── README.md       # This file
```

## File Naming Convention

Use kebab-case with a short descriptive name:
- `email-notifications.md`
- `oauth-device-flow.md`
- `user-avatar-upload.md`

## Feature File Format

Each feature file uses YAML frontmatter for metadata and markdown for content:

```yaml
---
id: FEAT-001
title: Short descriptive title
priority: high | medium | low
effort: small | medium | large | xl
area: api | web | shared | infra
status: backlog | in-progress | completed | blocked
created: 2025-01-01
updated: 2025-01-15
depends_on: [FEAT-000]  # optional
blocks: [FEAT-002]       # optional
---
```

## Sections

Each feature should include these sections:

1. **Problem** - What problem does this solve?
2. **Solution** - High-level approach
3. **Acceptance Criteria** - Checklist of done conditions
4. **Technical Notes** - Implementation hints, affected files
5. **Open Questions** - Unresolved decisions (optional)

## Priority Levels

- **high** - Critical for MVP or blocking other work
- **medium** - Important but not urgent
- **low** - Nice to have, future enhancement

## Effort Estimates

- **small** - < 1 hour, single file changes
- **medium** - 1-4 hours, few files
- **large** - 4-16 hours, multiple files/components
- **xl** - > 16 hours, major feature

## Working with Features

### Starting work on a feature
1. Move file from `backlog/` to `in-progress/`
2. Update `status: in-progress` in frontmatter
3. Update `updated:` date

### Completing a feature
1. Move file from `in-progress/` to `completed/`
2. Update `status: completed` in frontmatter
3. Mark all acceptance criteria as done

### For AI Assistants

When implementing a feature:
1. Read the feature file thoroughly
2. Check `depends_on` for prerequisites
3. Follow the acceptance criteria as a checklist
4. Reference `Technical Notes` for hints
5. Update the file as you make progress
