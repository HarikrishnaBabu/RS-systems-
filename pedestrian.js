/* =============================================================
   PEDESTRIAN MODE — pedestrian.js
   ---------------------------------------------------------------
   Broadcasts this person's position as role "pedestrian" and
   shows a distance-sorted list of nearby vehicles/emergency
   vehicles, with a banner when one is close.
   ============================================================= */

const infoCard = document.getElementById("infoCard");
const loadingCard = document.getElementById("loadingCard");
const errorCard = document.getElementById("errorCard");
const errorMessage = document.getElementById("errorMessage");
const dashboardCard = document.getElementById("dashboardCard");

const pedNameInput = document.getElementById("pedName");
const shareBtn = document.getElementById("shareBtn");
const retryBtn = document.getElementById("retryBtn");
const stopBtn = document.getElementById("stopBtn");

const nearbyCount = document.getElementById("nearbyCount");
const alertsArea = document.getElementById("alertsArea");
const nearbyList = document.getElementById("nearbyList");

const NEARBY_RANGE_M = 150;
const CLOSE_ALERT_M = 40;
const EMERGENCY_ALERT_DISTANCE_M = 400;

let entityId = generateEntityId();
let watchId = null;
let unsubscribe = null;
let latestEntities = {};
let myLat = null, myLng = null;

function startSharing() {
  if (!("geolocation" in navigator)) {
    showError("❌ This browser doesn't support the Geolocation API.");
    return;
  }
  const name = pedNameInput.value.trim();
  if (!name) {
    pedNameInput.focus();
    pedNameInput.style.borderColor = "var(--accent-red)";
    pedNameInput.placeholder = "Please enter your name first";
    return;
  }
  pedNameInput.style.borderColor = "";

  showCard(loadingCard);

  signInAnon()
    .then(() => {
      watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000,
      });
      unsubscribe = subscribeEntities((entities) => {
        latestEntities = entities;
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
  stopSharing();
}

function onPosition(position) {
  myLat = position.coords.latitude;
  myLng = position.coords.longitude;

  showCard(dashboardCard);

  writeEntity(entityId, {
    role: "pedestrian",
    name: pedNameInput.value.trim(),
    lat: myLat,
    lng: myLng,
    updatedAt: Date.now(),
  });

  renderAll();
}

function stopSharing() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  removeEntity(entityId);
  showCard(infoCard);
}

window.addEventListener("beforeunload", () => removeEntity(entityId));

function showCard(card) {
  [infoCard, loadingCard, errorCard, dashboardCard].forEach((c) => c.classList.add("hidden"));
  card.classList.remove("hidden");
}

function showError(msg) {
  errorMessage.textContent = msg;
  showCard(errorCard);
}

function renderAll() {
  if (myLat === null) return;

  const nearby = [];
  for (const id in latestEntities) {
    if (id === entityId) continue;
    const e = latestEntities[id];
    if (!e || typeof e.lat !== "number" || (e.role !== "driver" && e.role !== "emergency")) continue;
    const distance = distanceMeters(myLat, myLng, e.lat, e.lng);
    if (distance > NEARBY_RANGE_M) continue;
    nearby.push({ id, ...e, distance });
  }
  nearby.sort((a, b) => a.distance - b.distance);

  nearbyCount.textContent = `${nearby.length} nearby`;

  // ---- Alert banners ----
  const banners = [];
  const emergencyClose = nearby.find(
    (e) => e.role === "emergency" && e.emergencyActive && e.distance <= EMERGENCY_ALERT_DISTANCE_M
  );
  if (emergencyClose) {
    const icon = emergencyClose.subrole === "fire" ? "🚒" : "🚑";
    banners.push(
      `<div class="alert-banner danger">${icon} Emergency vehicle nearby (${Math.round(emergencyClose.distance)}m)</div>`
    );
  }
  const closeVehicle = nearby.find((e) => e.role === "driver" && e.distance <= CLOSE_ALERT_M);
  if (closeVehicle) {
    banners.push(
      `<div class="alert-banner danger">⚠️ Vehicle close by (${Math.round(closeVehicle.distance)}m) — stay alert</div>`
    );
  }
  alertsArea.innerHTML = banners.join("");

  // ---- List ----
  if (nearby.length === 0) {
    nearbyList.innerHTML = `<p style="color:var(--text-muted); padding:16px 0;">No vehicles detected nearby.</p>`;
    return;
  }

  nearbyList.innerHTML = nearby
    .map((e) => {
      const icon = e.role === "emergency" ? (e.subrole === "fire" ? "🚒" : "🚑") : "🚗";
      const speedText = typeof e.speedKmh === "number" ? `${Math.round(e.speedKmh)} km/h` : "";
      const close = e.distance <= CLOSE_ALERT_M;
      return `
        <div class="child-row">
          <div>
            <div class="child-row-name">${icon} ${escapeHtml(e.name || "Vehicle")}</div>
            <div class="child-row-meta">${speedText}</div>
          </div>
          <span class="child-row-status ${close ? "stale" : "online"}">${Math.round(e.distance)}m</span>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

shareBtn.addEventListener("click", startSharing);
retryBtn.addEventListener("click", startSharing);
stopBtn.addEventListener("click", stopSharing);
