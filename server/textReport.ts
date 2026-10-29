/**
 * Reporting a problem by WhatsApp or SMS. Everything here is pure (no network, no database) so it can be tested.
 * A report needs a description and a place. People can send them in any order, with an optional photo,
 * so the server keeps a small draft between messages and creates the report once both are there.
 */

export interface Draft { text?: string; photo?: string; lat?: number; lng?: number; approx?: boolean }
export interface Incoming { text?: string; photo?: string; lat?: number; lng?: number; centre?: boolean }
export type Cmd = "help" | "cancel" | "centre";

export const MIN_TEXT = 8, MAX_TEXT = 500, DRAFT_MINUTES = 30, MAX_PHOTO_BYTES = 1_000_000;

const inRange = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** Finds a map position in a message: a Google/OpenStreetMap link, a geo: link, or plain "28.5663, 77.2115". Returns the message with that part removed. */
export function findCoords(body: string): { lat?: number; lng?: number; rest: string } {
  const pats: RegExp[] = [
    /@(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/,
    /[?&](?:q|ll|query|center|destination)=(-?\d{1,3}\.\d{3,})(?:,|%2C)\s*(-?\d{1,3}\.\d{3,})/i,
    /geo:(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/i,
    /mlat=(-?\d{1,3}\.\d+)&(?:amp;)?mlon=(-?\d{1,3}\.\d+)/i,
    /#map=\d+\/(-?\d{1,3}\.\d+)\/(-?\d{1,3}\.\d+)/i,
    /(?<![\d.])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?![\d.])/,
  ];
  for (const re of pats) {
    const m = re.exec(body); if (!m) continue;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (!inRange(lat, lng)) continue;
    // Remove the whole word (or link) that held the position, so it does not end up in the description.
    const start = body.lastIndexOf(" ", m.index) + 1, endSp = body.indexOf(" ", m.index + m[0].length);
    const token = body.slice(start, endSp === -1 ? undefined : endSp);
    const rest = (/^https?:|^geo:/i.test(token) ? body.replace(token, " ") : body.replace(m[0], " ")).replace(/\s+/g, " ").trim();
    return { lat, lng, rest };
  }
  return { rest: body.trim() };
}

/** Reads a message body into a command, a description and an optional position. */
export function parseBody(raw: string): { cmd?: Cmd; text: string; lat?: number; lng?: number } {
  let body = raw.replace(/\s+/g, " ").trim();
  const first = (body.split(" ")[0] || "").toUpperCase().replace(/[:.,!]+$/, "");
  const second = (body.split(" ")[1] || "").toUpperCase();
  if (body === "?" || ["HELP", "HI", "HELLO", "START", "MENU"].includes(first) && body.split(" ").length === 1) return { cmd: "help", text: "" };
  if (["CANCEL", "RESET", "CLEAR"].includes(first) && body.split(" ").length === 1) return { cmd: "cancel", text: "" };
  if (["CENTRE", "CENTER"].includes(first) && body.split(" ").length === 1) return { cmd: "centre", text: "" };
  if (first === "REPORT" || (first === "NEW" && second === "REPORT")) body = body.split(" ").slice(first === "NEW" ? 2 : 1).join(" ").replace(/^[:\-–]\s*/, "");
  const c = findCoords(body);
  return { text: c.rest.slice(0, MAX_TEXT), lat: c.lat, lng: c.lng };
}

/** Does this look like a real description (some letters, long enough) and not a greeting or a stray number? */
export const looksLikeReport = (t: string) => t.trim().length >= MIN_TEXT && /[\p{L}\p{M}]{3,}/u.test(t);

/** Adds what just arrived to the saved draft. A new description replaces the old one, a new position replaces the old one. */
export function mergeDraft(prev: Draft | null, inc: Incoming, centre?: { lat: number; lng: number }): Draft {
  const d: Draft = { ...(prev ?? {}) };
  if (inc.text && looksLikeReport(inc.text)) d.text = inc.text.trim().slice(0, MAX_TEXT);
  if (inc.photo) d.photo = inc.photo;
  if (inc.lat !== undefined && inc.lng !== undefined && inRange(inc.lat, inc.lng)) { d.lat = inc.lat; d.lng = inc.lng; d.approx = false; }
  else if (inc.centre && centre) { d.lat = centre.lat; d.lng = centre.lng; d.approx = true; }
  return d;
}

export const missing = (d: Draft): "text" | "location" | null => (!d.text ? "text" : d.lat === undefined || d.lng === undefined ? "location" : null);

/** The title of the report: the first sentence, kept short. */
export function titleOf(text: string) {
  const first = text.split(/(?<=[.!?।])\s+/)[0] || text;
  const t = first.replace(/\s+/g, " ").trim();
  return (t.length > 80 ? t.slice(0, 80).replace(/\s+\S*$/, "") + "…" : t).replace(/[.!?।]+$/, "");
}

/** The description saved with the report. Says so when the place is only the neighbourhood centre. */
export const descOf = (d: Draft, channel: "WhatsApp" | "SMS") =>
  `${d.text ?? ""}\n\n[Sent by ${channel}.${d.approx ? " The exact spot was not shared, so the pin is at the neighbourhood centre. Please confirm the location." : ""}]`.slice(0, 1000);

// ---- what we say back (short, because SMS is short)
export const MSG = {
  help: "To report a problem: 1) send a short description (and a photo if you can), 2) share your location. WhatsApp: tap + then Location. SMS: paste a map link or type CENTRE. Also: STATUS, FIXED, NOT FIXED, CANCEL. In danger, call your local emergency number first.",
  askText: "Got your location. Now send a short description of the problem, for example: Garbage piled up near the park gate.",
  askLocation: (t: string) => `Got it: "${t.slice(0, 70)}". Now share your location. WhatsApp: tap + then Location. SMS: paste a map link or type CENTRE to use the neighbourhood centre.`,
  askBoth: "Photo received. Now send a short description and your location.",
  tooShort: "Please describe the problem in a few words, for example: Big pothole on Main Road. Send HELP for the steps.",
  cancelled: "Cancelled. Nothing was reported.",
  done: (title: string, id: string, cat: string) => `Reported: "${title.slice(0, 60)}" (${cat}). A coordinator will review it. Case ${id}. You can follow it in NEIGHBOURHOOD OS.`,
  photoSkipped: " I could not use the photo (JPEG or PNG under 1 MB only).",
} as const;

// ---- photos
/** The real type of an image, judged from its first bytes, never from what the sender claims. */
export const sniff = (b: Buffer): "jpeg" | "png" | null =>
  b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpeg" : b.length > 8 && b.readUInt32BE(0) === 0x89504e47 ? "png" : null;

/**
 * Removes the metadata blocks from a JPEG (EXIF with GPS and camera details, XMP, IPTC) without re-encoding it.
 * Throws if the file is damaged, so a broken file is never stored.
 */
export function stripJpegMetadata(b: Buffer): Buffer {
  if (sniff(b) !== "jpeg") throw new Error("Not a JPEG");
  const out: Buffer[] = [b.subarray(0, 2)];
  let p = 2;
  while (p < b.length) {
    if (b[p] !== 0xff) throw new Error("Damaged JPEG");
    while (b[p] === 0xff && p < b.length) p++;           // fill bytes
    const m = b[p++];
    if (m === 0xd9) { out.push(Buffer.from([0xff, 0xd9])); return Buffer.concat(out); }
    if (m === 0xda) { out.push(Buffer.from([0xff, 0xda]), b.subarray(p)); return Buffer.concat(out); } // image data follows
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { out.push(Buffer.from([0xff, m])); continue; }       // markers without a length
    if (p + 2 > b.length) throw new Error("Damaged JPEG");
    const len = b.readUInt16BE(p);
    if (len < 2 || p + len > b.length) throw new Error("Damaged JPEG");
    if (m !== 0xe1 && m !== 0xed && m !== 0xfe) out.push(Buffer.from([0xff, m]), b.subarray(p, p + len)); // drop APP1 (EXIF/XMP), APP13 (IPTC) and comments
    p += len;
  }
  throw new Error("Damaged JPEG");
}