/* =============================================================
   ADMIN MONITOR — admin.js
   ---------------------------------------------------------------
   Requires a real Firebase email/password sign-in (same admin
   account used by the family tracker's admin.html, if you're
   reusing that project) before showing anything.

   Honest note on what this does and doesn't protect: /entities
   itself is still readable by any anonymously-signed-in visitor,
   because drivers and pedestrians need that access to see each
   other on their own pages. This login gates the admin UI, not
   the underlying data — a technically determined person could
   still query Firebase directly. Treat this as a practical
   deterrent for a community/demo tool, not airtight security.
   ============================================================= */

const loginCard = document.getElementById("loginCard");
const loadingCard = document.getElementById("loadingCard");
const errorCard = document.getElementById("errorCard");
const errorMessage = document.getElementById("errorMessage");
const dashboardCard = document.getElementById("dashboardCard");

const adminEmail = document.getElementById("adminEmail");
const adminPassword = document.getElementById("adminPassword");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const retryBtn = document.getElementById("retryBtn");
const logoutBtn = document.getElementById("logoutBtn");

const driverCount = document.getElementById("driverCount");
const pedCount = document.getElementById("pedCount");
const emergencyCount = document.getElementById("emergencyCount");
const entityList = document.getElementById("entityList");
const roleFilterRow = document.getElementById("roleFilterRow");
const searchInput = document.getElementById("searchInput");
const clearStaleBtn = document.getElementById("clearStaleBtn");
const zoneTypeRow = document.getElementById("zoneTypeRow");
const placeZoneBtn = document.getElementById("placeZoneBtn");
const zoneList = document.getElementById("zoneList");

let selectedZoneType = "school";
let placingZone = false;
let customZonesCache = {};
let unsubscribeZones = null;

/* ---- Zone type chips ---- */
zoneTypeRow.querySelectorAll(".filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    selectedZoneType = chip.dataset.ztype;
    zoneTypeRow.querySelectorAll(".filter-chip").forEach((c) => c.classList.toggle("selected", c === chip));
  });
});

/* ---- Place-zone toggle + map click handling ---- */
placeZoneBtn.addEventListener("click", () => {
  placingZone = !placingZone;
  placeZoneBtn.textContent = placingZone ? "📍 Tap the map now..." : "📍 Tap Map To Place";
  placeZoneBtn.classList.toggle("active", placingZone);
});

function handleMapClickForZonePlacement(e) {
  if (!placingZone) return;
  const name = prompt(
    `Name for this ${selectedZoneType} zone?`,
    selectedZoneType === "school" ? "School" : selectedZoneType === "hospital" ? "Hospital" : "Construction Zone"
  );
  if (name === null) {
    // User cancelled — leave placement mode on so they can try again
    return;
  }
  const zoneId = generateEntityId();
  writeCustomZone(zoneId, {
    type: selectedZoneType,
    name: name.trim() || selectedZoneType,
    lat: e.latlng.lat,
    lng: e.latlng.lng,
    createdAt: Date.now(),
  });
  placingZone = false;
  placeZoneBtn.textContent = "📍 Tap Map To Place";
  placeZoneBtn.classList.remove("active");
}

let mapState = null;
let unsubscribe = null;
let latestEntitiesCache = {};
let activeFilter = "all";
let refreshTimer = null;

/* ---- Role filter chips ---- */
roleFilterRow.querySelectorAll(".filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    activeFilter = chip.dataset.filter;
    roleFilterRow.querySelectorAll(".filter-chip").forEach((c) => c.classList.toggle("selected", c === chip));
    renderAll(latestEntitiesCache);
  });
});

/* ---- Search box ---- */
searchInput.addEventListener("input", () => renderAll(latestEntitiesCache));

/* ---- Manual cleanup for anything onDisconnect somehow missed ---- */
const STALE_THRESHOLD_MS = 2 * 60 * 1000;
clearStaleBtn.addEventListener("click", () => {
  const staleIds = Object.keys(latestEntitiesCache).filter((id) => {
    const e = latestEntitiesCache[id];
    return e && Date.now() - (e.updatedAt || 0) > STALE_THRESHOLD_MS;
  });
  if (staleIds.length === 0) return;
  staleIds.forEach((id) => db.ref(`entities/${id}`).remove());
});

/* -----------------------------------------------------------
   LOGIN / LOGOUT
   ----------------------------------------------------------- */
loginBtn.addEventListener("click", () => {
  loginError.classList.add("hidden");
  const email = adminEmail.value.trim();
  const password = adminPassword.value;

  if (!email || !password) {
    loginError.textContent = "Please enter both email and password.";
    loginError.classList.remove("hidden");
    return;
  }

  auth.signInWithEmailAndPassword(email, password).catch((err) => {
    loginError.textContent = "Sign-in failed: " + err.message;
    loginError.classList.remove("hidden");
  });
  // onAuthStateChanged below takes it from here on success
});

logoutBtn.addEventListener("click", () => {
  auth.signOut();
});

auth.onAuthStateChanged((user) => {
  // Anonymous users (e.g. if a driver/pedestrian tab is also open in
  // this browser) don't count as "logged in" for this admin page —
  // only a real email/password account does.
  const isRealAdmin = user && !user.isAnonymous;

  if (isRealAdmin) {
    loginCard.classList.add("hidden");
    showCard(loadingCard);
    connect();
  } else {
    dashboardCard.classList.add("hidden");
    errorCard.classList.add("hidden");
    loadingCard.classList.add("hidden");
    loginCard.classList.remove("hidden");
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (unsubscribeZones) {
      unsubscribeZones();
      unsubscribeZones = null;
    }
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }
});

