/* =============================================================
   EMERGENCY VEHICLE MODE — emergency.js
   ---------------------------------------------------------------
   Broadcasts this vehicle as role "emergency". The "Emergency
   Mode" toggle sets emergencyActive true/false — when true,
   drivers and pedestrians in range see a "pull over" alert
   (see the alert logic in driver.js / pedestrian.js).
   ============================================================= */

const infoCard = document.getElementById("infoCard");
const loadingCard = document.getElementById("loadingCard");
const errorCard = document.getElementById("errorCard");
const errorMessage = document.getElementById("errorMessage");
const dashboardCard = document.getElementById("dashboardCard");

const vehicleNameInput = document.getElementById("vehicleName");
const ambulanceBtn = document.getElementById("ambulanceBtn");
const fireBtn = document.getElementById("fireBtn");
const shareBtn = document.getElementById("shareBtn");
const retryBtn = document.getElementById("retryBtn");
const stopBtn = document.getElementById("stopBtn");
const emergencyToggle = document.getElementById("emergencyToggle");

const alertedCount = document.getElementById("alertedCount");
const speedValue = document.getElementById("speedValue");
const accValue = document.getElementById("accValue");
const timeValue = document.getElementById("timeValue");

const ALERT_RADIUS_M = 400;

let entityId = generateEntityId();
let watchId = null;
let unsubscribe = null;
let latestEntities = {};
let myLat = null, myLng = null;
let subrole = "ambulance";
let emergencyActive = false;

/* ---- Vehicle type toggle ---- */
[ambulanceBtn, fireBtn].forEach((btn) => {
  btn.addEventListener("click", () => {
    subrole = btn.dataset.subrole;
    ambulanceBtn.classList.toggle("selected", subrole === "ambulance");
    fireBtn.classList.toggle("selected", subrole === "fire");
  });
});

/* ---- Emergency mode toggle ---- */
emergencyToggle.addEventListener("click", () => {
  emergencyActive = !emergencyActive;
  emergencyToggle.textContent = emergencyActive ? "🚨 Emergency Mode: ON" : "🚨 Emergency Mode: OFF";
  emergencyToggle.classList.toggle("active", emergencyActive);
  broadcastCurrentState();
});

function startBroadcasting() {
  if (!("geolocation" in navigator)) {
    showError("❌ This browser doesn't support the Geolocation API.");
    return;
  }
  const name = vehicleNameInput.value.trim();
  if (!name) {
    vehicleNameInput.focus();
    vehicleNameInput.style.borderColor = "var(--accent-red)";
    vehicleNameInput.placeholder = "Please enter a call sign first";
    return;
  }
  vehicleNameInput.style.borderColor = "";

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
        renderAlertedCount();
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
  stopBroadcasting();
}

let lastSpeedKmh = 0, lastAccuracy = null;

function onPosition(position) {
  myLat = position.coords.latitude;
  myLng = position.coords.longitude;
  lastAccuracy = position.coords.accuracy;
  lastSpeedKmh =
    position.coords.speed === null || position.coords.speed === undefined
      ? 0
      : position.coords.speed * 3.6;

  showCard(dashboardCard);

  speedValue.textContent = `${lastSpeedKmh.toFixed(0)} km/h`;
  accValue.textContent = `${Math.round(lastAccuracy)} m`;
  timeValue.textContent = new Date(position.timestamp).toLocaleTimeString();

  broadcastCurrentState();
  renderAlertedCount();
}

function broadcastCurrentState() {
  if (myLat === null) return;
  writeEntity(entityId, {
    role: "emergency",
    subrole,
    name: vehicleNameInput.value.trim(),
    lat: myLat,
    lng: myLng,
    speedKmh: lastSpeedKmh,
    emergencyActive,
    updatedAt: Date.now(),
  });
}

function renderAlertedCount() {
  if (myLat === null) return;
  let count = 0;
  for (const id in latestEntities) {
    if (id === entityId) continue;
    const e = latestEntities[id];
    if (!e || (e.role !== "driver" && e.role !== "pedestrian")) continue;
    if (distanceMeters(myLat, myLng, e.lat, e.lng) <= ALERT_RADIUS_M) count++;
  }
  alertedCount.textContent = `${count} in range`;
}

function stopBroadcasting() {
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

shareBtn.addEventListener("click", startBroadcasting);
retryBtn.addEventListener("click", startBroadcasting);
stopBtn.addEventListener("click", stopBroadcasting);
