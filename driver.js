/* =============================================================
   DRIVER MODE — driver.js
   ---------------------------------------------------------------
   Broadcasts this vehicle's position/speed/heading, subscribes to
   every other entity (drivers, pedestrians, emergency vehicles),
   and renders an ADAS-style "heading-up" relative radar: this
   vehicle is always drawn centered and pointing up, and everyone
   else is plotted around it by real bearing + distance.
   ============================================================= */

// ---------- DOM references ----------
const infoCard = document.getElementById("infoCard");
const loadingCard = document.getElementById("loadingCard");
const errorCard = document.getElementById("errorCard");
const errorMessage = document.getElementById("errorMessage");
const dashboardCard = document.getElementById("dashboardCard");

const driverNameInput = document.getElementById("driverName");
const vehicleNumberInput = document.getElementById("vehicleNumber");
const plateError = document.getElementById("plateError");
const verifyPlateLink = document.getElementById("verifyPlateLink");
const carBtn = document.getElementById("carBtn");
const motorcycleBtn = document.getElementById("motorcycleBtn");
const bicycleBtn = document.getElementById("bicycleBtn");
const shareBtn = document.getElementById("shareBtn");
const retryBtn = document.getElementById("retryBtn");
const stopBtn = document.getElementById("stopBtn");

const nearbyCount = document.getElementById("nearbyCount");
const alertsArea = document.getElementById("alertsArea");
const radarSvg = document.getElementById("radarSvg");

const speedValue = document.getElementById("speedValue");
const headingValue = document.getElementById("headingValue");
const accValue = document.getElementById("accValue");
const timeValue = document.getElementById("timeValue");

// ---------- Tunable constants ----------
const RADAR_RANGE_M = 150;      // meters shown edge-to-edge on the radar
const RISK_DISTANCE_M = 60;     // closer than this, in the forward cone, counts as "risk"
const RISK_CONE_DEG = 30;       // +/- degrees around straight-ahead considered "in front"
const ZONE_ALERT_DISTANCE_M = 200;
const EMERGENCY_ALERT_DISTANCE_M = 400;

// ---------- State ----------
let entityId = generateEntityId();
let watchId = null;
let unsubscribe = null;
let unsubscribeZones = null;
let latestEntities = {};
let customZonesList = [];
let myLat = null, myLng = null, myHeading = 0, mySpeedKmh = 0, myAccuracy = null;
let headingKnown = false;
let mapState = null; // Leaflet map state, created on first position fix
let vehicleType = "car";

/* ---- Force uppercase on name + plate fields ---- */
forceUppercase(driverNameInput);
forceUppercase(vehicleNumberInput);

/* ---- Vehicle type selector ---- */
const vtypeButtons = [carBtn, motorcycleBtn, bicycleBtn];
vtypeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    vehicleType = btn.dataset.vtype;
    vtypeButtons.forEach((b) => b.classList.toggle("selected", b === btn));
  });
});

/* ---- Live plate format check + manual verify link ---- */
vehicleNumberInput.addEventListener("input", () => {
  const plate = vehicleNumberInput.value.trim();
  if (!plate) {
    plateError.classList.add("hidden");
    verifyPlateLink.classList.add("hidden");
    return;
  }
  if (isValidPlateFormat(plate)) {
    plateError.classList.add("hidden");
    verifyPlateLink.href = buildCarinfoUrl(plate);
    verifyPlateLink.classList.remove("hidden");
  } else {
    plateError.textContent = "Format looks off — expected something like TN12AR5375.";
    plateError.classList.remove("hidden");
    verifyPlateLink.classList.add("hidden");
  }
});

/* -----------------------------------------------------------
   Prefill from a saved profile, if this browser has one from a
   previous visit, so the driver doesn't have to retype it.
   ----------------------------------------------------------- */
const savedProfile = loadProfile("rs_driver_profile");
if (savedProfile) {
  driverNameInput.value = savedProfile.name || "";
  vehicleNumberInput.value = savedProfile.vehicleNumber || "";
  if (savedProfile.vehicleType) {
    vehicleType = savedProfile.vehicleType;
    vtypeButtons.forEach((b) => b.classList.toggle("selected", b.dataset.vtype === vehicleType));
  }
  vehicleNumberInput.dispatchEvent(new Event("input")); // re-run the plate check on the prefilled value
}

/* -----------------------------------------------------------
   START
   ----------------------------------------------------------- */