/* -----------------------------------------------------------
   CONNECT: subscribe to the live entities feed once logged in
   ----------------------------------------------------------- */
function connect() {
  showCard(dashboardCard);
  initMap();
  unsubscribe = subscribeEntities((entities) => {
    latestEntitiesCache = entities;
    renderAll(entities);
  });
  unsubscribeZones = subscribeCustomZones((zones) => {
    customZonesCache = zones;
    renderZones();
  });

  // Refresh the list periodically even without new data, so "last
  // seen X ago" text and stale/live status stay current in real time.
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => renderAll(latestEntitiesCache), 5000);
}

function initMap() {
  if (mapState) return;
  const map = L.map("map").setView([20, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);
  mapState = { map, entityMarkers: {}, zoneMarkers: {}, hasFitOnce: false };
  map.on("click", handleMapClickForZonePlacement);
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

/* -----------------------------------------------------------
   RENDER: counts, map markers, and the tappable list
   ----------------------------------------------------------- */
function renderAll(entities) {
  const allList = Object.keys(entities)
    .map((id) => ({ id, ...entities[id] }))
    .filter((e) => typeof e.lat === "number" && typeof e.lng === "number");

  // ---- Counts always reflect everyone, regardless of filter/search ----
  const drivers = allList.filter((e) => e.role === "driver");
  const peds = allList.filter((e) => e.role === "pedestrian");
  const emergencies = allList.filter((e) => e.role === "emergency");
  driverCount.textContent = `🚗 ${drivers.length}`;
  pedCount.textContent = `🚶 ${peds.length}`;
  emergencyCount.textContent = `🚨 ${emergencies.length}`;

  // ---- Map shows everyone, unaffected by list filter/search ----
  if (mapState) {
    updateEntityMarkers(mapState, allList);
    if (!mapState.hasFitOnce && allList.length > 0) {
      const latLngs = allList.map((e) => [e.lat, e.lng]);
      mapState.map.fitBounds(L.latLngBounds(latLngs), { padding: [30, 30] });
      mapState.hasFitOnce = true;
    }
  }

  // ---- List: apply role filter + search ----
  const query = searchInput.value.trim().toLowerCase();
  const list = allList.filter((e) => {
    if (activeFilter !== "all" && e.role !== activeFilter) return false;
    if (query) {
      const haystack = `${e.name || ""} ${e.vehicleNumber || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  if (list.length === 0) {
    entityList.innerHTML = `<p style="color:var(--text-muted); padding:16px 0;">No matching entities right now.</p>`;
    return;
  }

  entityList.innerHTML = list
    .map((e) => {
      const icon =
        e.role === "emergency" ? (e.subrole === "fire" ? "🚒" : "🚑") : e.role === "pedestrian" ? "🚶" : "🚗";
      const speedText = typeof e.speedKmh === "number" ? `${Math.round(e.speedKmh)} km/h` : "";
      const plateText = e.vehicleNumber ? ` · ${escapeHtml(e.vehicleNumber)}` : "";
      const activeTag = e.role === "emergency" && e.emergencyActive ? " · 🚨 ACTIVE" : "";
      const staleMs = Date.now() - (e.updatedAt || 0);
      const isStale = staleMs > 2 * 60 * 1000;
      const lastSeenText = formatLastSeen(staleMs);

      return `
        <div class="child-row" data-id="${e.id}">
          <div>
            <div class="child-row-name">${icon} ${escapeHtml(e.name || e.role)}</div>
            <div class="child-row-meta">${speedText}${plateText}${activeTag} · last seen ${lastSeenText}</div>
          </div>
          <span class="child-row-status ${isStale ? "stale" : "online"}">${isStale ? "Stale" : "Live"}</span>
        </div>
      `;
    })
    .join("");

  entityList.querySelectorAll(".child-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.id;
      const e = list.find((x) => x.id === id);
      if (e && mapState) mapState.map.setView([e.lat, e.lng], 17);
    });
  });
}

/* Turn a millisecond age into a short "Xs ago" / "Xm ago" string */
function formatLastSeen(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/* -----------------------------------------------------------
   ZONE LIST: admin-placed hospital/school/construction markers
   ----------------------------------------------------------- */
const ZONE_EMOJI = { school: "🏫", hospital: "🏥", construction: "🚧" };

function renderZones() {
  const zones = Object.keys(customZonesCache).map((id) => ({ id, ...customZonesCache[id] }));

  if (mapState) updateZoneMarkers(mapState, zones);

  if (zones.length === 0) {
    zoneList.innerHTML = `<p style="color:var(--text-muted); padding:10px 0 16px;">No custom zones added yet.</p>`;
    return;
  }

  zoneList.innerHTML = zones
    .map(
      (z) => `
        <div class="child-row">
          <div>
            <div class="child-row-name">${ZONE_EMOJI[z.type] || "📍"} ${escapeHtml(z.name || z.type)}</div>
            <div class="child-row-meta">${z.type}</div>
          </div>
          <button class="btn btn-secondary" style="width:auto; padding:5px 12px; font-size:0.75rem;" data-zone-id="${z.id}">🗑️ Remove</button>
        </div>
      `
    )
    .join("");

  zoneList.querySelectorAll("[data-zone-id]").forEach((btn) => {
    btn.addEventListener("click", () => removeCustomZone(btn.dataset.zoneId));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

retryBtn.addEventListener("click", connect);
