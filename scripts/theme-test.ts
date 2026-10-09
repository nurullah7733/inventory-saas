import assert from "node:assert/strict";
import { parseThemePreference, resolveTheme, THEME_INIT_SCRIPT } from "../lib/client/theme.ts";
import { runInNewContext } from "node:vm";

for (const value of [null, undefined, "invalid", "system"]) assert.equal(parseThemePreference(value), "system");
assert.equal(parseThemePreference("dark"), "dark");
assert.equal(parseThemePreference("light"), "light");
assert.equal(resolveTheme("system", true), "dark");
assert.equal(resolveTheme("system", false), "light");
assert.equal(resolveTheme("light", true), "light");
assert.equal(resolveTheme("dark", false), "dark");
for (const stored of [null, "light", "dark", "invalid", "blocked"]) {
  for (const systemDark of [false, true]) {
    const classes = new Set<string>();
    let systemChange: (() => void) | undefined;
    const media = { matches: systemDark, addEventListener(_type: string, listener: () => void) { systemChange = listener; } };
    const root = { classList: { toggle(name: string, enabled: boolean) { if (enabled) classes.add(name); else classes.delete(name); } }, dataset: {} as { theme?: string }, style: {} as { colorScheme?: string } };
    runInNewContext(THEME_INIT_SCRIPT, { document: { documentElement: root }, localStorage: { getItem() { if (stored === "blocked") throw new Error("Storage blocked"); return stored; } }, matchMedia() { return media; } });
    const preference = parseThemePreference(stored);
    assert.equal(root.dataset.theme, preference);
    assert.equal(root.style.colorScheme, resolveTheme(preference, systemDark));
    assert.equal(classes.has("dark"), resolveTheme(preference, systemDark) === "dark");
    media.matches = !systemDark;
    systemChange?.();
    assert.equal(root.style.colorScheme, resolveTheme(preference, !systemDark));
  }
}
console.log("Theme tests passed: system default, manual overrides, invalid/blocked storage and pre-paint initialization.");
