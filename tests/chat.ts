import { CHAT_MAX, canModerateChat, canRoom, chatAccess, chatText, demoChatSeed, looksLikePhone, ROOMS, roomsFor, soundsUrgent, type Room } from "../src/chat";
import type { Role } from "../src/logic";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };
const throws = (m: string, f: () => unknown, part: string) => { try { f(); bad++; console.log("FAIL", m, "(no error)"); } catch (e) { const t = (e as Error).message; const ok = t.includes(part); if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, ok ? "" : `-> ${t}`); } };

// ---- who can enter which room
const want: Record<Role, Room[]> = { resident: ["all"], volunteer: ["all", "volunteers"], moderator: ["all", "coordinators"], admin: ["all", "volunteers", "coordinators"] };
for (const [r, rooms] of Object.entries(want) as [Role, Room[]][]) check(`${r} sees exactly ${rooms.join(", ")}`, JSON.stringify(roomsFor(r).map(x => x.id)) === JSON.stringify(rooms));
check("every role can use the neighbourhood room", (Object.keys(want) as Role[]).every(r => canRoom(r, "all")));
check("residents cannot open the volunteer or coordinator rooms", !canRoom("resident", "volunteers") && !canRoom("resident", "coordinators"));
check("volunteers cannot open the coordinator room", !canRoom("volunteer", "coordinators"));
check("moderators moderate the rooms they are in, and only those", canModerateChat("moderator", "all") && canModerateChat("moderator", "coordinators") && !canModerateChat("moderator", "volunteers"));
check("residents and volunteers cannot moderate", ROOMS.every(r => !canModerateChat("resident", r.id) && !canModerateChat("volunteer", r.id)));

// ---- locality: access comes only from membership in this neighbourhood
throws("someone who has not joined the neighbourhood is turned away", () => chatAccess(null, "all"), "Join this neighbourhood first");
throws("a coordinator elsewhere has no role here, so no coordinator room", () => chatAccess(undefined, "coordinators"), "Join this neighbourhood first");
throws("a resident here cannot enter the coordinator room", () => chatAccess("resident", "coordinators"), "not open to your role");
throws("unknown rooms are refused", () => chatAccess("admin", "everyone-everywhere"), "Unknown chat room");
check("a member gets the room they asked for", chatAccess("volunteer", "volunteers") === "volunteers");

// ---- message text
check("trims and keeps line breaks", chatText("  hello\nthere  ") === "hello\nthere");
check("collapses runs of blank lines", chatText("a\n\n\n\nb") === "a\n\nb");
throws("empty messages are refused", () => chatText("   "), "required");
throws("non-text is refused", () => chatText(42), "required");
throws("over-long messages are refused", () => chatText("x".repeat(CHAT_MAX + 1)), "up to");
check("a message at the limit is fine", chatText("x".repeat(CHAT_MAX)).length === CHAT_MAX);
for (const l of ["see https://bit.ly/x", "go to www.example.org now", "visit freegift.xyz", "pay at upi-help.in/pay"]) throws(`links are refused: "${l}"`, () => chatText(l), "Links are not allowed");
for (const ok of ["Meet at 5.30 pm", "It costs Rs. 200", "e.g. the tap", "Sector 4.B gate", "Ok.Thanks"]) check(`ordinary text is allowed: "${ok}"`, chatText(ok) === ok);
check("bidi override characters are stripped", chatText("abc‮def") === "abcdef");
const hindi = "क्‍ष पानी नहीं आ रहा"; // the zero-width joiner shapes Devanagari and must survive
check("joiners used by Hindi script are kept", chatText(hindi) === hindi);

// ---- hints
check("phone numbers are spotted", looksLikePhone("call me on 98765 43210") && looksLikePhone("+91-9876543210"));
check("times and amounts are not phone numbers", !looksLikePhone("meet at 10:30, bring 200 rupees") && !looksLikePhone("flat 1204"));
check("urgent words trigger the 112 hint", soundsUrgent("Fire near block C!") && soundsUrgent("please help") && soundsUrgent("बचाओ"));
check("everyday messages do not", !soundsUrgent("Helpful tip: the market opens at 9") && !soundsUrgent("Is the water back?"));

// ---- demo seed
const seed = demoChatSeed(0);
check("demo seed fills every room", ROOMS.every(r => seed.some(m => m.room === r.id)));
check("demo seed names are labelled as demo", seed.every(m => m.by.includes("(demo)")));
check("demo seed senders could really post in that room", seed.every(m => canRoom(m.role, m.room)));

if (bad) { console.log(`\n${bad} chat test(s) failed`); process.exit(1); }
console.log("\nall chat tests passed");
