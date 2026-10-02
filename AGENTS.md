# Homebooks agent instructions

This repository currently contains planning and design artifacts. The HTML visual reference is not a working budget app.

Before implementation or UI changes, read:

1. [MVP implementation plan](docs/implementation-plan.md) for scope, money rules, permissions, and release checks.
2. [Website specification](docs/website-spec.md) for layouts, tokens, components, interaction states, and responsive behavior.
3. [Website visual reference](docs/website-reference.html) for representative appearance and density.

The implementation plan owns behavior and data rules. The website specification owns UI presentation. Reuse its shared components and tokens across pages. Small unspecified details follow the nearest reference component.

For material design changes, update the specification and visual reference in the same change. Follow the user's latest instructions when they change these decisions. Do not add deferred features or treat fixture data as production defaults.

UI handoffs report implemented screens, intentional deviations, and validation. Include screenshots of the actual app at desktop and phone widths as specified in the website specification. Check relevant empty, loading, error, permission, and edit-conflict states. Reference screenshots do not prove app behavior.