function startDriving() {
  if (!("geolocation" in navigator)) {
    showError("❌ This browser doesn't support the Geolocation API.");
    return;
  }

  const name = driverNameInput.value.trim();
  if (!name) {
    driverNameInput.focus();
    driverNameInput.style.borderColor = "var(--accent-red)";
    driverNameInput.placeholder = "Please enter a label first";
    return;
  }
  driverNameInput.style.borderColor = "";

  const vehicleNumber = vehicleNumberInput.value.trim();
  if (vehicleNumber && !isValidPlateFormat(vehicleNumber)) {
    vehicleNumberInput.focus();
    vehicleNumberInput.style.borderColor = "var(--accent-red)";
    return;
  }
  vehicleNumberInput.style.borderColor = "";

  // Remember this for next time
  saveProfile("rs_driver_profile", { name, vehicleNumber, vehicleType });

  showCard(loadingCard);

  signInAnon()
    .then(() => {
      registerAutoRemove(entityId); // disappear from the map if this tab/app closes or crashes
      watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000,
      });
      unsubscribe = subscribeEntities((entities) => {
        latestEntities = entities;
        renderAll();
      });
      unsubscribeZones = subscribeCustomZones((zones) => {
        // Admin-placed zones — merged with the automatic OpenStreetMap
        // lookup in the zone-check block inside onPosition().
        customZonesList = Object.keys(zones).map((id) => ({ id, ...zones[id] }));
        renderAll();
      });
    })
    .catch((err) => {
      showError(
        "⚠️ Couldn't connect to the safety network. Check firebase-config.js has your real project values. (" +
          err.message +
          ")"
      );
    });
}

function onGeoError(error) {
  const messages = {
    1: "🚫 Location permission was denied. Enable it in your browser settings and try again.",
    2: "📡 GPS is currently unavailable. Check that location services are on.",
    3: "⏱️ Timed out waiting for a GPS fix. Try again.",
  };
  showError(messages[error.code] || "⚠️ Unknown location error.");
  stopDriving();
}

function onPosition(position) {
  const { latitude, longitude, heading, speed, accuracy } = position.coords;

  myLat = latitude;
  myLng = longitude;
  myAccuracy = accuracy;
  mySpeedKmh = speed === null || speed === undefined ? 0 : speed * 3.6;

  if (heading !== null && heading !== undefined && !Number.isNaN(heading)) {
    myHeading = heading;
    headingKnown = true;
  }

  showCard(dashboardCard);

  // ---- Create the map on the very first fix, otherwise just move it ----
  if (!mapState) {
    const egoIcon = { car: "🚗", motorcycle: "🏍️", bicycle: "🚴" }[vehicleType] || "🚗";
    mapState = createEntityMap("map", latitude, longitude, egoIcon, "#22d3ee");
  } else {
    updateEgoPosition(mapState, latitude, longitude);
  }

  // ---- Update stats ----
  speedValue.textContent = `${mySpeedKmh.toFixed(0)} km/h`;
  headingValue.textContent = headingKnown ? `${Math.round(myHeading)}°` : "-- (move to detect)";
  accValue.textContent = `${Math.round(myAccuracy)} m`;
  timeValue.textContent = new Date(position.timestamp).toLocaleTimeString();

  // ---- Broadcast to the network ----
  writeEntity(entityId, {
    role: "driver",
    name: driverNameInput.value.trim(),
    vehicleNumber: vehicleNumberInput.value.trim(),
    vehicleType,
    lat: latitude,
    lng: longitude,
    heading: myHeading,
    speedKmh: mySpeedKmh,
    updatedAt: Date.now(),
  });

  // ---- Zone check (throttled/cached inside common.js) ----
  getNearbyZones(latitude, longitude).then((zones) => {
    osmZones = zones;
    renderAll();
  });

  renderAll();
}

/* -----------------------------------------------------------
   STOP
   ----------------------------------------------------------- */
function stopDriving() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (unsubscribeZones) {
    unsubscribeZones();
    unsubscribeZones = null;
  }
  removeEntity(entityId);
  cancelAutoRemove(entityId);
  if (mapState) {
    mapState.map.remove();
    mapState = null;
  }
  showCard(infoCard);
}

window.addEventListener("beforeunload", () => removeEntity(entityId));

/* -----------------------------------------------------------
   CARD SWITCHING / ERRORS
   ----------------------------------------------------------- */
function showCard(card) {
  [infoCard, loadingCard, errorCard, dashboardCard].forEach((c) => c.classList.add("hidden"));
  card.classList.remove("hidden");
}

function showError(msg) {
  errorMessage.textContent = msg;
  showCard(errorCard);
}

