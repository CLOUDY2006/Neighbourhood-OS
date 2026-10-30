import type { Issue } from "../src/logic";

/** The OpenStreetMap link to the exact spot of a report. The complaint draft uses the same kind of link. */
export const osmUrl = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;

/**
 * Builds the email that goes to an authority when a coordinator sends an approved complaint.
 * Pure function: no network, no database. The subject carries the report id so a reply can be matched to the report.
 * It never includes the names of the people who reported the problem.
 */
export function buildComplaintEmail(i: Pick<Issue, "id" | "cat" | "priority" | "reports" | "lat" | "lng" | "verifiedBy" | "verif" | "agent">, nbhdName: string, ref: string) {
  const d = i.agent?.draft;
  if (!d) throw new Error("There is no complaint draft to send");
  const verification = i.verif === "verified" || i.verif === "resolved" ? "Verified by a coordinator" : "Not yet verified by a coordinator";
  const subject = `[NOS-${i.id}] ${d.subject}`.slice(0, 200);
  const text = [
    d.body.trim(),
    "",
    "----",
    `Location: ${osmUrl(i.lat, i.lng)}`,
    `Type: ${i.cat} | Priority: ${i.priority} | Reports from neighbours: ${i.reports}`,
    `${verification}. Neighbourhood: ${nbhdName}`,
    ref ? `Reference: ${ref}` : "",
    `Case id: NOS-${i.id}. Please keep this id in the subject when you reply, so we can match your reply to this report.`,
    "",
    "This complaint was written with the help of NEIGHBOURHOOD OS and approved by a person before it was sent. It was emailed by a neighbourhood coordinator. It contains no personal details of the people who reported the problem. A photo is attached when one was uploaded.",
  ].filter((l, n, a) => l !== "" || a[n - 1] !== "").join("\n");
  return { subject, text };
}