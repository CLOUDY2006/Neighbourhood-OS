import type { Cat } from "./logic";

/** One office a complaint can go to. Every address here was published by the office itself or in a filed official record. */
export interface DirEntry {
  id: string; name: string; email: string; phone?: string;
  /** Which kinds of report it suits, and in what order. 1 is the best fit. */
  for: Partial<Record<Cat, number>>;
  /** When to use this office and when not to. */
  note: string;
  /** The page where the address was read. Coordinators can open it to check. */
  source: string;
  /** "official" means the office's own website. "records" means it appears in filed government records and should be double checked. */
  via: "official" | "records";
  checked: string;
}

export interface DirRegion { id: string; label: string; entries: DirEntry[] }

/**
 * Official addresses by state. A region only appears here once its addresses have been confirmed.
 * To add a state, add a region with the match rule in regionFor, and list only addresses you have seen published.
 */
export const DIRECTORY: DirRegion[] = [
  {
    id: "delhi", label: "Delhi",
    entries: [
      {
        id: "delhi-mcd", name: "Municipal Corporation of Delhi: Commissioner's grievance cell", email: "commissioner@mcd.nic.in",
        for: { garbage: 1, streetlight: 1, pothole: 1, unsafe: 1, blocked: 1, other: 1 },
        note: "Sanitation, colony roads and streetlights, and everything else the municipality looks after. This goes to the Commissioner's office. The MCD 311 app is faster for a first complaint.",
        source: "https://www.greentribunal.gov.in/sites/default/files/news_updates/Memo%20of%20Parties%20in%20OA%20No%2041%20of%202026%20Rohit%20Tyagi%20Vs%20Municipal%20Corporation%20of%20Delhi%20and%20Ors..pdf",
        via: "records", checked: "2026-10-29",
      },
      {
        id: "delhi-djb", name: "Delhi Jal Board: grievance cell", email: "grievances-djb@delhi.gov.in", phone: "1916",
        for: { water: 1 },
        note: "Water supply, sewer, water-logging and tanker complaints.",
        source: "https://delhijalboard.delhi.gov.in/jalboard/contact-us",
        via: "official", checked: "2026-10-29",
      },
      {
        id: "delhi-pwd", name: "PWD Delhi: complaint centre", email: "support@pwddelhi.com", phone: "1908",
        for: { pothole: 2, streetlight: 2, blocked: 2, unsafe: 2 },
        note: "Only for the main roads and streetlights that PWD maintains. Colony and inner streets belong to MCD.",
        source: "https://www.pwddelhi.gov.in/grievance-redress",
        via: "official", checked: "2026-10-29",
      },
    ],
  },
];

const clean = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

/** The region for a state name as OpenStreetMap writes it (for example "Delhi", "NCT of Delhi" or "National Capital Territory of Delhi"). */
export function regionFor(state: string): DirRegion | null {
  const s = clean(state);
  if (!s) return null;
  if (/\bdelhi\b/.test(s)) return DIRECTORY.find(r => r.id === "delhi") ?? null;
  return null;
}

/** The offices that suit a kind of report, best fit first. With no kind, every office in the region. */
export function suggestionsFor(region: DirRegion, cat?: Cat): DirEntry[] {
  if (!cat) return [...region.entries];
  return region.entries.filter(e => e.for[cat] != null).sort((a, b) => (a.for[cat] ?? 9) - (b.for[cat] ?? 9));
}