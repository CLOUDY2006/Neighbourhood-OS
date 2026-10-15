import { useSyncExternalStore } from "react";

export interface A11y { size: "normal" | "large" | "xl"; contrast: boolean; motion: boolean }
const KEY = "nos-a11y";
let cur: A11y = { size: "normal", contrast: false, motion: false };
try { cur = { ...cur, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { /* ignore */ }
const subs = new Set<() => void>();
function apply() {
  if (typeof document === "undefined") return;
  const h = document.documentElement.classList;
  h.toggle("lg", cur.size === "large"); h.toggle("xl", cur.size === "xl"); h.toggle("hc", cur.contrast); h.toggle("rm", cur.motion);
}
apply();
export const useA11y = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => cur, () => cur);
export function setA11y(p: Partial<A11y>) {
  cur = { ...cur, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* ignore */ }
  apply(); subs.forEach(f => f());
}
