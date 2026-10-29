import { descOf, findCoords, looksLikeReport, mergeDraft, missing, parseBody, sniff, stripJpegMetadata, titleOf } from "../server/textReport";

let bad = 0;
const check = (m: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(ok ? "ok" : "FAIL", m, extra); };
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-9;

// ---- commands
check("HELP is a command", parseBody("help").cmd === "help" && parseBody("?").cmd === "help" && parseBody("Hi").cmd === "help");
check("CANCEL is a command", parseBody("cancel").cmd === "cancel");
check("CENTRE and CENTER are commands", parseBody("centre").cmd === "centre" && parseBody(" Center ").cmd === "centre");
check("a sentence starting with a command word is a report, not a command", parseBody("Help the street light is broken near the park").cmd === undefined);
check("REPORT prefix is removed", parseBody("REPORT: garbage near the park gate").text === "garbage near the park gate");
check("NEW REPORT prefix is removed", parseBody("new report pothole on main road").text === "pothole on main road");
check("plain text is kept as is", parseBody("Garbage piled near the park gate").text === "Garbage piled near the park gate");
check("text is capped", parseBody("x ".repeat(600)).text.length <= 500);

// ---- positions in text
const g = findCoords("Garbage here https://www.google.com/maps/@28.5663,77.2115,17z please");
check("google maps @lat,lng link", near(g.lat, 28.5663) && near(g.lng, 77.2115), JSON.stringify(g));
check("the link is removed from the text", g.rest === "Garbage here please", g.rest);
const q = findCoords("https://maps.google.com/?q=28.567123,77.212456");
check("maps ?q= link", near(q.lat, 28.567123) && near(q.lng, 77.212456));
check("geo: link", near(findCoords("geo:28.5671,77.2124").lat, 28.5671));
check("openstreetmap link", near(findCoords("https://www.openstreetmap.org/?mlat=28.5671&mlon=77.2124#map=18/28.5671/77.2124").lng, 77.2124));
const plain = findCoords("pothole at 28.5663, 77.2115 near school");
check("plain coordinates", near(plain.lat, 28.5663) && near(plain.lng, 77.2115) && plain.rest === "pothole at near school", plain.rest);
check("a price or phone number is not a position", findCoords("fix costs 5.5, 7.25 rupees").lat === undefined && findCoords("call 9810012345").lat === undefined);
check("an impossible position is ignored", findCoords("see 95.12345, 200.12345").lat === undefined);
check("short map links cannot be read", findCoords("https://maps.app.goo.gl/abc123").lat === undefined);

// ---- is it a real description
check("a real sentence", looksLikeReport("Big pothole on Main Road"));
check("too short", !looksLikeReport("pothole") && !looksLikeReport("ok"));
check("numbers only are not a report", !looksLikeReport("123456789012"));
check("empty is not a report", !looksLikeReport("   "));
check("Hindi works", looksLikeReport("सड़क पर बड़ा गड्ढा है"));

// ---- building the draft over several messages
const centre = { lat: 28.5663, lng: 77.2115 };
let d = mergeDraft(null, { text: "Garbage piled near the park gate" });
check("description first: location is missing", missing(d) === "location");
d = mergeDraft(d, { lat: 28.57, lng: 77.21 });
check("then the location: ready", missing(d) === null && d.approx === false);
d = mergeDraft(null, { lat: 28.57, lng: 77.21 });
check("location first: description is missing", missing(d) === "text");
d = mergeDraft(d, { photo: "p1" }); check("a photo alone does not complete it", missing(d) === "text" && d.photo === "p1");
d = mergeDraft(d, { text: "ok" }); check("a too-short text is ignored", missing(d) === "text");
d = mergeDraft(d, { text: "Street light is out on lane 4" }); check("then the description: ready, photo kept", missing(d) === null && d.photo === "p1");
d = mergeDraft(d, { text: "Actually a water leak near the tank" }); check("a new description replaces the old one", d.text === "Actually a water leak near the tank");
let c = mergeDraft({ text: "Broken bench in the park" }, { centre: true }, centre);
check("CENTRE uses the neighbourhood centre and marks it approximate", near(c.lat, centre.lat) && c.approx === true && missing(c) === null);
c = mergeDraft(c, { lat: 28.58, lng: 77.22 });
check("a real pin replaces the approximate one", near(c.lat, 28.58) && c.approx === false);
check("CENTRE without a known centre does nothing", missing(mergeDraft({ text: "Broken bench in the park" }, { centre: true })) === "location");
check("an invalid pin is ignored", missing(mergeDraft({ text: "Broken bench in the park" }, { lat: 999, lng: 5 })) === "location");

// ---- title and description
check("title is the first sentence", titleOf("Garbage piled up. It smells very bad.") === "Garbage piled up");
check("long title is shortened", titleOf("word ".repeat(40)).length <= 82 && titleOf("word ".repeat(40)).endsWith("…"));
check("description names the channel", descOf({ text: "Hole in road", lat: 1, lng: 1 }, "WhatsApp").includes("Sent by WhatsApp."));
check("approximate location is flagged in the description", descOf({ text: "Hole", approx: true }, "SMS").includes("neighbourhood centre"));

// ---- photos: type is judged from the bytes, metadata is stripped
const seg = (m: number, body: Buffer) => Buffer.concat([Buffer.from([0xff, m]), Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 255]), body]);
const exif = seg(0xe1, Buffer.from("Exif\0\0GPS-LAT-28.5663-LNG-77.2115"));
const jfif = seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0"));
const comment = seg(0xfe, Buffer.from("taken with a phone"));
const xmp = seg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>"));
const scan = Buffer.concat([Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02]), Buffer.from([0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33]), Buffer.from([0xff, 0xd9])]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, exif, xmp, comment, scan]);
const clean = stripJpegMetadata(jpg);
check("sniff says jpeg", sniff(jpg) === "jpeg");
check("sniff says png", sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])) === "png");
check("sniff rejects other files", sniff(Buffer.from("GIF89a....")) === null && sniff(Buffer.from("<html>")) === null);
check("GPS and camera data are removed", !clean.includes("GPS-LAT") && !clean.includes("xmpmeta") && !clean.includes("taken with"));
check("the JFIF header and the image data are kept", clean.includes("JFIF") && clean.subarray(clean.length - scan.length).equals(scan));
check("the result is still a JPEG that ends correctly", sniff(clean) === "jpeg" && clean[clean.length - 2] === 0xff && clean[clean.length - 1] === 0xd9);
let threw = false; try { stripJpegMetadata(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1, 0xff, 0xff, 1, 2])])); } catch { threw = true; }
check("a damaged JPEG is refused", threw);
threw = false; try { stripJpegMetadata(Buffer.from("not an image")); } catch { threw = true; }
check("a non-image is refused", threw);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);