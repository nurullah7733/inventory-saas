<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Shared UI spacing

Read `docs/ui-spacing.md` before changing UI layouts. The spacing source of truth
is `app/globals.css`; use its named Tailwind utilities and shared layout classes.
Use `ui-page` for shell page padding, `ui-stack` / `ui-card-grid` for sections,
`ui-panel` for cards, and `ui-field-grid` for fields. Do not add a second page
padding wrapper inside the shell or stretch empty cards to fill another column.
All tenant pages use the shell's full-width main container. Do not add a
route-specific `max-w-4xl` or centered page wrapper; narrow individual forms or
dialogs only when their content requires it.
Use `gap-section`, `gap-content`, `gap-item`, `gap-small`, `mt-tight`, etc. rather
than numeric padding/margin/gap utilities or new hardcoded pixel/rem spacing.
Add a token to the theme and document its role if an existing token cannot fit.
Dimensions, chart geometry, zero/auto resets, and safe-area calculations using
theme variables are distinct from spacing. Run lint and type-check after edits;
the `ui-theme/named-spacing` rule catches numeric and arbitrary UI spacing.
