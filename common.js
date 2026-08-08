/* =============================================================
   common.js — shared logic used by driver.html, pedestrian.html,
   and emergency.html.

   Responsibilities:
   1. Sign this device in anonymously to Firebase.
   2. Read/write this device's "entity" (position, role, etc.) to
      the shared /entities node in Realtime Database.
   3. Subscribe to every other entity currently broadcasting.
   4. Geometry helpers (distance, bearing) used for the radar view
      and for zone/proximity alerts.
   5. Look up nearby real-world school/hospital zones from the
      free OpenStreetMap Overpass API (no key required).
   ============================================================= */

/* -----------------------------------------------------------
   DEBUG BANNER — catches uncaught errors and shows them on
   screen, since mobile users can't easily open dev tools.
   ----------------------------------------------------------- */
window.addEventListener("error", (event) => {
  const banner = document.getElementById("debugBanner");
  if (!banner) return;
  banner.textContent = "⚠️ Script error: " + event.message;
  banner.classList.remove("hidden");
});

/* -----------------------------------------------------------
   A random-ish but stable ID for this browser tab's session,
   used as this entity's key in Firebase. Regenerated each visit
   — this is a lightweight demo system, not an account system.
   ----------------------------------------------------------- */
function generateEntityId() {
  return "e-" + Math.random().toString(36).slice(2, 10);
}

/* -----------------------------------------------------------
   FIREBASE: sign in anonymously. Every role does this the same
   way — only after this resolves can we read/write /entities.
   ----------------------------------------------------------- */
function signInAnon() {
  return new Promise((resolve, reject) => {
    try {
      auth
        .signInAnonymously()
        .then(resolve)
        .catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

/* -----------------------------------------------------------
   Write (overwrite) this entity's current state.
   ----------------------------------------------------------- */
function writeEntity(entityId, data) {
  try {
    db.ref(`entities/${entityId}`).set(data);
  } catch (err) {
    console.error("Failed to write entity:", err);
  }
}

/* -----------------------------------------------------------
   Remove this entity (called when the user stops sharing /
   closes the tab) so it doesn't linger as a stale marker for
   everyone else.
   ----------------------------------------------------------- */
function removeEntity(entityId) {
  try {
    db.ref(`entities/${entityId}`).remove();
  } catch (err) {
    console.error("Failed to remove entity:", err);
  }
}

/* -----------------------------------------------------------
   Subscribe to every entity in the system. Calls `callback`
   with a plain object keyed by entity ID every time anything
   changes. Returns an unsubscribe function.
   ----------------------------------------------------------- */
function subscribeEntities(callback) {
  const ref = db.ref("entities");
  const listener = ref.on("value", (snapshot) => {
    callback(snapshot.val() || {});
  });
  return () => ref.off("value", listener);
}

/* =============================================================
   GEOMETRY HELPERS
   ============================================================= */

/* Distance in meters between two lat/lng points (Haversine) */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* Compass bearing in degrees (0 = north, 90 = east) from point 1 to point 2 */
function bearingDegrees(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/* Smallest signed difference between two angles, in degrees (-180..180) */
function angleDiff(a, b) {
  let diff = (b - a + 540) % 360 - 180;
  return diff;
}

/* =============================================================
   ZONE LOOKUP — free OpenStreetMap Overpass API
   ---------------------------------------------------------------
   Finds real schools and hospitals near a point. Cached and only
   re-queried when the device has moved far enough, to avoid
   hammering the free API.
   ============================================================= */
let zoneCache = { lat: null, lng: null, zones: [] };
const ZONE_QUERY_RADIUS_M = 800; // how far out to search
const ZONE_REQUERY_DISTANCE_M = 400; // re-query once we've moved this far

async function getNearbyZones(lat, lng) {
  if (
    zoneCache.lat !== null &&
    distanceMeters(zoneCache.lat, zoneCache.lng, lat, lng) < ZONE_REQUERY_DISTANCE_M
  ) {
    return zoneCache.zones; // cache is still close enough, reuse it
  }

  const query = `
    [out:json][timeout:15];
    (
      node["amenity"="school"](around:${ZONE_QUERY_RADIUS_M},${lat},${lng});
      way["amenity"="school"](around:${ZONE_QUERY_RADIUS_M},${lat},${lng});
      node["amenity"="hospital"](around:${ZONE_QUERY_RADIUS_M},${lat},${lng});
      way["amenity"="hospital"](around:${ZONE_QUERY_RADIUS_M},${lat},${lng});
    );
    out center;
  `;

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
    });
    const data = await res.json();
    const zones = (data.elements || []).map((el) => ({
      type: el.tags && el.tags.amenity, // "school" or "hospital"
      name: (el.tags && el.tags.name) || (el.tags && el.tags.amenity === "school" ? "School" : "Hospital"),
      lat: el.type === "node" ? el.lat : el.center && el.center.lat,
      lng: el.type === "node" ? el.lon : el.center && el.center.lon,
    })).filter((z) => z.lat && z.lng);

    zoneCache = { lat, lng, zones };
    return zones;
  } catch (err) {
    console.error("Zone lookup failed:", err);
    return zoneCache.zones; // fall back to whatever we had, if anything
  }
}
