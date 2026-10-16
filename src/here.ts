import { useCallback, useEffect, useRef, useState } from "react";
import { toXY, type LL } from "./geo";

export type HereStatus = "off" | "asking" | "on" | "denied" | "unsupported" | "error";
export interface Here { status: HereStatus; lat: number | null; lng: number | null; acc: number | null }
const OFF: Here = { status: "off", lat: null, lng: null, acc: null };

/** Straight-line distance in meters and whether the point is inside a neighborhood circle. */
export function hereInfo(lat: number, lng: number, center: LL, r: number) {
  const { x, y } = toXY(center, lat, lng), dist = Math.hypot(x, y);
  return { dist, inside: dist <= r };
}
export const fmtDist = (m: number) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

/**
 * Where the person is right now. Kept in memory only: never saved, never sent anywhere.
 * Starts only when asked, or quietly if the browser already has permission.
 */
export function useHere() {
  const [here, setHere] = useState<Here>(OFF);
  const watch = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (watch.current != null && typeof navigator !== "undefined" && navigator.geolocation) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  }, []);
  const stop = useCallback(() => { clear(); setHere(OFF); }, [clear]);
  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setHere({ ...OFF, status: "unsupported" }); return; }
    if (watch.current != null) return;
    setHere({ ...OFF, status: "asking" });
    watch.current = navigator.geolocation.watchPosition(
      p => setHere({ status: "on", lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      e => { clear(); setHere({ ...OFF, status: e.code === 1 ? "denied" : "error" }); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
  }, [clear]);

  useEffect(() => clear, [clear]);
  useEffect(() => {
    let dead = false;
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then(r => { if (!dead && r.state === "granted") start(); }).catch(() => undefined);
    return () => { dead = true; };
  }, [start]);

  return { here, start, stop };
}