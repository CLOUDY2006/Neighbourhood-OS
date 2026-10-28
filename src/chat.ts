import type { Role } from "./logic";

// Chat rooms belong to one neighbourhood. A room id is only ever used together with a neighbourhood id,
// and access comes from the person's membership row in that neighbourhood, so a coordinator in one area
// never sees the coordinator room of another.
export type Room = "all" | "volunteers" | "coordinators";
export interface RoomInfo { id: Room; name: string; who: string; roles: readonly Role[] }
export const ROOMS: readonly RoomInfo[] = [
  { id: "all", name: "Neighbourhood", who: "Everyone who has joined this neighbourhood", roles: ["resident", "admin"] },
  { id: "coordinators", name: "Coordinators", who: "Coordinators of this neighbourhood", roles: ["admin"] },
];
export const CHAT_MAX = 500, CHAT_DAYS = 30, CHAT_HIDE_AT = 3, CHAT_PAGE = 50;

export interface ChatMsg {
  id: number; rev: number; room: Room; by: string; role?: Role; text: string; t: number;
  state: "ok" | "hidden" | "deleted"; mine: boolean; reported: boolean; reports?: number;
}

export const isRoom = (s: unknown): s is Room => ROOMS.some(r => r.id === s);
export const canRoom = (role: Role, room: Room) => !!ROOMS.find(r => r.id === room)?.roles.includes(role);
export const roomsFor = (role: Role) => ROOMS.filter(r => r.roles.includes(role));
export const canModerateChat = (role: Role, room: Room) => role === "admin" && canRoom(role, room);

// `memberRole` is the person's role from their own membership row in this neighbourhood, or null if they have not joined it.
// Platform admins get no special pass here: chat is for the people who live in the area.
export function chatAccess(memberRole: Role | null | undefined, room: unknown): Room {
  if (!memberRole) throw new Error("Join this neighbourhood first");
  if (!isRoom(room)) throw new Error("Unknown chat room");
  if (!canRoom(memberRole, room)) throw new Error(`The ${ROOMS.find(r => r.id === room)!.name} room is not open to your role`);
  return room;
}

const LINK = /(https?:\/\/|www\.)\S|\b[a-z0-9-]{2,}\.(com|net|org|in|io|co|me|ly|xyz|top|link|app|info|click|shop)\b(\/|\s|$)/i;
export function chatText(v: unknown): string {
  if (typeof v !== "string") throw new Error("Message is required");
  const s = v.normalize("NFKC").replace(/[\u0000-\u0009\u000B-\u001F\u007F​‎‏‪-‮⁦-⁩]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!s) throw new Error("Message is required");
  if (s.length > CHAT_MAX) throw new Error(`Messages can be up to ${CHAT_MAX} characters`);
  if (LINK.test(s)) throw new Error("Links are not allowed in chat. This protects neighbours from scams");
  return s;
}

// Hints shown while typing. They never block a message.
export const looksLikePhone = (s: string) => /(\+?\d[\d\s-]{8,}\d)/.test(s) && s.replace(/\D/g, "").length >= 10;
export const soundsUrgent = (s: string) => /\b(help|emergency|fire|trapped|injured|ambulance|bleeding|unconscious|drowning|attack)\b|बचाओ|मदद|आग|एम्बुलेंस|फँस/i.test(s);

// Demo only: a few clearly labelled, simulated messages so each room has something in it.
export interface DemoMsg { id: number; rev: number; room: Room; by: string; role: Role; text: string; t: number; state: ChatMsg["state"]; reporters: string[] }
export function demoChatSeed(now = Date.now()): DemoMsg[] {
  const m = (min: number) => now - min * 60000;
  const rows: [Room, string, Role, string, number][] = [
    ["all", "Ritu (demo)", "resident", "Is anyone else getting low water pressure since this morning?", 190],
    ["all", "Imran (demo)", "resident", "Yes, same on our lane. Started around 7.", 182],
    ["all", "Coordinator Asha (demo)", "admin", "Thanks both. I have asked the water board and will post on the notice board when they reply.", 170],
    ["all", "Vikram (demo)", "resident", "The streetlight near Park Lane is working again.", 45],
    ["coordinators", "Coordinator Joseph (demo)", "admin", "Two pothole reports on Main Street look like the same spot. Can someone check before we verify?", 240],
    ["coordinators", "Coordinator Asha (demo)", "admin", "Checked on the way home. Same pothole, I merged them.", 220],
  ];
  return rows.map(([room, by, role, text, min], i) => ({ id: i + 1, rev: i + 1, room, by, role, text, t: m(min), state: "ok", reporters: [] }));
}