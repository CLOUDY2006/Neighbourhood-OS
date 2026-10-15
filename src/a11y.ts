import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";
export interface A11y { size: "normal" | "large" | "xl"; contrast: boolean; motion: boolean; theme: ThemePref }
const KEY = "nos-a11y";
let cur: A11y = { size: "normal", contrast: false, motion: false, theme: "system" };
try { cur = { ...cur, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { /* ignore */ }
const subs = new Set<() => void>();
const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
export const resolvedTheme = (): Theme => (cur.theme === "system" ? (mq?.matches ? "dark" : "light") : cur.theme);
function apply() {
  if (typeof document === "undefined") return;
  const d = document.documentElement, h = d.classList, th = resolvedTheme();
  h.toggle("lg", cur.size === "large"); h.toggle("xl", cur.size === "xl"); h.toggle("hc", cur.contrast); h.toggle("rm", cur.motion);
  d.dataset.theme = th; d.style.colorScheme = th;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", th === "dark" ? "#111013" : "#f7f6f3");
}
apply();
mq?.addEventListener?.("change", () => { if (cur.theme === "system") { apply(); subs.forEach(f => f()); } });
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useA11y = () => useSyncExternalStore(sub, () => cur, () => cur);
export const useTheme = () => useSyncExternalStore(sub, resolvedTheme, (): Theme => "light");
export function setA11y(p: Partial<A11y>) {
  cur = { ...cur, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* ignore */ }
  apply(); subs.forEach(f => f());
}
export const toggleTheme = () => setA11y({ theme: resolvedTheme() === "dark" ? "light" : "dark" });
