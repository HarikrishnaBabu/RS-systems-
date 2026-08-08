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

- **Driver**: shares live lat/lng/heading/speed as `role: "driver"`.
  Sees every other entity plotted on a "heading-up" relative radar
  (you're always centered, pointing up; others are placed by real
  bearing + distance). Also queries OpenStreetMap's free Overpass API
  for nearby schools/hospitals and shows a zone banner when close, and
  flags anything in a forward collision-risk cone.
- **Pedestrian**: shares position as `role: "pedestrian"`, sees a
  distance-sorted list of nearby vehicles, with a banner when one is
  very close.
- **Emergency Vehicle**: shares position as `role: "emergency"` with
  a `subrole` of `ambulance` or `fire`. Toggling **Emergency Mode ON**
  sets `emergencyActive: true`, which is what triggers the "pull over"
  banner on nearby drivers/pedestrians.

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
      }
    }
  }
  ```

  This means: anyone who has signed in anonymously (i.e. anyone who
  opened one of the role pages) can read and write the shared
  entities list. That's intentional for this "public safety broadcast"
  concept — don't reuse it for private data.

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

## Ideas for extending further

- Trajectory extrapolation (predict a few seconds ahead using heading
  + speed) instead of pure current-distance risk detection.
- Device-motion-based harsh-braking detection, broadcast as an event
  to vehicles behind.
- Route-deviation or "didn't arrive" alerts layered on top of the
  driver broadcast.
- Swap the Overpass zone types (`amenity=school`/`hospital`) for other
  OSM tags — construction zones, level crossings, etc.
