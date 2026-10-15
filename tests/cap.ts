import { parseCap, capAlertsFor } from "../server/cap";
const now = new Date().toISOString(), later = new Date(Date.now() + 6 * 3600000).toISOString();
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>TEST-1</identifier><sender>test@example.org</sender><sent>${now}</sent><status>Actual</status><msgType>Alert</msgType><scope>Public</scope>
<info><language>en</language><category>Met</category><event>Heavy Rainfall</event><urgency>Expected</urgency><severity>Severe</severity><certainty>Likely</certainty><expires>${later}</expires>
<headline>Heavy rain warning</headline><instruction>Avoid low-lying areas.</instruction>
<area><areaDesc>Test district</areaDesc><polygon>28.0,77.0 28.0,77.5 29.0,77.5 29.0,77.0 28.0,77.0</polygon></area>
<area><areaDesc>Circle zone</areaDesc><circle>10.0,10.0 5</circle></area></info></alert>`;
const a = parseCap(xml);
console.log(a.length, a[0].sev, a[0].polys.length, a[0].circles.length, a[0].instruction);
const hit = capAlertsFor(a, { lat: 28.5663, lng: 77.2115 }, 700), miss = capAlertsFor(a, { lat: 40, lng: 0 }, 700);
console.log("inside polygon:", hit.length, hit[0]?.type, hit[0]?.sev, "| outside:", miss.length);
console.log("test status ignored:", parseCap(xml.replace("<status>Actual</status>", "<status>Test</status>")).length);
