# NEIGHBOURHOOD OS

**Every neighbourhood, live in 3D. Report it. Fix it. Prove it.**

NEIGHBOURHOOD OS is a civic community platform. Each neighbourhood gets its own live 3D isometric map, built from real OpenStreetMap streets and buildings. Residents pin problems on it (a pothole, overflowing garbage, a broken streetlight), neighbors confirm them, coordinators verify and assign them, volunteers fix them, and proof of the fix goes back on the map. When an official hazard alert covers the area, the same map switches into Crisis Mode with safety check-ins and consent-based SOS requests.

It is built with India in mind (English and Hindi, Indian complaint routes and government sites), and works anywhere OpenStreetMap has data.

- **Demo video:** https://youtu.be/htcGoGhxfN4
- **Design brief:** [NEIGHBOURHOOD-OS-design-brief.pdf](NEIGHBOURHOOD-OS-design-brief.pdf) covers every screen, role, API endpoint and data field. It was checked against the code on 18 October 2026.

## Contents

- [What it does](#what-it-does)
- [Try it in two minutes](#try-it-in-two-minutes)
- [How it is built](#how-it-is-built)
- [Setup](#setup)
- [Deploying to Render](#deploying-to-render)
- [Configuration reference](#configuration-reference)
- [Feature details](#feature-details)
- [Testing](#testing)
- [Honest limits](#honest-limits)
- [Known issues](#known-issues)

## What it does

### The core loop

1. **Report.** A resident clicks the map and types or speaks a short description in English or Hindi. They pick a category and can add a photo. Similar reports nearby are shown, so duplicates get merged instead of piling up.
2. **Confirm.** Neighbors press "I see this too". Three spam flags from neighbors hide a report until a coordinator reviews it.
3. **Verify and assign.** Only a human coordinator or moderator can mark a report verified. They approve an action plan, which creates a community mission, and assign volunteers.
4. **Fix.** Volunteers join the mission and post proof, either a photo or a note.
5. **Prove.** The person who reported the problem confirms the fix, or a second reviewer approves it. A before-and-after slider goes on the issue and the pin turns green.

Alongside the loop, an **AI agent** turns each report into a complaint addressed to the right local authority. A **TinyFish web agent** checks that route against the city's official websites. Nothing is sent without a person approving it.

### Two ways to use it

| Mode | Account? | What you get |
|---|---|---|
| Simulated demo | No | A made-up neighbourhood with scripted data, a guided AI agent walkthrough and a role switcher. Runs entirely in the browser. |
| Real neighbourhoods | Yes (email sign-up) | Join the automatic area of about 1 km you are in, or a named neighbourhood someone created. Everyone in it sees the same live map and data. |

### Feature tour

| Area | What it does |
|---|---|
| Landing and sign-in | Public landing page at `/` with a live 3D city, the five-step loop and a "Find your city's real complaint page" box. Sign-in and neighbourhood picker at `/signin`. |
| Live 3D map | Real OpenStreetMap roads, buildings, parks and water drawn as an isometric city, with moving cars and a night look in dark mode. 3D, Flat and List views. You can rotate and tilt the camera, search, and switch on a priority heatmap, the volunteer overlay, a "Then vs now" slider and "You are here". |
| Issues | Seven categories (pothole, garbage, streetlight, water, unsafe, blocked road, other). Six stages from Reported to Resolved, with one guided next-step button per stage. A priority score out of 100 that lists its reasons. Duplicate detection and spam handling. |
| AI agent | Understands the report (language, category, priority, English summary), picks the complaint route, drafts the complaint in English or Hindi, waits for approval, records reference numbers and prepares escalations. Falls back to simple rules without an API key. |
| TinyFish web agent | "Verify this route" finds a city's official complaint pages, helplines and trackers from live web pages. "Check status" sends a read-only agent to a public complaint tracker. |
| Missions and volunteers | Missions with progress and volunteer hours. Volunteer skills, availability and emergency abilities. Suggested volunteers for each issue. |
| Resources and exchange | Shelters, water points, aid posts and equipment, with shortage flags. Neighbor offers and requests with a message thread. |
| World layer and Crisis Mode | A global hazard map from USGS, NASA EONET and GDACS, plus local CAP feeds. An alert that overlaps the neighbourhood switches on Crisis Mode. |
| SOS | Consent-based help requests, visible only to coordinators and the assigned volunteer. The location is wiped when the request closes, or after 24 hours. |
| Safety and preparedness | Safety check-ins ("I am safe" / "I need help"), an optional extra-help register, an emergency plan, a notice board and an automated weekly summary. |
| Reporting to authorities | Council reports with trends and hotspots, hand-offs to authorities with overdue flags, CSV and PDF export, and a public page that shows totals only. |
| Analytics | Pulse charts tagged Actual or Estimate, AI insights, badges that count only verified work, and a What-if simulator for coordinators. |
| Notifications and offline | In-app bell, web push, email, SMS and WhatsApp, with text commands SAFE, NEED HELP, FIXED, NOT FIXED, STATUS and SOS. The app can be installed, and actions taken offline are sent when the connection returns. |
| Accessibility | English and Hindi, voice input, a keyboard-accessible map, three text sizes, high contrast, reduced motion, and light and dark themes. |

### Roles

The server enforces every permission from the table in `src/logic.ts`. In the code, the coordinator role is called `admin`.

| Role | Who | What they can do |
|---|---|---|
| Resident | Every new member | Report, confirm, flag, report spam, add updates, answer "Is the problem fixed?" on their own reports, send SOS, reply to check-ins, use the neighbor exchange, approve the agent's complaint for their own report. |
| Volunteer | A resident who opts in under Account | Everything a resident can except flagging, plus join missions, set skills and availability, share an approximate area, and post proof of a fix. |
| Moderator | Set by a coordinator in the People tab | Verify or dispute reports, hide and restore them, approve or reject fixes (never their own), close a fix without confirmation. |
| Coordinator | Whoever creates a named neighbourhood, or a member a coordinator promotes | Everything a member can, plus move issues forward, create missions, assign volunteers, manage resources and SOS, run check-ins, post notices, hand issues to authorities, run TinyFish status checks, and use What-if, Reports and People. |
| Platform admin | Emails listed in `PLATFORM_ADMINS` | Acts as a coordinator in any neighbourhood. |

A neighbourhood cannot lose its last coordinator. In the demo, the Role menu in the header lets you preview every role.

### Trust principles

- Only humans verify. AI output is always labelled a suggestion.
- The person who submits a fix can never approve it. A fix closed without confirmation is labelled and never counts as verified.
- Nothing goes to an authority without a person approving it. The app does not file on government portals.
- Location is opt-in. Only an area of about 1 km, or a pin the person chose, is stored. Photos are re-encoded in the browser, which strips GPS data.
- Every coordinator action is written to an audit log that other coordinators can see.
- Simulated data is always labelled, and the app says in several places that it is not an emergency service.

## Try it in two minutes

No keys, database or account are needed for the demo.

1. `npm install` then `npm run dev`, and open http://localhost:5173.
2. On the landing page, press **Try the live demo**.
3. In the Command tab, press **Run next step** nine times to play the AI agent flow on a Hindi report.
4. Use the **Role** menu in the header to see the app as a resident, volunteer, moderator or coordinator. Switch away from Moderator before using Run next step or Reset demo (see [Known issues](#known-issues)).
5. Press **Simulate an earthquake alert** to switch the neighbourhood into Crisis Mode, then open the SOS and Prepare tabs.

## How it is built

| Part | Technology |
|---|---|
| Frontend | React 18, Vite 5, TypeScript, Framer Motion, Recharts, lucide-react icons, plain CSS. The 3D city is drawn on a canvas with SVG pins on top. The world map uses TopoJSON. |
| Backend | One Express server (`server/index.ts`) that serves both the API and the built app, with a strict content security policy. |
| Data and sign-in | Postgres and Supabase Auth. |
| Optional services | An AI provider (Google Gemini by default; Groq, Anthropic or any OpenAI-compatible service also work), TinyFish, Twilio SMS and WhatsApp, web push and SMTP email. |
| Hosting | One Render web service, defined in `render.yaml`. |

### Design decisions worth knowing

- **One document per neighbourhood.** A neighbourhood's whole state is one JSON document (`neighbourhoods.doc` in Postgres). Browsers poll `GET /api/n/:id/state` every 5 seconds. Every write goes through one endpoint, `POST /api/n/:id/action`, which locks the row, checks the caller's role, writes the audit log and sends notifications.
- **Shared rules.** `src/logic.ts` holds the rules, validation and permission table. The browser runs it for the demo and the server runs it for real neighbourhoods, so both behave the same.
- **Real maps, with a fallback.** Map data comes from OpenStreetMap and is cached on the server for 30 days. If an area has too little data, or the servers do not answer, a clearly labelled schematic city is drawn instead.
- **A custom map renderer.** The isometric city is drawn by our own code rather than Leaflet or Three.js, so it can show real OpenStreetMap data in the intended look. The Flat view is the top-down alternative.

### Project layout

```
src/                     React web app (also runs the whole demo in the browser)
  logic.ts               shared rules, permissions, validation and demo data (the server uses it too)
  store.ts               app state, polling, offline queue, demo and live modes
  route.ts               the two public paths: / (landing) and /signin
  App.tsx                app shell plus the Command, Report, Missions, Resources, People and Account tabs
  Landing.tsx            public landing page (styles in landing.css)
  Onboarding.tsx         sign-in and neighbourhood picker
  Detail.tsx             issue detail, the richest screen
  AgentPanel.tsx         AI agent panel, TinyFish card and report analysis card
  agent.ts, routes.ts    agent steps and the editable table of complaint routes per category
  plan.ts                priority score, effort estimates and action plans
  IsoMap.tsx, city3d.ts  map component and the canvas 3D city renderer
  mapdata.ts, geo.ts     OpenStreetMap shapes, area cells, projections, schematic city
  here.ts, Swarm.tsx     "You are here" and volunteer approximate areas
  ListView.tsx           List view of the map
  WorldView.tsx, world.ts  world hazard map, alert banner and overlap rules
  SosPanel.tsx           SOS tab
  Prepare.tsx            check-ins, emergency plan, extra-help register
  Exchange.tsx, Notices.tsx  neighbor exchange and notice board
  Pulse.tsx              analytics charts
  Simulator.tsx, sim.ts  What-if simulator
  Reports.tsx            council reports, authorities directory, hand-offs
  PublicImpact.tsx       public totals-only page
  Settings.tsx           notifications, display settings, badges
  i18n.ts, Voice.tsx, a11y.ts, theme.ts  Hindi strings, voice input, accessibility and theme
server/
  index.ts               Express API, SMS webhook and background jobs
  db.ts                  Postgres pool and transactions
  osm.ts                 OpenStreetMap fetching and caching
  ai.ts                  AI providers and rule-based fallbacks
  tinyfish.ts            TinyFish search, fetch and web agent
  world.ts, cap.ts       global hazard feeds and local CAP alerts
  notify.ts              push, email, SMS and WhatsApp delivery
  seed.ts                fictional "Maple Nagar" neighbourhood
database/
  schema.sql             tables with row-level security (safe to run again)
  seed.sql               SQL version of the seed data
public/
  sw.js                  service worker: offline cache, push, "Cannot reach the server" page
  manifest.webmanifest   installable app manifest and icons
tests/                   rule, provider and module checks, plus a server-side render of the main screens
render.yaml              Render deployment blueprint
```

## Setup

Requires Node.js 18 or newer (Render uses Node 22) and a free Supabase project. Without a `.env` file the app still runs, but only as the simulated demo.

1. Create a project at supabase.com.
2. In the SQL editor, run `database/schema.sql`.
3. In Authentication:
   - Under Providers, Email: keep email sign-in on. Turn "Confirm email" off so people can sign in right after signing up. To require confirmation, leave it on and set `REQUIRE_EMAIL_CONFIRMED=true` in `.env`.
   - Under URL configuration: add your site address (`http://localhost:5173` while developing, and your real address once deployed), so confirmation and password-reset links come back to the app.
4. Copy `.env.example` to `.env` and fill in the required values (see [Configuration reference](#configuration-reference)).
5. `npm install` then `npm run dev`, and open http://localhost:5173. This starts Vite and the API server together.

To run it the production way: `npm run build` then `npm start`. The server serves the built app and the API from one port.

Optional: `npm run seed` adds a clearly labelled fictional neighbourhood, "Maple Nagar", that you can join from the search box. `npm run seed:sql` rewrites `database/seed.sql` with the same data.

### Upgrading an existing install

Run `database/schema.sql` again in the Supabase SQL editor. It is safe to repeat, and adds anything newer versions need, such as the `channels` table for notifications and the moderator role. It also renames tables and columns from older versions to the `neighbourhood` spelling, keeping their data. If you copied files over an older project, delete `src/Agent.tsx` and `src/Sim.tsx`, which were renamed `AgentPanel.tsx` and `Simulator.tsx`.

## Deploying to Render

`render.yaml` defines one web service. It builds with `npm install --include=dev && npm run build`, starts with `npm start`, runs on Node 22 and uses `/api/health` as the health check. It uses Render's `starter` plan; change `plan` in the file if you want a different one.

1. Push the repository to GitHub.
2. In Render, create a new Blueprint and choose the repository.
3. Fill in the variables the blueprint asks for: the Supabase values, `DATABASE_URL`, `CONTACT_EMAIL`, `PUBLIC_URL`, and optionally `PLATFORM_ADMINS`, `AI_API_KEY` and `TINYFISH_API_KEY`.
4. Set `PUBLIC_URL` to the service's address and add the same address to Supabase's URL configuration.
5. Push notifications, email, SMS and CAP feeds are not in the blueprint. Add their variables in the Render dashboard if you use them.

`TRUST_PROXY` defaults to `1`, which is right for Render, so per-visitor rate limits see the real visitor address.

### Going live checklist

- Serve over HTTPS. Push notifications, installing the app and location sharing need it.
- Set every variable you need on the host.
- Keep `.env` out of the repository. It is already in `.gitignore`.
- This version is not hardened for production yet. See [Honest limits](#honest-limits).

## Configuration reference

Everything below goes in `.env`. Only the first group is required for real neighbourhoods.

Values starting with `VITE_` are read when the web app starts or is built, so restart `npm run dev` (or rebuild) after changing them.

### Required

| Variable | What to put |
|---|---|
| `VITE_SUPABASE_URL`, `SUPABASE_URL` | Your project address, like `https://abcd1234.supabase.co`. Same value in both. |
| `VITE_SUPABASE_ANON_KEY` | The public "anon" key, from Project Settings, API. Safe for the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | The secret service key. Server only. Never share it or put it in a `VITE_` variable. |
| `DATABASE_URL` | The Postgres connection string from Supabase, Project Settings, Database. |
| `CONTACT_EMAIL` | Your real contact email. It is sent to OpenStreetMap services, whose usage policy asks for an identifiable contact. |

### Optional

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_SSL` | `true` | Set `false` only for a local Postgres without SSL. |
| `PORT` | `8787` | API and built-app port. |
| `REQUIRE_EMAIL_CONFIRMED` | `false` | When `true`, the server refuses people whose email is not confirmed. Only useful if "Confirm email" is also on in Supabase. |
| `PLATFORM_ADMINS` | empty | Comma-separated emails of moderators who can act in any neighbourhood. |
| `CORS_ORIGIN` | empty | Leave empty when the app and API share one address (the normal case). |
| `PUBLIC_URL` | empty | The public address of the server, with no trailing slash. Needed for Twilio (see below). |
| `AI_PROVIDER` | `gemini` | `gemini`, `groq`, `anthropic`, or `openai` (any OpenAI-compatible service, which also needs `AI_BASE_URL` and `AI_MODEL`). |
| `AI_API_KEY` | empty | Turns on AI summaries, photo checks, photo comparison and insights. Without a key, rule-based fallbacks are used. A free Google Gemini key from Google AI Studio works, but free tiers have low limits and their terms can allow the provider to use what you send, so use only demo data with a free key. The older `ANTHROPIC_API_KEY` still works on its own and selects Anthropic. |
| `AI_MODEL` | provider default | Model names change often. If the server log shows HTTP 404 for the model, copy the current name from the provider's console. A leftover `claude-*` name is ignored for non-Anthropic providers. |
| `AI_BASE_URL`, `AI_VISION` | empty | Optional endpoint override. `AI_VISION=true` lets Groq or `openai`-style providers receive photos (only if the chosen model accepts images); otherwise photo checks show "Not checked". |
| `TINYFISH_API_KEY` | empty | Turns on the TinyFish features (see [TinyFish](#tinyfish-verify-the-route-and-check-the-status)). Get a key at agent.tinyfish.ai/api-keys. Server only. Never put it in a `VITE_` variable. Without it the buttons are hidden in live mode. |
| `TINYFISH_COUNTRY` | `IN` | Two-letter country code that TinyFish searches are limited to. With the default (India), only `gov.in` and `nic.in` sites count as official, and pages from other countries' governments are dropped. Set it empty for worldwide results. |
| `TRUST_PROXY` | `1` | How many proxies sit in front of the server, so per-visitor rate limits see the real visitor address. `1` is right for Render, Railway and Fly. Use `0` if the server is reached directly. |
| `TINYFISH_SEARCH_URL`, `TINYFISH_FETCH_URL`, `TINYFISH_AGENT_URL` | TinyFish public servers | Endpoint overrides, used by the tests. Not listed in `.env.example`. |
| `OVERPASS_URL`, `NOMINATIM_URL` | public servers | Override the OpenStreetMap map-data and place-search servers. `OVERPASS_URL` can list several addresses separated by commas. They are tried in order, so one busy server does not leave the map empty. Three public servers are used by default (the main overpass-api.de one is listed last because it is often overloaded). For more reliability, add a free NextGIS Overpass key as a fourth address, for example `OVERPASS_URL=https://overpass.private.coffee/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.nextgis.com/YOUR_KEY/api/interpreter`. Not listed in `.env.example`. |

### Official local alerts: `CAP_FEEDS`

CAP (Common Alerting Protocol) is the standard format national warning agencies use.

- **Format:** a comma-separated list of addresses starting with `http://` or `https://`, for example `CAP_FEEDS=https://example.gov/alerts.xml,https://other.gov/feed.atom`.
- **What each address can be:** one CAP alert file, or an Atom or RSS feed whose entries link to CAP alert files. Up to 40 alerts per feed are read, and feeds are refreshed every 5 minutes.
- **Where to get them:** from the website of your national disaster-management or weather agency. Look for pages titled "CAP", "RSS" or "alerts feed". For India, the national disaster management and weather agencies publish such feeds; check their sites for the current addresses. None are included here because current addresses could not be confirmed.
- **Important limit:** an alert only reaches a neighbourhood if it contains map coordinates (a polygon or a circle). Alerts that name only districts or states are ignored. Only alerts marked "Actual" are used, not tests or exercises.
- **Checking it works:** restart the server. Failed feeds are logged as "CAP feed failed". In the app, Account, Notifications shows how many feeds are connected.

### Push notifications

1. Run `npx web-push generate-vapid-keys`.
2. Put the public key in `VAPID_PUBLIC_KEY` and the private key in `VAPID_PRIVATE_KEY`.
3. Set `VAPID_SUBJECT` to something like `mailto:you@example.com`.
4. Push needs HTTPS (or localhost). Members then turn it on under Account, Notifications.

### Email

- `SMTP_URL`: your mail server as a web-style address, for example `smtps://username:password@smtp.example.com:465`.
- `SMTP_FROM`: the sender, for example `NEIGHBOURHOOD OS <alerts@example.com>`.
- The same mail setup is used for alerts, hand-offs to authorities and the weekly summary.

### Text messages and WhatsApp (Twilio)

1. Create a Twilio account and get `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
2. `TWILIO_FROM`: your Twilio phone number, for example `+15551234567`.
3. `TWILIO_WHATSAPP_FROM` (optional): your WhatsApp-enabled sender, written as `whatsapp:+15551234567`.
4. `PUBLIC_URL`: the public address of this server with no trailing slash, for example `https://neighbourhood.example.com`. It must match exactly what Twilio calls, because incoming messages are signature-checked against it.
5. In the Twilio console, set the incoming-message webhook (HTTP POST) of your number or WhatsApp sender to `PUBLIC_URL/api/sms`.
6. Twilio cannot reach `localhost`. For testing, use a tunnel and set `PUBLIC_URL` to the tunnel address.

## Feature details

### How real-world problems are handled

| Problem | What it does |
|---|---|
| Every neighbourhood is different | Each neighbourhood is its own record with its own data and its own map, built from real OpenStreetMap data around its center. |
| Same neighbourhood, same view | Members read the same server state and the same cached map. Only zoom and pan are personal. |
| Where do people belong? | Automatic area cells of about 1 km, computed in the browser. Named neighbourhoods (200 m to 2 km) can be created and joined by search or invite link. People near a border can join the next area. Up to 5 neighbourhoods per person. |
| Location privacy | Location is opt-in. Only the area cell is sent. Exact positions are never sent or stored, except a pin a person deliberately places on a report or SOS. "You are here" stays on the device. |
| Fake or spam reports | Rate limits per user, a cap of 15 open reports each, the location must fall inside the neighbourhood, a person cannot confirm their own report or confirm twice, and three neighbor flags hide a report until a coordinator reviews it. Authors can withdraw. |
| Fake "verified" claims | Only a human coordinator or moderator can mark a report verified. AI output is always labelled a suggestion. |
| Coordinator abuse | Every coordinator action is written to an audit log shown to other coordinators. Platform admins can step in. |
| Who becomes a coordinator? | The creator of a named neighbourhood. Otherwise people ask to coordinate, and an existing coordinator (or platform admin) approves in the People tab. |
| Empty neighbourhoods | A guided empty state explains how to report, invite neighbors and ask for a coordinator. |
| Data and accounts | Accounts through Supabase Auth. Roles are enforced on the server. Deleting an account removes memberships and photos and replaces the person's name with "Former member". |
| Emergencies | The app states in several places that it is not an emergency service. SOS locations are consent-based, restricted and deleted automatically. |
| Worldwide awareness | Official public hazard feeds are shown globally and can switch a neighbourhood into Crisis Mode. Crowd reports stay local. |

### Fix review and reporter confirmation

The lifecycle is Reported, Under review, Assigned, In progress, Resolution pending review, Resolved. Once proof exists, a coordinator submits the fix for review. It is then resolved in one of three ways, and the issue records which one:

- **By a reviewer.** A different coordinator or a moderator approves it, or sends it back with a reason. The person who submitted the fix can never approve it, and approval is blocked while more neighbors say "not fully fixed" than "looks fixed".
- **By the reporter.** The person who reported the problem, and everyone who confirmed it, are asked "Is the problem fixed?" in the app and through their notification channels. By text they can reply `FIXED` or `NOT FIXED` when exactly one fix is waiting for them. "Yes" resolves it, labelled "Confirmed by the reporter". "No" sends it back to In progress with their note. This works with a single coordinator, but it is a weaker check than a second reviewer, because a person with a second account could fake it.
- **Without confirmation.** If nobody answers within 7 days, the coordinator can close it as "Closed without confirmation". This is labelled, never counts as verified, earns no points, is written to the audit log, and a reporter can still reopen it.

Each issue also has a before-and-after photo slider, resident updates, an assignment history, a suggested action plan (steps, department, volunteers, effort, materials, safety notes, printable) and a priority score out of 100 from fixed rules, which only sorts the list.

### AI agent workflow

A resident reports a problem, typed or spoken, in Hindi or English. The agent then coordinates the fix, and the map shows its progress as a ring around the pin.

1. **Understands the report.** With an `AI_API_KEY`, it detects the language, category and priority and writes an English summary. Without a key it uses simple Hindi and English keyword rules, and says so.
2. **Merges duplicates** using the nearby-report matching.
3. **Chooses the complaint route** from the editable table in `src/routes.ts`: which authority or channel, what to include, how many days to wait, and the escalation steps.
4. **Drafts the complaint** in English or Hindi from a fixed template. The AI never writes the legal wording, so it cannot invent rules or deadlines. The author or a coordinator can edit it.
5. **Waits for a person to approve.** Nothing is sent automatically. The approved text is copied and submitted through the route shown, then marked as sent with the reference number.
6. **Schedules escalation.** If there is no response by the deadline, the server prepares the next-level draft, which refers to the earlier complaint, and notifies coordinators. A person still has to approve it. It is cancelled if the issue is resolved.
7. **Suggests a community mission.** Garbage gets a cleanup. Water, lights, roads and hazards get a safe follow-up crew that does not touch pipes, wires or open manholes.
8. **Tracks it to the end:** understood, duplicates checked, route, draft, approved, sent, reference received, mission, volunteers, proof of fix, verified resolved.

**Check before relying on it:** the authority names and escalation steps in `src/routes.ts` are generic. Different cities use different portals and offices, so check each entry against your city's official website and edit it.

### TinyFish: verify the route and check the status

Two features in the AI agent panel use [TinyFish](https://www.tinyfish.ai) when `TINYFISH_API_KEY` is set on the server.

**Verify this route (Search and Fetch APIs, free to run).** The server works out the city from the neighbourhood's area, asks TinyFish Search for that city's official complaint pages, reads the top results with TinyFish Fetch, and lists the sources, helplines, emails and complaint or tracker links it found. Only pages on government domains are marked "Government website". Everything else says "Not confirmed as official". Results are cached for a week per city and category. The numbers and links come from simple pattern matching on the page text, not from an AI, so they can be wrong or out of date. The table in `src/routes.ts` stays as the fallback.

**Check complaint status (Web Agent API, uses TinyFish credits).** After a coordinator has saved a reference number, they paste the public tracker address and press "Check status". A TinyFish web agent opens the page, looks up the number and reports what the page shows, with a live view link while it runs. The agent's goal is read-only: no login, no registration, no new complaint, nothing typed except the reference number. If the page wants a login, OTP or CAPTCHA, the agent stops. If the result looks like "acknowledged" or "resolved", a button offers to record it, and a coordinator still has to press it.

**Try it without an account.** When the key is set, the landing page shows a "Find your city's real complaint page" box, and demo mode runs the same lookup live if you type a real city. It uses only Search and Fetch, never the agent. It is limited to 6 tries an hour per visitor and 300 a day for the whole site.

**What leaves your server:** the city name, the issue category, the tracker address and the reference number. Never names, photos or the exact location.

**Safeguards:** status checks are for coordinators only (10 an hour each, 100 a day for the whole server), tracker addresses must be public `https://` sites, runs are tied to the user who started them, and text read from a web page is shown as plain text only. In demo mode both features show labelled simulated examples and call nothing.

### World layer and Crisis Mode

- **World tab:** a global map of official hazard events from USGS (earthquakes), NASA EONET (wildfires, floods, storms, volcanoes) and GDACS (cyclones, floods, volcanoes, wildfires). The server fetches and caches them for 10 minutes, so browsers never call those services directly. Each event shows its source, time and a link. The layer only informs; it never starts a rescue by itself.
- **Automatic Crisis Mode:** each neighbourhood's state includes the hazards that overlap it (for example a magnitude 6 earthquake within 150 km, or a fire within 25 km). A "watch" level shows a heads-up banner. A "warning" or "severe" level switches on Crisis Mode: an official alert banner, a red alert chip, an emergency-services-first notice and a prominent SOS tab. A cluster of 3 or more open reports of one type within 250 m also turns on the crisis chip.
- **Demo:** the Command tab has a "Simulate an earthquake alert" button, so the escalation can be shown without waiting for a real event.

### SOS requests

- The form needs an explicit consent tick. The exact location is chosen on the map or from the device, and is only sent when the person presses Send.
- Only the author, the neighbourhood's coordinators and a volunteer a coordinator assigns can see the request and its location. Everyone else sees only a count.
- Closing, cancelling or marking a request helped deletes its location and note immediately. Anything still open is closed and wiped after 24 hours.
- One active request per person, at most 3 a day. Coordinators see the nearest shelter or aid post and can assign available volunteers.
- Texting `SOS medical 3 <where you are>` to the Twilio number works too, from a number linked under Account, Notifications. It shares the phone number with coordinators until the request is closed.
- Every screen says to call the local emergency number first.

### Community, preparedness and reporting

- **Works on a bad connection:** the app can be installed. The map is cached, the last known state is shown with an "Offline" label, and reports, SOS requests, confirmations, proofs, check-in replies and exchange messages made offline are saved on the device and sent when the connection returns. Photos need a connection.
- **Notifications:** in-app bell, web push, email, SMS and WhatsApp, with a limit per person per hour. Alerts go out for official alerts near a neighbourhood, SOS requests (to coordinators), assignments, fix confirmations, safety check-ins and urgent notices.
- **Safety check-ins:** a coordinator starts a check-in, members answer "I am safe" or "I need help", and coordinators see who has not replied, with neighbors on the extra-help register listed first. The register is optional, consent-based and visible only to coordinators.
- **Preparedness:** an emergency plan with evacuation routes and contacts, assembly points and shared equipment, and a summary of volunteer abilities.
- **Neighbor exchange and notice board:** offers and requests with a short message thread, and coordinator announcements that can be pinned or marked urgent.
- **Council reports:** filters, weekly trends, hotspots, a hand-off tracker, CSV export and a print or save-as-PDF view. A public page, `/?impact=<neighbourhood id>`, shows only totals, with no names or locations.
- **Hand-off to authorities:** coordinators keep a directory of authorities, pass an issue on (by email if the authority has an address and email is set up) and track whether it was acknowledged, with overdue ones flagged.
- **What-if simulator** (coordinators): change volunteers, team size, hours, the order of work and the assumed authority delay, and compare with today's setup. Everything is labelled an estimate and nothing changes in real reports.
- **Pulse:** charts with date filters for reported and resolved issues, open issues over time, categories, hours to resolve and volunteer hours. Each chart is tagged Actual or Estimate.
- **Recognition:** badges and points that count only verified reports and completed fixes, so spam earns nothing.

## Testing

| Command | What it does |
|---|---|
| `npm run check` | Type-checks the web app and the server. |
| `npm test` | Runs 11 test files: shared rules, SOS, the CAP parser, the AI agent, fix review, AI providers, "You are here", OpenStreetMap loading, reporter confirmation, and the TinyFish module and routes (against a local mock). |
| `npm run test:render` | Renders the main screens on the server to catch crashes. |

## Honest limits

- A location claim is self-asserted. Trust comes from verification, rate limits and moderation, not from proving where someone lives.
- OpenStreetMap coverage varies. Some areas have few buildings mapped, and the app says so.
- State is one JSON document per neighbourhood, locked on each write. That suits neighbourhood-sized communities, but a very busy neighbourhood would need normalized tables.
- Photos are stored in Postgres. Move them to object storage if volume grows.
- Updates use 5-second polling. Supabase Realtime would make them instant.
- Rate limits are kept in memory, so run one server instance, or add a shared store such as Redis.
- Hidden reports still appear briefly in the event log by title before being hidden.
- The world feeds are third-party services whose formats and availability can change. GDACS in particular is parsed defensively, and the app keeps working if a feed fails. Check each provider's terms and attribution requirements before a public launch.
- Alert radii are simple rules, not a hazard model, and they never replace national warnings.
- SOS needs a connection. An SOS made offline is queued and sent when the connection returns, which can be too late. Texting SOS works only when Twilio is set up and the person has linked their phone number.
- A coordinator may not see a request in time. The app says so and points to emergency services.
- A reporter's "fixed" answer is a weaker check than a second reviewer.
- Offline queuing, push, email, text messaging and the service worker could not be tested in the build environment. Try them on a real device with real credentials.
- Hindi translations were written without native review and cover the main screens only.
- Voice input depends on the browser's speech service, and its audio may leave the device.
- Offline copies are cleared on sign-out, but anyone using a shared device while signed in can see them.
- Automated tests cover the shared rules and modules, and check that the main screens render. They do not cover the server routes. The TinyFish tests use a mock, so run both TinyFish features once with a real key before relying on them; some portals block automated visits or need a CAPTCHA.
- Authority names and TinyFish results (route links, helplines, portal status) are suggestions. A person must confirm them.

## Known issues

These were found while writing the design brief (section 9 has the full list and suggested fixes):

- The demo opens in Crisis Mode. Four open garbage reports near Lakeview Road form a report cluster, so the red crisis chip and pulsing SOS tab are on before any hazard alert.
- Moderators cannot report, confirm, send SOS or answer check-ins, and in the demo "Run next step" and "Reset demo" fail while the Role menu is set to Moderator.
- On phones, the header wraps to three rows and takes about a quarter of the screen.
- Some copy is out of date: a few labels say only a moderator approves fixes, the landing page says "Claude AI suggestions" although Gemini is the default, the Account text-command help leaves out FIXED and NOT FIXED, and the app manifest still uses the old navy colour.
- The landing page is English only, and the World panel cannot filter by severity.

**Society names on the map.** When OpenStreetMap has them, named residential areas and apartment buildings are shown as small, soft labels, and a "Near ..." chip shows the society nearest to the middle of the view, so you can place yourself without sharing your location. Labels appear only when zoomed in, never overlap, and do not change the 3D buildings. Maps saved before this feature are fetched once more to add names (the old map is kept if OpenStreetMap is down). Where OpenStreetMap has no name, nothing is shown. The demo city uses made-up names.