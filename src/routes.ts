import type { Cat } from "./logic";

export interface Route {
  authority: string;
  channel: string;
  include: string[];
  deadlineDays: number;
  ladder: { waitDays: number; to: string }[];
}

export const ROUTES: Record<Cat, Route> = {
  garbage: {
    authority: "Municipal sanitation department",
    channel: "Your city's municipal grievance portal or helpline, or the Swachhata app",
    include: ["Exact location and a nearby landmark", "A photo of the garbage", "How long it has been there", "Any health or safety concern"],
    deadlineDays: 3,
    ladder: [
      { waitDays: 3, to: "Ward or zonal sanitation officer" },
      { waitDays: 4, to: "Municipal commissioner's grievance cell" },
      { waitDays: 8, to: "State urban local bodies grievance portal" },
    ],
  },
  streetlight: {
    authority: "Municipal electrical department (street lighting)",
    channel: "Your city's municipal grievance portal or helpline",
    include: ["Pole number if visible", "Exact location and landmark", "How many lights are out", "Safety concern, such as a dark crossing"],
    deadlineDays: 5,
    ladder: [
      { waitDays: 5, to: "Zonal electrical engineer" },
      { waitDays: 5, to: "Municipal commissioner's grievance cell" },
      { waitDays: 10, to: "State urban local bodies grievance portal" },
    ],
  },
  water: {
    authority: "Water supply and sewerage board or department",
    channel: "The water board's complaint helpline or portal",
    include: ["Exact location", "Whether it is a leak, no supply or dirty water", "A photo or short video", "How much water is being wasted"],
    deadlineDays: 2,
    ladder: [
      { waitDays: 2, to: "Executive engineer of the zone" },
      { waitDays: 5, to: "Water board grievance cell" },
      { waitDays: 8, to: "State urban local bodies grievance portal" },
    ],
  },
  pothole: {
    authority: "Department that maintains the road (municipal roads wing or public works)",
    channel: "Your city's municipal grievance portal or helpline",
    include: ["Exact location and landmark", "Size and depth", "A photo with something for scale", "Any accidents or near misses"],
    deadlineDays: 7,
    ladder: [
      { waitDays: 7, to: "Executive engineer for roads" },
      { waitDays: 7, to: "Municipal commissioner's grievance cell" },
      { waitDays: 10, to: "State urban local bodies grievance portal" },
    ],
  },
  unsafe: {
    authority: "Municipal body, or the electricity distribution company for exposed live wires",
    channel: "The relevant helpline. For immediate danger, call your local emergency number first",
    include: ["Exact location", "What the hazard is", "A photo from a safe distance", "Whether children or traffic are at risk"],
    deadlineDays: 1,
    ladder: [
      { waitDays: 1, to: "Zonal officer" },
      { waitDays: 2, to: "Municipal commissioner's grievance cell" },
    ],
  },
  blocked: {
    authority: "Municipal body or traffic police for the road",
    channel: "Your city's municipal grievance helpline, or the traffic police helpline for traffic obstruction",
    include: ["Exact location", "What is blocking the road", "Whether traffic or emergency vehicles are affected", "A photo from a safe distance"],
    deadlineDays: 1,
    ladder: [
      { waitDays: 1, to: "Zonal officer or traffic inspector" },
      { waitDays: 2, to: "Municipal commissioner's grievance cell" },
    ],
  },
  other: {
    authority: "Local municipal grievance cell",
    channel: "Your city's municipal grievance portal or helpline",
    include: ["Exact location", "A clear description", "Photos if possible"],
    deadlineDays: 7,
    ladder: [
      { waitDays: 7, to: "Municipal commissioner's grievance cell" },
      { waitDays: 10, to: "State urban local bodies grievance portal" },
    ],
  },
};

export const routeFor = (c: Cat): Route => ROUTES[c] ?? ROUTES.other;
