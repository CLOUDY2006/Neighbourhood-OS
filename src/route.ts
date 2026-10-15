import { useSyncExternalStore } from "react";

// Two public pages share one bundle: "/" (landing) and "/signin". Everything inside a neighborhood ignores the path.
const subs = new Set<() => void>();
const path = () => (typeof location === "undefined" ? "/" : location.pathname.replace(/\/+$/, "") || "/");
if (typeof window !== "undefined") window.addEventListener("popstate", () => subs.forEach(f => f()));

export const usePath = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, path, () => "/");
export function go(to: string) {
  if (path() !== to) history.pushState(null, "", to);
  subs.forEach(f => f());
  window.scrollTo(0, 0);
}
