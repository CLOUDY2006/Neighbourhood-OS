# NEIGHBORHOOD OS

A community platform where every neighborhood gets its own live, isometric map. Residents report problems, neighbors confirm them, coordinators verify and assign them, volunteers fix them, and proof of the fix goes on the map.

Two ways to use it:

- **Simulated demo.** No account needed. A made-up neighborhood with scripted data and a guided walkthrough. Everything runs in the browser.
- **Real neighborhoods.** Sign up, then join the neighborhood for your area (automatic, about 1 km) or a named one that someone created. Everyone in the same neighborhood sees the same live map and data.

## Setup

Requires Node.js 18 or newer and a free Supabase project.

1. Create a project at supabase.com.
2. In the SQL editor, run `database/schema.sql`.
3. In Authentication, keep email confirmation on. Under URL configuration, add your site URL (http://localhost:5173 while developing).
4. Copy `.env.example` to `.env` and fill it in:
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: public values from Project Settings, API.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: the service key is a secret. It stays on the server and never reaches the browser.
   - `DATABASE_URL`: the Postgres connection string from Project Settings, Database.
   - `CONTACT_EMAIL`: sent in the User-Agent to OpenStreetMap services, as their usage policy requires.
   - `PLATFORM_ADMINS` (optional): comma-separated emails of platform moderators who can act in any neighborhood.
   - `AI_API_KEY` (optional): turns on AI summaries, photo checks and insights. Without it, rule-based fallbacks are used. A free Google Gemini key from Google AI Studio works (`AI_PROVIDER=gemini`, the default). Free tiers have low limits and their terms can allow the provider to use what you send, so use only demo data with a free key.
5. `npm install` then `npm run dev`, and open http://localhost:5173.

To run for real: `npm run build` then `npm start`. The server serves the built app and the API from one port, with a strict content security policy.

`npm run check` type-checks the web app and the server.

## Configuration reference

Everything below goes in `.env`. Only the first group is required for real neighborhoods. With no `.env` at all, the app still runs as the simulated demo.

Values starting with `VITE_` are read when the web app starts or is built, so restart `npm run dev` (or rebuild) after changing them.

### Required

| Variable | What to put |
|---|---|
| `VITE_SUPABASE_URL`, `SUPABASE_URL` | Your project address, like `https://abcd1234.supabase.co`. Same value in both. |
| `VITE_SUPABASE_ANON_KEY` | The public "anon" key. Safe for the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | The secret service key. Server only. Never share it or put it in a `VITE_` variable. |
| `DATABASE_URL` | The Postgres connection string from Supabase, Project Settings, Database. |
| `CONTACT_EMAIL` | Your real contact email. OpenStreetMap services ask for an identifiable contact. |

### Optional

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_SSL` | `true` | Set `false` only for a local Postgres without SSL. |
| `PORT` | `8787` | API and built-app port. |
| `REQUIRE_EMAIL_CONFIRMED` | `false` | When `true`, the server refuses people whose email is not confirmed. Only useful if "Confirm email" is also on in Supabase. |
| `PLATFORM_ADMINS` | empty | Comma-separated emails of moderators who can act in any neighborhood. |
| `CORS_ORIGIN` | empty | Leave empty when the app and API share one address (the normal case). |
| `AI_PROVIDER` | `gemini` | `gemini`, `groq`, `anthropic`, or `openai` (any OpenAI-compatible service, which also needs `AI_BASE_URL` and `AI_MODEL`). |
| `AI_API_KEY` | empty | Turns on AI summaries, photo checks, photo comparison and insights. Without a key, rule-based fallbacks are used. The old `ANTHROPIC_API_KEY` still works on its own and selects Anthropic. |
| `AI_MODEL` | provider default | Model names change often. If the server log shows HTTP 404 for the model, copy the current name from the provider's console. A leftover `claude-*` name is ignored for non-Anthropic providers. |
| `AI_BASE_URL`, `AI_VISION` | empty | Optional endpoint override. `AI_VISION=true` lets Groq or `openai`-style providers receive photos (only if the chosen model accepts images); otherwise photo checks show "Not checked". |
| `TINYFISH_API_KEY` | empty | Turns on the TinyFish features in the AI agent panel (see "TinyFish: verify the route and check the status"). Get a key at agent.tinyfish.ai/api-keys. Server only. Never put it in a `VITE_` variable. Without it the buttons are hidden in live mode. |
| `TRUST_PROXY` | `1` | How many proxies sit in front of the server, so the per-visitor rate limits see the real visitor address. `1` is right for Render, Railway and Fly. Use `0` if the server is reached directly. |
| `TINYFISH_COUNTRY` | `IN` | Two-letter country code that TinyFish searches are limited to. The default is India, where only `gov.in` and `nic.in` sites count as official and pages from other countries' governments are dropped. Set it empty for worldwide results. |
| `TINYFISH_SEARCH_URL`, `TINYFISH_FETCH_URL`, `TINYFISH_AGENT_URL` | TinyFish public servers | Endpoint overrides, used by the tests. Not listed in `.env.example`. |
| `OVERPASS_URL`, `NOMINATIM_URL` | public servers | Override the OpenStreetMap map-data and place-search servers. `OVERPASS_URL` can list several addresses separated by commas. They are tried in order, so a busy server does not leave the map empty. By default three public servers are used. Not listed in `.env.example`. |

### Official local alerts: `CAP_FEEDS`

CAP (Common Alerting Protocol) is the standard format national warning agencies use.

- **Format:** a comma-separated list of web addresses starting with `http://` or `https://`, no spaces needed, for example `CAP_FEEDS=https://example.gov/alerts.xml,https://other.gov/feed.atom`.
- **What each address can be:** one CAP alert file, or an Atom or RSS feed whose entries link to CAP alert files. Up to 40 alerts per feed are read, and feeds are refreshed every 5 minutes.
- **Where to get them:** from the website of your national disaster-management or weather agency. Look for pages titled "CAP", "RSS" or "alerts feed". I could not confirm any current addresses, so none are included.
- **Important limit:** an alert only reaches a neighborhood if it contains map coordinates (a polygon or a circle). Alerts that name only districts or states, with no coordinates, are ignored. Only alerts marked "Actual" are used, not tests or exercises.
- **Checking it works:** restart the server. Failed feeds are logged as "CAP feed failed". In the app, open Account, Notifications, which shows how many feeds are connected.

### Push notifications

1. Run `npx web-push generate-vapid-keys`.
2. Put the public key in `VAPID_PUBLIC_KEY` and the private key in `VAPID_PRIVATE_KEY`.
3. Set `VAPID_SUBJECT` to something like `mailto:you@example.com`.
4. Push needs HTTPS (or localhost). Members then turn it on under Account, Notifications.

### Email

- `SMTP_URL`: your mail server as a web-style address, for example `smtps://username:password@smtp.example.com:465`.
- `SMTP_FROM`: the sender, for example `NEIGHBORHOOD OS <alerts@example.com>`.
- The same mail setup is used for hand-offs to authorities and the weekly summary.

### Text messages and WhatsApp (Twilio)

1. Create a Twilio account and get `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
2. `TWILIO_FROM`: your Twilio phone number, for example `+15551234567`.
3. `TWILIO_WHATSAPP_FROM` (optional): your WhatsApp-enabled sender, written as `whatsapp:+15551234567`.
4. `PUBLIC_URL`: the public web address of this server with no trailing slash, for example `https://neighborhood.example.com`. It must match exactly what Twilio calls, because incoming messages are signature-checked against it.
5. In the Twilio console, set the incoming-message webhook (HTTP POST) of your number or WhatsApp sender to `PUBLIC_URL/api/sms`.
6. Twilio cannot reach `localhost`. For testing, use a tunnel and set `PUBLIC_URL` to the tunnel address.

### Supabase settings

- Authentication, Providers, Email: keep email sign-in on. "Confirm email" is turned off by default in this setup, so people can sign in right after signing up. Turn it off in the Supabase dashboard, or sign-up will still wait for a confirmation email. To require confirmation again, turn it on there and set `REQUIRE_EMAIL_CONFIRMED=true` in `.env`.
- Authentication, URL configuration: add your site address (for example `http://localhost:5173` while developing and your real address when deployed) so confirmation and password-reset links come back to the app.

### Upgrading from an earlier zip

Run `database/schema.sql` again in the Supabase SQL editor. It is safe to repeat, and the newer versions add a `channels` table for notifications.

### Going live checklist

- Serve over HTTPS. Push, installing the app, and location sharing need it.
- Run `npm run build` then `npm start`, with every variable above set on the host.
- Keep `.env` out of the repository. It is already ignored by `.gitignore`.
- This version is not hardened for production yet. See "Honest limits" below.

## How the real-world problems are handled

| Problem | What it does |
|---|---|
| Every neighborhood is different | Each neighborhood is its own record with its own data. The map is built from real OpenStreetMap roads, buildings, parks and water around its center, cached on the server for 30 days. If OSM has too little data, a clearly labeled schematic city is drawn instead. |
| Same neighborhood, same view | Members read the same server state (polled every 5 seconds) and the same cached map. Only zoom and pan are personal. |
| Where do people belong? | Automatic area cells of about 1 km, computed in the browser. Named neighborhoods (200 m to 2 km) can be created and joined by search or invite link. People near a border can join the next area. Up to 5 neighborhoods per person. |
| Location privacy | Location is opt-in. Only the roughly 1 km cell is sent. Exact positions are never sent or stored. Photos are re-encoded in the browser, which strips GPS metadata. |
| Fake or spam reports | Rate limits per user, a cap of 15 open reports each, location must fall inside the neighborhood, a person cannot confirm their own report or confirm twice, and three neighbor flags hide a report until a coordinator reviews it. Authors can withdraw. |
| Fake "verified" claims | Only a human coordinator can mark a report verified. AI output is always labeled a suggestion. |
| Coordinator abuse | Every coordinator action is written to an audit log shown to other coordinators. A neighborhood cannot lose its last coordinator. Platform admins can step in. |
| Who becomes a coordinator? | The creator of a named neighborhood. Otherwise people ask to coordinate, and an existing coordinator (or platform admin) approves in the People tab. |
| Empty neighborhoods | A guided empty state explains how to report, invite neighbors and ask for a coordinator. |
| Data and accounts | Email-confirmed accounts through Supabase Auth. Roles are enforced on the server. Account deletion removes memberships and photos and replaces the person's name with "Former member". |
| Emergencies | The app states in several places that it is not an emergency service, and SOS locations are consent-based, restricted and auto-deleted. |
| Worldwide awareness | Official public hazard feeds are shown globally and can switch a neighborhood into Crisis Mode. Crowd reports stay local. |

## World layer and Crisis Mode

- **World tab:** a global map of official hazard events from USGS (earthquakes), NASA EONET (wildfires, floods, storms, volcanoes) and GDACS (alerts for cyclones, floods, volcanoes and wildfires). The server fetches and caches them for 10 minutes, so browsers never call those services directly. Each event shows its source, time and a link. The layer only informs; it never starts a rescue by itself, and the demo version is clearly labeled simulated.
- **Automatic Crisis Mode:** each neighborhood's state includes the hazards that overlap it (for example a magnitude 6 earthquake within 150 km, or a fire within 25 km). A "watch" level shows a heads-up banner. A "warning" or "severe" level switches the neighborhood into Crisis Mode: an official alert banner, a red alert chip, an emergency-services-first notice, and a prominent SOS tab.
- **Demo:** the Command tab has a "Simulate an earthquake alert" button so the escalation can be shown without waiting for a real event.

## SOS requests (consent-based)

- The form needs an explicit consent tick. The exact location is chosen on the map or from the device, and is only sent when the person presses Send.
- Only the author, the neighborhood's coordinators, and a volunteer a coordinator assigns can see the request and its location. Everyone else sees only a count.
- Closing, cancelling or marking a request helped deletes its location and note immediately. Anything still open is closed and wiped after 24 hours by a background job.
- One active request per person, at most 3 per day. Coordinators see the nearest shelter or aid post and can assign available volunteers.
- Every screen says to call the local emergency number first. Requests stay unverified until a coordinator reviews them.

## Added in this version

- **Works when the connection is bad:** the app is installable (web app manifest and service worker). The map is cached, the last known state is shown with an "Offline" label, and reports, SOS requests, confirmations and check-in replies made offline are saved on the device and sent automatically when the connection returns. Photos need a connection.
- **Text message and WhatsApp (Twilio):** members can link a phone number and receive alerts, and text SAFE, NEED HELP, STATUS or SOS to the service. Texting SOS shares the phone number with coordinators until the request is closed. Set the `TWILIO_*` values and `PUBLIC_URL`, and point the provider's incoming-message webhook at `/api/sms`. Incoming messages are checked against the provider's signature.
- **Other notifications:** web push (needs VAPID keys) and email (needs `SMTP_URL`), with a limit per person per hour. Alerts go out for official alerts near a neighborhood, SOS requests (to coordinators), assignments, safety check-ins and urgent notices. There is also an automated weekly summary.
- **Local official alerts (CAP):** put one or more CAP feed URLs in `CAP_FEEDS`. Alerts whose area covers the neighborhood show in the alert banner with their instructions. For India, the national disaster management and weather agencies publish such feeds, but check their sites for the current addresses.
- **Safety check-ins and extra help register:** a coordinator starts a check-in, members answer "I am safe" or "I need help", and coordinators see who has not replied, with registered neighbors listed first. The register is optional, consent-based and visible only to coordinators.
- **Preparedness:** a plan with evacuation routes and contacts, assembly points and shared equipment, and a summary of volunteer abilities.
- **Neighbor exchange and notice board:** offers and requests with a short message thread, and coordinator announcements that can be pinned or urgent.
- **Council reports:** filters, weekly trends, hotspots, a hand-off tracker, CSV export and a print or save-as-PDF view. A public page, `/?impact=<neighborhood id>`, shows only totals with no names or locations.
- **Hand-off to authorities:** coordinators keep a directory of authorities, pass an issue on (with an email if the authority has one and email is set up) and track whether it was acknowledged, with overdue ones flagged.
- **Languages, voice and accessibility:** English and Hindi, voice input for reports and SOS notes, a keyboard-accessible map, a skip link, text size, high contrast and reduced motion.
- **Smarter suggestions:** duplicate detection scores nearby reports by wording, category and distance, AI can compare a before and after photo, and recurring problem areas are listed (a pattern in past reports, not a prediction).
- **Recognition:** badges and a points list that count only verified reports and completed fixes, so spam earns nothing.

`npm test` runs checks of the shared rules and the CAP parser.

## AI agent workflow

A resident reports a problem (typed or spoken, in Hindi or English). The agent then coordinates the fix, and the map shows its progress as a ring around the pin.

1. **Understands the report.** With an `AI_API_KEY` it detects the language, category, priority and writes an English summary. Without a key it uses simple Hindi and English keyword rules, and labels that clearly.
2. **Merges duplicates** using the existing nearby-report matching.
3. **Chooses the complaint route** from the editable table in `src/routes.ts`: which authority or channel, what to include, how many days to wait, and the escalation steps.
4. **Drafts the complaint** in English or Hindi from a fixed template. The AI never writes the legal wording, so it cannot invent rules or deadlines. The author or a coordinator can edit it.
5. **Waits for a person to approve.** Nothing is ever sent automatically. The app does not file on government portals. The approved text is copied and submitted through the route shown, then marked as sent, with the reference number recorded.
6. **Schedules escalation.** If there is no response by the deadline, the server prepares the next-level draft, which includes a reference to the earlier complaint, and notifies coordinators. A person still has to approve it. It is cancelled if the issue is resolved.
7. **Suggests a community mission.** Garbage gets a cleanup. Water, lights, roads and hazards get a safe follow-up crew that does not touch pipes, wires or open manholes.
8. **Tracks it to the end:** understood, duplicates checked, route, draft, approved, sent, reference received, mission, volunteers, proof of fix, and verified resolved.

Open the Command tab in demo mode and press "Run next step" to play the whole flow with a Hindi report. The demo is scripted, needs no keys, and is labeled simulated.

**Check before relying on it:** the authority names and escalation steps in `src/routes.ts` are generic. Different cities use different portals and offices, so check each entry against your city's official website and edit it.

## TinyFish: verify the route and check the status

Two features in the AI agent panel use [TinyFish](https://www.tinyfish.ai) when `TINYFISH_API_KEY` is set on the server.

**Verify this route (Search and Fetch APIs, free to run).** Press the button on any report. The server works out the city from the neighborhood's area cell, asks TinyFish Search for that city's official complaint pages, reads the top results with TinyFish Fetch, and lists the sources, helpline numbers, emails and complaint or tracker links it found on those pages. Only pages on government domains are marked official. Everything else says "Not confirmed as official". Results are cached for a week per city and category. The numbers and links come from simple pattern matching on the page text, not from an AI, so they can be wrong or out of date. The table in `src/routes.ts` stays as the fallback.

**Check complaint status (Web Agent API, uses TinyFish credits).** After a coordinator has saved a reference number, they paste the public tracker page address and press "Check status". A TinyFish web agent opens the page, looks up the number and reports what the page shows. The goal sent to the agent is read-only: no login, no registration, no new complaint, nothing typed except the reference number. If the page wants a login, OTP or CAPTCHA, the agent stops. The result is shown with a live view link while it runs. If the wording looks like "acknowledged" or "resolved", a button offers to record it, and a coordinator still has to press it. Nothing changes by itself.

**Try it without an account.** When the key is set, the landing page shows a "Find your city's real complaint page" box, and demo mode runs the same lookup live if you type a real city. It uses only Search and Fetch, never the agent, so it costs no credits. It is limited to 6 tries an hour per visitor and 300 a day for the whole site (in memory, so they reset when the server restarts). The free Fetch allowance is limited too, so this cap protects it.

What leaves your server: the city name, the issue category, the tracker address and the reference number. Never names, photos or the exact location. The reference number is a code the authority gave out, but it does go to TinyFish and the portal.

Safeguards: coordinators only for status checks (10 an hour each and 100 a day for the whole server, in memory), tracker addresses must be public `https://` sites, runs are tied to the user who started them, and text read from a web page is shown as plain text only. In demo mode both features show clearly labeled simulated examples and call nothing.

**Not tested for real:** the automated tests (`tests/tinyfishCheck.ts`) use a local mock of the TinyFish API, so they check our requests, parsing and safeguards but not TinyFish itself. Run both features once with a real key before relying on them. Some portals block automated visits or need a CAPTCHA, and then the agent will report that it could not find a status.

## New: review, simulation and analytics

- **Moderator role and four-eyes review.** The lifecycle is now Reported, Under review, Assigned, In progress, Resolution pending review, Resolved. A coordinator can ask for review once proof exists, but the person who asked cannot approve it. A moderator (or a different coordinator) approves or sends it back with a reason. Neighbors can say "it looks fixed" or "not fully fixed", and approval is blocked while more neighbors say it is not fixed. Coordinators set moderators in the People tab.
- **Reporter confirmation (works with a single coordinator).** When a fix is submitted, the person who reported the problem and everyone who confirmed it ("I see this too") get the question "Is the problem fixed?" in the app and through their notification channels (push, email, SMS or WhatsApp; by text they can reply `FIXED` or `NOT FIXED` when exactly one fix is waiting for them). If one of them says it is fixed, the report is resolved and labeled "Confirmed by the reporter". If one says it is not fully fixed, the report goes back to In progress with their note, and a reporter can also reopen a report that was closed without confirmation. The coordinator who submitted the fix still cannot approve it, and neighbors who disagree can still block a "fixed" answer. If nobody answers within 7 days, the coordinator can close the report as "Closed without confirmation". This is shown clearly, it never counts as verified, it earns no proof points, and it is written to the audit log. A different coordinator or moderator can still approve at any time, as before. Answers from reporters are human confirmations, but a person with a second account could fake one, so this is a weaker check than a second reviewer.
- **Proof of fix.** A before and after slider compares the original photo with the evidence. Residents can also add updates and photos. Every issue keeps an assignment history, and reporters get targeted notifications as their report changes status.
- **Visible priority score.** Every issue gets a score out of 100 from fixed rules, listed with the points each reason adds. The score only sorts the list.
- **Action plan.** Each issue has a suggested plan with steps, department, volunteers, effort, materials, safety notes and a printable page. A coordinator approves it, which creates the mission.
- **What-if simulator** (coordinators). Change volunteers, team size, hours, the order of work and the assumed authority delay, and compare against today's setup. It charts projected completions and workload, and can color the map by projected completion. Everything is labeled as an estimate. It never changes any report.
- **Map.** Isometric, flat and list views of the same data. A heatmap of open issues weighted by priority. Coordinators and moderators can show volunteers who chose to share an approximate area, with animated lines to the missions they joined. A "Then vs now" slider redraws the map as it was on an earlier date, rebuilt from the activity log.
- **Pulse.** Interactive charts (Recharts) with date filters: reported and resolved, open issues over time, by category, hours to resolve, and volunteer hours by mission. Each chart is tagged Actual or Estimate.
- **Blocked roads** is a new category, with Hindi and English understanding and its own complaint route.

### Design choices

- The custom isometric map is kept because it draws real OpenStreetMap roads, buildings and parks and matches the reference look. The flat view is the top-down alternative. Leaflet and Three.js are not used.
- Plain CSS is kept instead of Tailwind. Recharts and Framer Motion are used for charts and transitions.

### Upgrading

Run `database/schema.sql` again (it adds the moderator role). If you copy files over an older project, delete `src/Agent.tsx` and `src/Sim.tsx`, which were renamed `AgentPanel.tsx` and `Simulator.tsx`. `npm run seed` adds a clearly labeled fictional neighborhood, "Maple Nagar", that you can join from the search box, and `npm run seed:sql` rewrites `database/seed.sql` with the same data.

`npm test` checks the shared rules, and `npm run test:render` renders the main screens on the server to catch crashes.

## Honest limits

- A location claim is self-asserted. Trust comes from verification, rate limits and moderation, not from proving where someone lives.
- OpenStreetMap coverage varies. Some areas have few buildings mapped, and the app says so.
- State is one JSON document per neighborhood, locked per write. That suits neighborhood-sized communities, but a very busy neighborhood would need normalized tables.
- Photos are stored in Postgres. Move them to object storage if volume grows.
- Updates use polling. Supabase Realtime would make them instant.
- Rate limits are in memory, so run one server instance or add a shared store such as Redis.
- Hidden reports still appear briefly in the event log by title before being hidden.
- There are no email or push notifications yet, only the in-app bell.
- The world feeds are third-party services whose formats and availability can change. GDACS in particular is parsed defensively and the app keeps working if a feed fails. Check each provider's terms and attribution requirements before a public launch.
- Alert radii are simple rules, not a hazard model, and they never replace national warnings.
- SOS depends on the internet, so it will not work when connectivity is down. Queued offline requests and SMS fallback are not built.
- A coordinator may not see a request in time. The app says so and points to emergency services.
- Offline queuing, push, email, text messaging and the service worker could not be tested in the build environment. Try them on a real device with real credentials.
- Hindi translations were written without native review and cover the main screens only.
- Voice input depends on the browser's speech service, and its audio may leave the device.
- Offline copies are cleared on sign-out, but anyone using a shared device while signed in can see them.
- Automated tests cover the shared rules, the CAP parser, the AI providers and the TinyFish module (against a mock), but not the server routes or the screens.
- TinyFish results (route links, helplines, portal status) are suggestions read from third-party websites by software. A person must confirm them.

## Layout

- `src/logic.ts`: shared rules, permissions, validation and demo data. Both the browser (demo) and the server use it.
- `server/cap.ts`, `server/notify.ts`: official local alerts and notification delivery.
- `src/Prepare.tsx`, `src/Exchange.tsx`, `src/Notices.tsx`, `src/Reports.tsx`, `src/Settings.tsx`, `src/PublicImpact.tsx`: the newer panels.
- `public/sw.js`: service worker for offline use and push.
- `src/world.ts`, `server/world.ts`, `src/WorldView.tsx`: hazard events, overlap rules and the world map.
- `src/SosPanel.tsx`: SOS flow.
- `src/geo.ts`, `src/mapdata.ts`: area cells, projections, and the schematic city generator.
- `src/IsoMap.tsx`: the isometric renderer.
- `server/`: Express API, OpenStreetMap fetching, AI, and database access.
- `database/schema.sql`: tables with row-level security enabled. The server connects directly, so those tables are not exposed through Supabase's public API.