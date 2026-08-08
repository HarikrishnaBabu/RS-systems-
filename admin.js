/* =============================================================
   ADMIN MONITOR — admin.js
   ---------------------------------------------------------------
   Read-only live view of every entity currently on the network.
   Unlike the family tracker's admin page, this doesn't require a
   separate login — the /entities data is already open-read to any
   signed-in (anonymous) user by design, since drivers/pedestrians
   need to see each other too. This page just visualizes all of it
   at once instead of from one vehicle's point of view.
   ============================================================= */

const loadingCard = document.getElementById("loadingCard");
const errorCard = document.getElementById("errorCard");
const errorMessage = document.getElementById("errorMessage");
const dashboardCard = document.getElementById("dashboardCard");
const retryBtn = document.getElementById("retryBtn");

const driverCount = document.getElementById("driverCount");
const pedCount = document.getElementById("pedCount");
const emergencyCount = document.getElementById("emergencyCount");
const entityList = document.getElementById("entityList");

let mapState = null; // { map, entityMarkers } — no ego marker needed here
let unsubscribe = null;
let focusedId = null;

function connect() {
  showCard(loadingCard);

  signInAnon()
    .then(() => {
      showCard(dashboardCard);
      initMap();
      unsubscribe = subscribeEntities((entities) => {
        renderAll(entities);
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

function initMap() {
  if (mapState) return;
  const map = L.map("map").setView([20, 0], 2); // world view until we see real data
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);
  mapState = { map, entityMarkers: {}, hasFitOnce: false };
  setTimeout(() => map.invalidateSize(), 200);
}

function showCard(card) {
  [loadingCard, errorCard, dashboardCard].forEach((c) => c.classList.add("hidden"));
  card.classList.remove("hidden");
}

function showError(msg) {
  errorMessage.textContent = msg;
  showCard(errorCard);
}

function renderAll(entities) {
  const list = Object.keys(entities)
    .map((id) => ({ id, ...entities[id] }))
    .filter((e) => typeof e.lat === "number" && typeof e.lng === "number");

  // ---- Counts ----
  const drivers = list.filter((e) => e.role === "driver");
  const peds = list.filter((e) => e.role === "pedestrian");
  const emergencies = list.filter((e) => e.role === "emergency");
  driverCount.textContent = `🚗 ${drivers.length}`;
  pedCount.textContent = `🚶 ${peds.length}`;
  emergencyCount.textContent = `🚨 ${emergencies.length}`;

  // ---- Map markers (reuses the same helper driver.js/pedestrian.js use) ----
  if (mapState) {
    updateEntityMarkers(mapState, list);
    if (!mapState.hasFitOnce && list.length > 0) {
      const latLngs = list.map((e) => [e.lat, e.lng]);
      mapState.map.fitBounds(L.latLngBounds(latLngs), { padding: [30, 30] });
      mapState.hasFitOnce = true;
    }
  }

  // ---- List ----
  if (list.length === 0) {
    entityList.innerHTML = `<p style="color:var(--text-muted); padding:16px 0;">No one is currently connected to the network.</p>`;
    return;
  }

  entityList.innerHTML = list
    .map((e) => {
      const icon =
        e.role === "emergency" ? (e.subrole === "fire" ? "🚒" : "🚑") : e.role === "pedestrian" ? "🚶" : "🚗";
      const speedText = typeof e.speedKmh === "number" ? `${Math.round(e.speedKmh)} km/h` : "";
      const activeTag = e.role === "emergency" && e.emergencyActive ? " · 🚨 ACTIVE" : "";
      const staleMs = Date.now() - (e.updatedAt || 0);
      const isStale = staleMs > 2 * 60 * 1000;

      return `
        <div class="child-row" data-id="${e.id}">
          <div>
            <div class="child-row-name">${icon} ${escapeHtml(e.name || e.role)}</div>
            <div class="child-row-meta">${speedText}${activeTag}</div>
          </div>
          <span class="child-row-status ${isStale ? "stale" : "online"}">${isStale ? "Stale" : "Live"}</span>
        </div>
      `;
    })
    .join("");

  // Tap a row to fly the map to that entity
  entityList.querySelectorAll(".child-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.id;
      const e = list.find((x) => x.id === id);
      if (e && mapState) mapState.map.setView([e.lat, e.lng], 17);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

retryBtn.addEventListener("click", connect);
connect();