/* =============================================================
   RENDERING: alerts + radar, called whenever position or the
   entity list changes.
   ============================================================= */
let osmZones = [];

/* Combine the automatic OpenStreetMap zone lookup with any zones the
   admin has manually placed on the map, recomputed fresh each render
   so admin additions show up immediately without waiting for a new
   GPS fix. */
function getAllZones() {
  return [...osmZones, ...customZonesList];
}

function renderAll() {
  if (myLat === null) return;
  const nearby = computeNearby();
  renderAlerts(nearby);
  renderRadar(nearby);
  if (mapState) {
    updateEntityMarkers(mapState, nearby);
    updateZoneMarkers(mapState, getAllZones());
  }
  nearbyCount.textContent = `${nearby.length} nearby`;
}

/* Build a list of every OTHER entity with distance/bearing relative to me */
function computeNearby() {
  const list = [];
  for (const id in latestEntities) {
    if (id === entityId) continue;
    const e = latestEntities[id];
    if (!e || typeof e.lat !== "number" || typeof e.lng !== "number") continue;

    const distance = distanceMeters(myLat, myLng, e.lat, e.lng);
    if (distance > RADAR_RANGE_M) continue; // out of radar range, ignore

    const bearingAbs = bearingDegrees(myLat, myLng, e.lat, e.lng);
    const relBearing = angleDiff(myHeading, bearingAbs);
    const inForwardCone = Math.abs(relBearing) <= RISK_CONE_DEG;
    const risk =
      (e.role === "driver" || e.role === "pedestrian") &&
      distance <= RISK_DISTANCE_M &&
      inForwardCone;

    list.push({ id, ...e, distance, relBearing, risk });
  }
  return list;
}

/* -----------------------------------------------------------
   ALERT BANNERS: zone proximity, emergency vehicles, collision risk
   ----------------------------------------------------------- */
function renderAlerts(nearby) {
  const banners = [];

  // ---- Nearest school/hospital zone ----
  const allZones = getAllZones();
  if (allZones && allZones.length > 0) {
    let nearestZone = null;
    let nearestDist = Infinity;
    allZones.forEach((z) => {
      const d = distanceMeters(myLat, myLng, z.lat, z.lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestZone = z;
      }
    });
    if (nearestZone && nearestDist <= ZONE_ALERT_DISTANCE_M) {
      if (nearestZone.type === "school") {
        banners.push(
          `<div class="alert-banner school">🏫 School zone nearby (${Math.round(nearestDist)}m) — reduce speed</div>`
        );
        speakAlert("zone-school", "School zone ahead. Please reduce speed.");
      } else if (nearestZone.type === "construction") {
        banners.push(
          `<div class="alert-banner school">🚧 Construction zone nearby (${Math.round(nearestDist)}m) — expect diversions</div>`
        );
        speakAlert("zone-construction", "Construction zone ahead. Slow down and expect diversions.");
      } else {
        banners.push(
          `<div class="alert-banner hospital">🏥 Hospital zone nearby (${Math.round(nearestDist)}m) — drive carefully, avoid horn</div>`
        );
        speakAlert("zone-hospital", "Hospital zone ahead. Drive carefully and avoid honking.");
      }
    }
  }

  // ---- Active emergency vehicles nearby ----
  const emergencyNearby = nearby.filter(
    (e) => e.role === "emergency" && e.emergencyActive && e.distance <= EMERGENCY_ALERT_DISTANCE_M
  );
  if (emergencyNearby.length > 0) {
    const closest = emergencyNearby.sort((a, b) => a.distance - b.distance)[0];
    const icon = closest.subrole === "fire" ? "🚒" : "🚑";
    banners.push(
      `<div class="alert-banner danger">${icon} Emergency vehicle approaching (${Math.round(closest.distance)}m) — pull over and stop</div>`
    );
    speakAlert("emergency-approach", "Emergency vehicle approaching. Please pull over and stop.", 10000);
  }

  // ---- Collision-risk (forward cone, close range) ----
  const risky = nearby.filter((e) => e.risk);
  if (risky.length > 0) {
    const closest = risky.sort((a, b) => a.distance - b.distance)[0];
    const what = closest.role === "pedestrian" ? "Pedestrian" : "Vehicle";
    banners.push(
      `<div class="alert-banner danger">⚠️ ${what} ahead, ${Math.round(closest.distance)}m — proceed with caution</div>`
    );
    speakAlert("collision-risk", `${what} ahead. Proceed with caution.`, 8000);
  }

  alertsArea.innerHTML = banners.join("");
}

