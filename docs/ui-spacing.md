# Shared UI spacing

`app/globals.css` is the source of truth. All application UI margin, padding and
gap utilities use named theme values, including existing pages and dashboard
components. Values below are defaults; change the token, not individual pages.

| Role | Utility / component class | Default |
| --- | --- | --- |
| Shell page padding | `ui-page`, `px-page` | 12px horizontal on mobile, 20px from sm; 20px vertical |
| Page sections / cards | `ui-stack`, `ui-card-grid`, `gap-section`, `space-y-section` | 20px |
| Card padding | `ui-panel`, `p-panel` | 18px |
| Form card padding | `p-form-panel` | 18px mobile, 24px from sm |
| Form / content groups | `ui-field-grid`, `gap-content`, `space-y-content` | 16px |
| Toolbars / related items | `ui-toolbar`, `gap-item` | 12px |
| Controls | `px-control-x py-control-y`, `px-control-button` | 12px/8px; button horizontal 16px |
| Dialog padding | `p-dialog` | 16px mobile, 24px from sm |
| Small related elements | `gap-small`, `mt-small` | 8px |
| Label / caption separation | `mt-tight`, `gap-tight` | 4px |
| Compact separation | `gap-compact`, `mt-compact` | 6px |
| Micro separation | `ml-micro` | 2px |
| Larger intentional spacing | `roomy`, `spacious`, `large` suffixes | 24px, 28px, 32px |
| Bottom dock clearance | `pb-dock` | 96px |

All scale values derive from `--space-unit` (4px). Semantic variables such as
`--space-section`, `--space-panel` and `--space-control-x` can be adjusted
independently. Use semantic variables for role-specific changes; changing the
unit scales all named spacing. Theme dimensions and geometry remain independent.

```tsx
<div className="ui-stack">
  <div className="ui-toolbar">{/* page actions */}</div>
  <div className="ui-card-grid md:grid-cols-2">
    <section className="ui-panel">
      <h2>Title</h2>
      <p className="mt-tight text-muted">Subtitle</p>
      <div className="mt-content ui-field-grid sm:grid-cols-2">{/* fields */}</div>
    </section>
  </div>
</div>
```

The shell already supplies `ui-page` padding. Do not add it again inside a page.
Use independent column stacks when unequal card content would otherwise leave
empty space. Do not use `h-full` on an empty card merely to match a taller neighbor.

`npm run lint` enforces named spacing in all `app/**/*.tsx` and
`components/**/*.tsx`, including template strings and shared class constants.
Numeric `p-4`, `gap-5`, `mt-2` and arbitrary `gap-[17px]` are rejected. Zero/auto
resets, dimensions (`h-10`, `w-60`), and safe-area padding using `var(--space-...)`
are allowed. New exceptional spacing belongs in the theme with its role documented.
