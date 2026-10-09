import assert from "node:assert/strict";
import { Linter } from "eslint";
import spacingRule from "./eslint-spacing-rule.mjs";

const linter = new Linter();
const config = {
  languageOptions: { ecmaVersion: "latest", parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { "ui-theme": { rules: { "named-spacing": spacingRule } } },
  rules: { "ui-theme/named-spacing": "error" },
};
const errors = (source) => linter.verify(source, config).filter((message) => message.severity === 2);
assert.equal(errors('const card = <div className="ui-panel gap-section p-panel mt-tight sm:gap-content" />;').length, 0);
assert.equal(errors('const card = <div className="h-10 w-60 p-0 m-auto gap-0" />;').length, 0);
assert.equal(errors('const card = <div className="p-4 gap-5 mt-2" />;').length, 3);
assert.equal(errors('const classes = "sm:px-3 -mt-2";').length, 2);
assert.equal(errors('const classes = `gap-4 ${active ? "p-2" : "p-content"}`;').length, 2);
assert.equal(errors('const card = <div className="gap-[17px]" />;').length, 1);
assert.equal(errors('const card = <div className="pb-[max(var(--space-dialog),env(safe-area-inset-bottom))]" />;').length, 0);
console.log("UI spacing checks passed: tokens, responsive classes, templates, negative margins, dimensions and safe areas.");
