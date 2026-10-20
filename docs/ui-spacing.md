# Shared UI spacing

`app/globals.css` owns the spacing scale and responsive page tokens.
Use `ui-page` once at the shell main container, `ui-stack` / `ui-card-grid`
for sections, `ui-panel` for cards, and `ui-field-grid` for fields.
Tenant pages use the full-width shell container; narrow individual forms only.

Use named utilities: micro/tight/compact for small separations, small/item for
controls, content/section for groups, and roomy/spacious/large for larger
regions. Use page, dialog, form-panel, and control-x/control-y for their named
roles. Do not add numeric or arbitrary margin, padding, or gap values.
Dimensions and chart geometry are independent of spacing. Add and document a
theme token when the existing scale cannot express a new spacing role.
