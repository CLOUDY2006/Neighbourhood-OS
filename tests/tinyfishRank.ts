import assert from "node:assert/strict";
import { cityOnly, isOfficial, rankSources, type RouteSource } from "../server/tinyfish";

const src = (title: string, url: string, snippet = ""): RouteSource => ({ title, url, snippet, official: isOfficial(url, "IN") });

// The kind of results a "dwarka sec-13 delhi" search returned for a pothole report
const found = [
  src("Details DCP/ ACP/ Traffic (Dwarka District)", "https://delhipolice.gov.in/dwarka-traffic", "Dwarka district traffic officers"),
  src("Contact Us | Municipal Corporation of Delhi", "https://mcdonline.nic.in/contact", "Dwarka zone offices"),
  src("PWD SEWA Portal - Delhi Government Services", "https://pwdsewa.delhi.gov.in/", "Report road repair and pothole complaints"),
  src("Top Helpline Numbers in Dwarka Sector 2 - Delhi", "https://www.justdial.com/dwarka-helpline", "Dwarka helpline numbers"),
  src("Reg: Road repair complaint mechanism in Delhi", "https://example.org/road-repair", "How to report potholes"),
];
const potholeOrder = rankSources(found, "dwarka sec-13 delhi", "pothole").map(r => new URL(r.url).hostname);
assert.equal(potholeOrder[0], "pwdsewa.delhi.gov.in", "the road repair portal comes first for a pothole");
assert.ok(potholeOrder.indexOf("example.org") < potholeOrder.indexOf("www.justdial.com"), "a road repair page beats a generic helpline directory");
assert.ok(potholeOrder.indexOf("pwdsewa.delhi.gov.in") < potholeOrder.indexOf("delhipolice.gov.in"), "traffic police are not preferred for a pothole");

// Same results, different problem: the order follows the problem
const waterFound = [
  src("Delhi Jal Board - water leakage complaint", "https://djb.gov.in/complaint", "Report a water leak or supply problem"),
  src("PWD SEWA Portal", "https://pwdsewa.delhi.gov.in/", "Report road repair and pothole complaints"),
];
assert.equal(new URL(rankSources(waterFound, "dwarka sec-13 delhi", "water")[0].url).hostname, "djb.gov.in");
assert.equal(new URL(rankSources(waterFound, "dwarka sec-13 delhi", "pothole")[0].url).hostname, "pwdsewa.delhi.gov.in");

// Duplicates are removed
assert.equal(rankSources([found[0], found[0]], "x city", "pothole").length, 1);

// The city is taken from the end of a longer place name, and only when it is safe to
assert.equal(cityOnly("dwarka sec-13 delhi"), "delhi");
assert.equal(cityOnly("Dwarka, Delhi"), null, "two words: already city level");
assert.equal(cityOnly("Delhi"), null);
assert.equal(cityOnly("Lakeview housing colony"), null, "generic last word is not a city");
assert.equal(cityOnly("sector 14 gurgaon"), "gurgaon");
assert.equal(cityOnly("Block 5 Phase 2"), null);

console.log("tinyfish ranking: all checks passed");