import type { Role, Status, Verif } from "./logic";
export type Act = (fn: () => unknown, ok?: string) => Promise<void>;
export type Pt = { lat: number; lng: number } | null;
export const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
export const label = (s: string) => s.replace(/_/g, " ");
export const grp = (s: Status) => (s === "resolved" ? "green" : s === "assigned" || s === "progress" || s === "pending" ? "amber" : "red");
export const VL: Record<Verif, string> = { unverified: "Unverified", review: "Under review", verified: "Verified by coordinator", disputed: "Disputed", resolved: "Resolved" };
export const RL: Record<Role, string> = { resident: "Resident", volunteer: "Volunteer", moderator: "Moderator", admin: "Coordinator" };
