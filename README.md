# Road Safety Network — Driver / Pedestrian / Emergency Vehicle

A browser-based demo of V2X (vehicle-to-everything) safety concepts,
using GPS + the internet as the "radio" instead of dedicated
short-range hardware. Three role-based pages share a live Firebase
channel so drivers, pedestrians, and emergency vehicles can see each
other in real time.

**Important framing:** phone GPS has meter-level accuracy and a few
seconds of latency. Treat every alert here as *advisory/awareness*,
not collision *avoidance* — it's a research/demo tool, not a
certified safety system.

## Pages

| Page | Role |
|---|---|
| `index.html` | Role picker |
| `driver.html` / `driver.js` | ADAS-style radar, zone alerts, collision-risk warnings |
| `pedestrian.html` / `pedestrian.js` | Nearby-vehicle proximity alerts |
| `emergency.html` / `emergency.js` | Ambulance/fire broadcast with an Emergency Mode toggle |
| `common.js` | Shared Firebase + geometry + zone-lookup helpers |

## What each role does

- **Driver**: shares live lat/lng/heading/speed as `role: "driver"`,
  with a selectable **vehicle type** (Car 🚗 / Motorcycle 🏍️ / Bicycle
  🚴) that shows on everyone's radar/map. Sees every other entity
  plotted on a "heading-up" relative radar (you're always centered,
  pointing up; others are placed by real bearing + distance). Also
  queries OpenStreetMap's free Overpass API for nearby schools/
  hospitals AND merges in any zones the admin has manually placed
  (including construction zones), showing a banner — spoken aloud via
  the browser's built-in voice synthesis — as you approach. Name and
  vehicle number fields are CAPS-only; the vehicle number is checked
  against the standard Indian plate format (e.g. `TN12AR5375`) with a
  one-tap manual-verification link to carinfo.app (see the note above
  on why this can't be fully automated from a static site).
- **Pedestrian**: shares position as `role: "pedestrian"`, sees a
  distance-sorted list of nearby vehicles, with a spoken + visual
  banner when one is very close or an active emergency vehicle is
  nearby.
- **Emergency Vehicle**: shares position as `role: "emergency"` with
  a `subrole` of `ambulance` or `fire`. Toggling **Emergency Mode ON**
  sets `emergencyActive: true` (with a spoken confirmation), which is
  what triggers the "pull over" banner — also spoken — on nearby
  drivers/pedestrians.
- **Live Network Monitor (admin.html)**: a combined view of everyone
  on the network at once, on one map with a filterable/searchable
  list, "last seen" timestamps, and manual stale-entry cleanup.
  Requires signing in with a real Firebase email/password account
  (reuse the same admin account as the family tracker, if
  applicable) — see "Admin login" below. Also where zones get added:
  pick School/Hospital/Construction, tap "Place on Map," then click
  the map to drop it — that zone immediately starts showing up in
  every driver's zone alerts.

## Data flow

```
Any role's page
   → signs in anonymously to Firebase
   → watchPosition() streams GPS updates
   → writes to /entities/<random-id>  { role, name, lat, lng, ... }
   → subscribes to /entities (everyone else)
   → computes distance/bearing to each, renders radar/list/alerts
```

Entities are removed from the database when a user taps Stop or
closes the tab (`beforeunload`), so stale markers don't linger.

## Setup

### 1. Reuse or create a Firebase project

You can reuse the same Firebase project from the earlier family
location tracker (Authentication + Realtime Database already on), or
create a new one the same way (see that project's README for the
full click-by-click steps). Either way:

- **Authentication → Sign-in method**: make sure **Anonymous** is
  enabled (every role signs in anonymously to write its position).
- **Realtime Database → Rules**: this project uses a different data
  path (`/entities`) and is meant to be visible to *everyone* using
  the network, not just one admin — so the rules are simpler than the
  family tracker's:

  ```json
  {
    "rules": {
      "entities": {
        ".read": "auth != null",
        ".write": "auth != null"
      },
      "customZones": {
        ".read": "auth != null",
        ".write": "auth != null && auth.token.email == 'YOUR_ADMIN_EMAIL_HERE'"
      }
    }
  }
  ```

  This means: anyone who has signed in anonymously (i.e. anyone who
  opened one of the role pages) can read and write the shared
  entities list, and can read admin-placed zones (so drivers get
  warned about them) — but only your admin login can add/remove
  zones. That's intentional for this "public safety broadcast"
  concept — don't reuse it for private data.

  Replace `YOUR_ADMIN_EMAIL_HERE` with your actual admin email. If
  you're reusing the same Firebase project as the family tracker,
  merge this in alongside your existing `/locations` rules rather
  than replacing the whole rules block — e.g.:

  ```json
  {
    "rules": {
      "locations": {
        ".read": "auth != null && auth.token.email == 'YOUR_ADMIN_EMAIL_HERE'",
        ".write": "auth != null"
      },
      "entities": {
        ".read": "auth != null",
        ".write": "auth != null"
      },
      "customZones": {
        ".read": "auth != null",
        ".write": "auth != null && auth.token.email == 'YOUR_ADMIN_EMAIL_HERE'"
      }
    }
  }
  ```

### Admin login

`admin.html` requires a real Firebase email/password sign-in (not
anonymous) before it shows anything — see Firebase Console →
Authentication → Users to create/reuse an account. This gates the
*page*, not the underlying data (see Production-readiness notes below
for why that's an important distinction).

### 2. Fill in `firebase-config.js`

Same as before — paste your real `apiKey`, `authDomain`,
`databaseURL`, `projectId`, `storageBucket`, `messagingSenderId`, and
`appId` into `firebase-config.js`, replacing the `YOUR_...`
placeholders. Use the `<script>`-tag / "Config" snippet from Firebase,
not the npm/`import` one.

### 3. Deploy to GitHub Pages

Push all files to your repo, enable Pages under Settings → Pages the
same way as before. Your pages will be live at:

- `https://<username>.github.io/<repo>/` — role picker
- `.../driver.html`, `.../pedestrian.html`, `.../emergency.html`

## Testing it yourself

Open `driver.html` on one device/tab and `pedestrian.html` or
`emergency.html` on another (two phones, or a phone + a laptop tab)
while both are near each other with location permission granted —
each should appear on the other's screen within a few seconds.

## Tuning

All the distance/radius thresholds are constants near the top of
`driver.js`, `pedestrian.js`, and `emergency.js` — e.g.
`RADAR_RANGE_M`, `RISK_DISTANCE_M`, `ZONE_ALERT_DISTANCE_M`,
`EMERGENCY_ALERT_DISTANCE_M` — adjust these to taste.

## Voice alerts

Uses the browser's built-in Speech Synthesis API — free, no key, no
network call, works offline once the page is loaded. Two things worth
knowing:

- **Needs a user tap first.** Most mobile browsers (especially iOS
  Safari) block audio, including speech synthesis, until the user has
  interacted with the page at least once. Tapping "Start Driving
  Mode" / "Start Sharing" / "Start Broadcasting" counts as that
  interaction, so voice alerts should work fine after that — but
  won't fire before the user has tapped anything.
- **Throttled per alert type**, not per occurrence — see
  `speakAlert()` in `common.js`. Each alert category (school zone,
  emergency approach, collision risk, etc.) has its own cooldown so a
  sustained situation re-announces occasionally rather than repeating
  every single render.

## Vehicle plate handling

`isValidPlateFormat()` in `common.js` checks against the standard
Indian RTO plate pattern (2 letters, 1–2 digits, 1–3 letters, 4
digits — e.g. `TN12AR5375`). This is a **format** check only, not a
registration check — see the caveat under Production-readiness notes
below for why real verification isn't achievable from a static site,
and what `buildCarinfoUrl()` offers instead (a one-tap manual lookup
link). If you're deploying this outside India, swap
`VEHICLE_PLATE_REGEX` for your region's format, or remove the check
entirely.

## Ideas for extending further

- Trajectory extrapolation (predict a few seconds ahead using heading
  + speed) instead of pure current-distance risk detection.
- Device-motion-based harsh-braking detection, broadcast as an event
  to vehicles behind.
- Route-deviation or "didn't arrive" alerts layered on top of the
  driver broadcast.
- Swap the Overpass zone types (`amenity=school`/`hospital`) for other
  OSM tags — construction zones, level crossings, etc.

## Production-readiness notes

This is a polished demo, not a hardened production system — worth
understanding the difference before relying on it for anything real.

**What's solid:**
- **Reliable disappearance on close.** Every role now calls
  `db.ref(...).onDisconnect().remove()` right after signing in. This
  runs *server-side* the moment Firebase notices the connection is
  gone — it works even if the tab is force-killed or the app crashes,
  unlike relying on the page's own JavaScript to run on the way out.
- **Remembered profile.** Name / vehicle number / vehicle type are
  saved to `localStorage` on each device and auto-filled next visit —
  purely local, never transmitted, separate from the live broadcast.
- **Admin tooling.** Role filters, search by name/vehicle number, live
  "last seen" timestamps, and a manual "Clear Stale Entries" cleanup
  button for anything that somehow slips past `onDisconnect` (e.g. if
  Firebase's own grace period hasn't elapsed yet).
- Every JS file is checked with `node --check` before being handed
  over, and every `getElementById` call is cross-checked against the
  HTML it targets, to catch the class of bug (typos, mismatched IDs,
  broken comment blocks) that caused earlier "stuck page" issues.

**What would still need work for real production use:**
- **Scale.** Firebase's free tier and the free Overpass API are fine
  for a demo or a small group — not for city-scale concurrent users.
  A real deployment would need paid tiers, rate limiting, and likely
  a self-hosted Overpass mirror.
- **True data-level security.** The admin login (see below) gates the
  *page*, not the underlying `/entities` data — anyone who's part of
  the network can still read it directly via Firebase, since drivers
  and pedestrians need that same access to see each other. Real
  production security would need a proper backend that filters what
  each client can see, not just client-side rules.
- **Identity.** Anyone can type any name or vehicle number — there's
  no verification. Fine for a demo/community tool, not for anything
  where impersonation matters.
- **Vehicle registration is unverified.** The plate field only checks
  *format*, not whether that vehicle is actually registered. Real
  verification needs a licensed government/RTO data API and a backend
  server to query it — not achievable from a static site due to
  browser cross-origin restrictions (CORS) and the legal/reliability
  risk of scraping a third-party site without permission. The
  "Verify on carinfo.app" link is a manual convenience, not automated
  enforcement — someone could still type a fake plate and proceed.
- **Offline/no-internet operation.** Everything here depends on real
  internet connectivity to Firebase. True offline mesh (Bluetooth/
  WiFi Direct) isn't achievable from a browser — see the note in this
  project's chat history if you want to explore a local-hotspot +
  relay-server fallback later.
- **Testing at scale.** This has been tested with a handful of
  simultaneous entities. Realtime Database performance with hundreds
  of concurrent broadcasters hasn't been validated.
