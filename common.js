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

/* =============================================================
   LEAFLET MAP HELPERS — shared by driver.js, pedestrian.js,
   emergency.js. Renders a real OpenStreetMap view alongside (or
   instead of) the radar, with emoji markers per entity role.
   ============================================================= */

/* Build a colored circular emoji marker icon */
function emojiDivIcon(emoji, bgColor) {
  return L.divIcon({
    html: `<div style="
      background:${bgColor};
      width:30px; height:30px;
      border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      font-size:15px;
      border:2px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.45);
    ">${emoji}</div>`,
    className: "", // prevent Leaflet's default icon styling from leaking in
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

const ROLE_COLORS = { driver: "#3b82f6", pedestrian: "#f59e0b", emergency: "#ef4444" };
const ROLE_ICONS_BY_SUBROLE = {
  driver: "🚗",
  pedestrian: "🚶",
  ambulance: "🚑",
  fire: "🚒",
};

/* Create a Leaflet map inside the given container id, centered on
   the given starting position. Returns a small state object used
   by updateEntityMap() to keep markers in sync on later calls. */
function createEntityMap(containerId, lat, lng, egoEmoji, egoColor) {
  const map = L.map(containerId).setView([lat, lng], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  const egoMarker = L.marker([lat, lng], {
    icon: emojiDivIcon(egoEmoji, egoColor),
    zIndexOffset: 1000,
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 200);

  return { map, egoMarker, entityMarkers: {}, zoneMarkers: {}, hasAutoFitted: false };
}

/* Move the ego marker to the latest position (and gently re-center
   the map, but only until the user has manually panned/zoomed — we
   track that with a one-time "hasAutoFitted" flag to avoid yanking
   the map around under someone who's trying to look at it). */
function updateEgoPosition(mapState, lat, lng) {
  mapState.egoMarker.setLatLng([lat, lng]);
  if (!mapState.hasAutoFitted) {
    mapState.map.setView([lat, lng], 16);
  }
}

/* Sync the set of "other entity" markers (vehicles/pedestrians/
   emergency vehicles) to match the given list. Each item needs at
   least { id, role, subrole, lat, lng }. */
function updateEntityMarkers(mapState, entities) {
  const activeIds = new Set();

  entities.forEach((e) => {
    activeIds.add(e.id);
    const emoji =
      e.role === "emergency" ? ROLE_ICONS_BY_SUBROLE[e.subrole] || "🚨" : ROLE_ICONS_BY_SUBROLE[e.role] || "❓";
    const color = ROLE_COLORS[e.role] || "#94a3b8";

    if (!mapState.entityMarkers[e.id]) {
      mapState.entityMarkers[e.id] = L.marker([e.lat, e.lng], {
        icon: emojiDivIcon(emoji, color),
      }).addTo(mapState.map);
    } else {
      mapState.entityMarkers[e.id].setLatLng([e.lat, e.lng]);
    }
  });

  // Remove markers for entities that dropped off
  Object.keys(mapState.entityMarkers).forEach((id) => {
    if (!activeIds.has(id)) {
      mapState.map.removeLayer(mapState.entityMarkers[id]);
      delete mapState.entityMarkers[id];
    }
  });
}

/* Plot school/hospital zones (from getNearbyZones) as static markers.
   Keyed by a stable-ish string since Overpass elements don't have a
   simple short ID we've kept around. */
function updateZoneMarkers(mapState, zones) {
  const activeKeys = new Set();
  (zones || []).forEach((z) => {
    const key = `${z.type}-${z.lat.toFixed(5)}-${z.lng.toFixed(5)}`;
    activeKeys.add(key);
    if (!mapState.zoneMarkers[key]) {
      const emoji = z.type === "school" ? "🏫" : "🏥";
      const color = z.type === "school" ? "#f59e0b" : "#3b82f6";
      mapState.zoneMarkers[key] = L.marker([z.lat, z.lng], {
        icon: emojiDivIcon(emoji, color),
        opacity: 0.85,
      })
        .bindPopup(z.name)
        .addTo(mapState.map);
    }
  });
  Object.keys(mapState.zoneMarkers).forEach((key) => {
    if (!activeKeys.has(key)) {
      mapState.map.removeLayer(mapState.zoneMarkers[key]);
      delete mapState.zoneMarkers[key];
    }
  });
}
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