/* -----------------------------------------------------------
   RADAR: SVG "heading-up" relative view. Ego is fixed at center
   pointing up; everyone else is plotted by real bearing/distance
   relative to my current heading.
   ----------------------------------------------------------- */
function renderRadar(nearby) {
  const CENTER = 160;
  const MAX_R = 140;
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let svg = `<g>`;

  // ---- Rotating sweep beam (the signature "tracking console" motion) ----
  // A soft wedge that continuously rotates, like a real radar sweep.
  // Skipped/frozen for users who've asked for reduced motion.
  const sweepHalfDeg = 13;
  const a1 = (-sweepHalfDeg * Math.PI) / 180;
  const a2 = (sweepHalfDeg * Math.PI) / 180;
  const sx1 = (CENTER + MAX_R * Math.sin(a1)).toFixed(1);
  const sy1 = (CENTER - MAX_R * Math.cos(a1)).toFixed(1);
  const sx2 = (CENTER + MAX_R * Math.sin(a2)).toFixed(1);
  const sy2 = (CENTER - MAX_R * Math.cos(a2)).toFixed(1);
  svg += `
    <defs>
      <radialGradient id="sweepGrad" cx="50%" cy="100%" r="100%">
        <stop offset="0%" stop-color="#2ee6ff" stop-opacity="0.30" />
        <stop offset="100%" stop-color="#2ee6ff" stop-opacity="0" />
      </radialGradient>
    </defs>
    <path d="M ${CENTER},${CENTER} L ${sx1},${sy1} A ${MAX_R},${MAX_R} 0 0,1 ${sx2},${sy2} Z" fill="url(#sweepGrad)">
      ${
        reducedMotion
          ? ""
          : `<animateTransform attributeName="transform" type="rotate" from="0 ${CENTER} ${CENTER}" to="360 ${CENTER} ${CENTER}" dur="4s" repeatCount="indefinite" />`
      }
    </path>`;

  // Range rings
  [0.25, 0.5, 0.75, 1].forEach((frac) => {
    const r = MAX_R * frac;
    svg += `<circle cx="${CENTER}" cy="${CENTER}" r="${r}" fill="none" stroke="#1e2b4d" stroke-width="1" />`;
  });
  svg += `<text x="${CENTER + 4}" y="${CENTER - MAX_R + 12}" fill="#4b5b82" font-size="9" font-family="JetBrains Mono, monospace">${RADAR_RANGE_M}m</text>`;

  // Crosshair
  svg += `<line x1="${CENTER}" y1="${CENTER - MAX_R}" x2="${CENTER}" y2="${CENTER + MAX_R}" stroke="#152040" stroke-width="1" />`;
  svg += `<line x1="${CENTER - MAX_R}" y1="${CENTER}" x2="${CENTER + MAX_R}" y2="${CENTER}" stroke="#152040" stroke-width="1" />`;

  // Each nearby entity
  nearby.forEach((e) => {
    const r = (e.distance / RADAR_RANGE_M) * MAX_R;
    const rad = (e.relBearing * Math.PI) / 180;
    const x = CENTER + r * Math.sin(rad);
    const y = CENTER - r * Math.cos(rad);

    const colors = { driver: "#2ee6ff", pedestrian: "#ffb703", emergency: "#ff3b64" };
    const color = colors[e.role] || "#6b83a3";
    const icon = iconForEntity(e);

    if (e.risk || (e.role === "emergency" && e.emergencyActive)) {
      svg += `<circle cx="${x}" cy="${y}" r="16" fill="none" stroke="#ff3b64" stroke-width="2" opacity="0.8">
        <animate attributeName="r" values="12;20;12" dur="1s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.9;0.1;0.9" dur="1s" repeatCount="indefinite" />
      </circle>`;
    }

    svg += `<circle cx="${x}" cy="${y}" r="11" fill="${color}" />`;
    svg += `<text x="${x}" y="${y + 4}" font-size="12" text-anchor="middle">${icon}</text>`;
  });

  // Ego vehicle, fixed at center pointing up
  svg += `<polygon points="${CENTER},${CENTER - 14} ${CENTER - 10},${CENTER + 10} ${CENTER + 10},${CENTER + 10}" fill="#2ee6ff" style="filter: drop-shadow(0 0 6px #2ee6ff88)" />`;

  svg += `</g>`;
  radarSvg.innerHTML = svg;
}

/* =============================================================
   EVENT LISTENERS
   ============================================================= */
shareBtn.addEventListener("click", startDriving);
retryBtn.addEventListener("click", startDriving);
stopBtn.addEventListener("click", stopDriving);
