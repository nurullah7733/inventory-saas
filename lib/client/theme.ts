export type ThemePreference = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "inventory-saas.theme";
export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  return preference === "system" ? systemDark ? "dark" : "light" : preference;
}
export function applyTheme(preference: ThemePreference, systemDark: boolean) {
  const root = document.documentElement, resolved = resolveTheme(preference, systemDark);
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.dataset.theme = preference;
  root.style.colorScheme = resolved;
}
export function setThemePreference(preference: ThemePreference) {
  try { localStorage.setItem(THEME_STORAGE_KEY, preference); } catch { /* Preference still works when storage is unavailable. */ }
  applyTheme(preference, window.matchMedia("(prefers-color-scheme: dark)").matches);
  window.dispatchEvent(new Event("inventory-theme-change"));
}
export function themeSnapshot(): ThemePreference { return parseThemePreference(document.documentElement.dataset.theme); }
export function resolvedThemeSnapshot(): "light" | "dark" { return document.documentElement.classList.contains("dark") ? "dark" : "light"; }
export function subscribeTheme(notify: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const systemChange = () => { if (themeSnapshot() === "system") applyTheme("system", media.matches); notify(); };
  const storageChange = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) { applyTheme(parseThemePreference(event.newValue), media.matches); notify(); }
  };
  media.addEventListener("change", systemChange);
  window.addEventListener("storage", storageChange);
  window.addEventListener("inventory-theme-change", notify);
  return () => { media.removeEventListener("change", systemChange); window.removeEventListener("storage", storageChange); window.removeEventListener("inventory-theme-change", notify); };
}
// Runs before page content is painted; only a validated local preference is used.
export const THEME_INIT_SCRIPT = `(()=>{let p="system";try{const s=localStorage.getItem("${THEME_STORAGE_KEY}");if(s==="light"||s==="dark")p=s}catch{}const d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);const r=document.documentElement;r.classList.toggle("dark",d);r.classList.toggle("light",!d);r.dataset.theme=p;r.style.colorScheme=d?"dark":"light";matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>{if(r.dataset.theme==="system"){const dark=matchMedia("(prefers-color-scheme: dark)").matches;r.classList.toggle("dark",dark);r.classList.toggle("light",!dark);r.style.colorScheme=dark?"dark":"light"}})})()`;
