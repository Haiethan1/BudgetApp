# Homebooks agent instructions

This repository currently contains planning and design artifacts. The HTML visual reference is not a working budget app.

Before implementation or UI changes, read:

1. [MVP implementation plan](docs/implementation-plan.md) for scope, money rules, permissions, and release checks.
2. [Website specification](docs/website-spec.md) for layouts, tokens, components, interaction states, and responsive behavior.
3. [Website visual reference](docs/website-reference.html) for representative appearance and density.

The implementation plan owns behavior and data rules. The website specification owns UI presentation. Reuse its shared components and tokens across pages. Small unspecified details follow the nearest reference component.

For material design changes, update the specification and visual reference in the same change. Follow the user's latest instructions when they change these decisions. Do not add deferred features or treat fixture data as production defaults.

UI handoffs report implemented screens, intentional deviations, and validation. Include screenshots of the actual app at desktop and phone widths as specified in the website specification. Check relevant empty, loading, error, permission, and edit-conflict states. Reference screenshots do not prove app behavior.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
