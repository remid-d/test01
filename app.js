"use strict";

const STORAGE_KEY = "finistere-roadtrip-stops";
const AVG_SPEED_KMH = 50; // hypothèse pour l'estimation à vol d'oiseau si le calcul d'itinéraire échoue
const FINISTERE_VIEWBOX = "-5.3,48.9,-3.3,47.7"; // left,top,right,bottom : biaise la recherche d'adresse vers le Finistère
const GMAPS_MAX_STOPS_PER_LINK = 11; // origine + destination + 9 waypoints (limite de l'URL Google Maps)

const TYPES = {
  activite: [
    { value: "plage", label: "🏖️ Plage" },
    { value: "surf", label: "🏄 Surf" },
    { value: "randonnee", label: "🥾 Randonnée" },
    { value: "point_de_vue", label: "👁️ Point de vue" },
    { value: "visite", label: "🏛️ Visite" },
    { value: "autre_activite", label: "📍 Autre" },
  ],
  dodo: [
    { value: "parking_van", label: "🚐 Parking van aménagé" },
    { value: "aire_camping_car", label: "🅿️ Aire de camping-car" },
    { value: "camping", label: "⛺ Camping" },
    { value: "bivouac", label: "🌙 Bivouac / spot sauvage" },
    { value: "autre_dodo", label: "📍 Autre" },
  ],
};

const TYPE_EMOJI = Object.fromEntries(
  [...TYPES.activite, ...TYPES.dodo].map((t) => [t.value, t.label.split(" ")[0]])
);

const SEED_STOPS = [
  {
    name: "Plage de la Torche",
    category: "activite",
    type: "surf",
    lat: 47.8385,
    lng: -4.3517,
    date: "",
    rating: 0,
    notes: "Spot de surf réputé, pointe très exposée à la houle. Vérifier les conditions avant d'y aller.",
  },
  {
    name: "Pointe du Raz",
    category: "activite",
    type: "point_de_vue",
    lat: 48.0392,
    lng: -4.7333,
    date: "",
    rating: 0,
    notes: "Point de vue emblématique du Finistère, à l'extrême pointe de la Bretagne.",
  },
  {
    name: "Camaret-sur-Mer",
    category: "activite",
    type: "visite",
    lat: 48.2797,
    lng: -4.5911,
    date: "",
    rating: 0,
    notes: "Petit port typique, proche de la pointe de Pen-Hir.",
  },
  {
    name: "Aire de camping-car (à vérifier sur place)",
    category: "dodo",
    type: "aire_camping_car",
    lat: 48.2019,
    lng: -4.4712,
    date: "",
    rating: 0,
    notes: "Exemple de point 'dodo' — remplacez par une vraie aire trouvée sur Park4Night / Campercontact une fois sur place.",
  },
];

/** @typedef {{id:string, name:string, category:'activite'|'dodo', type:string, lat:number, lng:number, date:string, rating:number, notes:string, order:number, createdAt:number}} Stop */

/** @type {Stop[]} */
let stops = loadStops();
let currentFilter = "all";
let addMode = false;
let editingId = null;
let pendingLatLng = null;

let tempMarker = null;
let routeLines = [];
const markersById = new Map();
const legCache = new Map();

function assignMissingOrders(list) {
  const needsMigration = list.some((s) => typeof s.order !== "number");
  if (needsMigration) {
    list
      .slice()
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0))
      .forEach((s, i) => {
        s.order = i + 1;
      });
  }
  return list;
}

function loadStops() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return assignMissingOrders(parsed);
  } catch (e) {
    console.error("Impossible de lire les données sauvegardées", e);
    return [];
  }
}

function saveStops() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stops));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nextOrder() {
  return (stops.length ? Math.max(...stops.map((s) => s.order)) : 0) + 1;
}

function sortedStops() {
  return [...stops].sort((a, b) => a.order - b.order);
}

function renumber() {
  sortedStops().forEach((s, i) => {
    s.order = i + 1;
  });
}

function moveStop(id, dir) {
  const sorted = sortedStops();
  const idx = sorted.findIndex((s) => s.id === id);
  const swapIdx = idx + dir;
  if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return;
  const tmp = sorted[idx].order;
  sorted[idx].order = sorted[swapIdx].order;
  sorted[swapIdx].order = tmp;
  refreshAll();
}

function getVisibleStops() {
  const sorted = sortedStops();
  if (currentFilter === "all") return sorted;
  return sorted.filter((s) => s.category === currentFilter);
}

// ---------- Trajets (distance / durée) ----------

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatKm(km) {
  return km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km).toString();
}

function formatDuration(min) {
  const total = Math.round(min);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function legKey(a, b) {
  return `${a.id}__${b.id}__${a.lat.toFixed(5)}_${a.lng.toFixed(5)}__${b.lat.toFixed(5)}_${b.lng.toFixed(5)}`;
}

async function fetchRoute(a, b) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("OSRM HTTP " + res.status);
    const json = await res.json();
    const route = json.routes && json.routes[0];
    if (!route) throw new Error("Pas d'itinéraire trouvé");
    return {
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      source: "osrm",
    };
  } catch (e) {
    const distanceKm = haversineKm(a, b);
    return {
      distanceKm,
      durationMin: (distanceKm / AVG_SPEED_KMH) * 60,
      coords: [
        [a.lat, a.lng],
        [b.lat, b.lng],
      ],
      source: "estimate",
    };
  }
}

function ensureLeg(a, b) {
  const key = legKey(a, b);
  const existing = legCache.get(key);
  if (existing) return existing;

  const entry = { status: "loading" };
  legCache.set(key, entry);
  fetchRoute(a, b).then((result) => {
    legCache.set(key, { status: "ready", ...result });
    rebuildRoute();
    renderList();
  });
  return entry;
}

// ---------- Map ----------

const map = L.map("map").setView([48.15, -4.3], 10);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

function makeIcon(category, type, order) {
  const emoji = TYPE_EMOJI[type] || (category === "dodo" ? "🚐" : "📍");
  return L.divIcon({
    className: "",
    html: `<div class="marker-wrap">
      <div class="marker-pin ${category}"><span>${emoji}</span></div>
      <div class="marker-order">${order}</div>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -30],
  });
}

function stars(n) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function popupHtml(stop) {
  const typeLabel = (TYPES[stop.category].find((t) => t.value === stop.type) || {}).label || stop.type;
  return `
    <div class="popup-content">
      <h3>#${stop.order} · ${escapeHtml(stop.name)}</h3>
      <div>${typeLabel}</div>
      ${stop.date ? `<div>📅 ${stop.date}</div>` : ""}
      ${stop.rating ? `<div class="stars">${stars(stop.rating)}</div>` : ""}
      ${stop.notes ? `<div>${escapeHtml(stop.notes)}</div>` : ""}
      <div class="popup-actions">
        <button data-action="edit" data-id="${stop.id}">Modifier</button>
        <button data-action="delete" data-id="${stop.id}">Supprimer</button>
      </div>
    </div>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function rebuildMarkers() {
  markersById.forEach((m) => map.removeLayer(m));
  markersById.clear();

  getVisibleStops().forEach((stop) => {
    const marker = L.marker([stop.lat, stop.lng], { icon: makeIcon(stop.category, stop.type, stop.order) }).addTo(map);
    marker.bindPopup(popupHtml(stop));
    marker.on("popupopen", (e) => {
      const el = e.popup.getElement();
      el.querySelector('[data-action="edit"]').addEventListener("click", () => openForm(stop.id));
      el.querySelector('[data-action="delete"]').addEventListener("click", () => deleteStop(stop.id));
    });
    markersById.set(stop.id, marker);
  });

  rebuildRoute();
}

function rebuildRoute() {
  routeLines.forEach((l) => map.removeLayer(l));
  routeLines = [];
  if (!showRoute) return;

  const visible = getVisibleStops();
  for (let i = 0; i < visible.length - 1; i++) {
    const a = visible[i];
    const b = visible[i + 1];
    const leg = ensureLeg(a, b);
    const latlngs =
      leg.status === "ready"
        ? leg.coords
        : [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ];
    const isEstimate = leg.status !== "ready" || leg.source === "estimate";
    const line = L.polyline(latlngs, {
      color: "#26241f",
      weight: 3,
      opacity: 0.75,
      dashArray: isEstimate ? "6 6" : null,
    }).addTo(map);
    routeLines.push(line);
  }
}

map.on("click", (e) => {
  if (!addMode) return;
  pendingLatLng = e.latlng;
  setAddMode(false);
  openForm(null, pendingLatLng);
});

// ---------- Sidebar list ----------

function stopCardHtml(s) {
  const typeLabel = (TYPES[s.category].find((t) => t.value === s.type) || {}).label || s.type;
  return `
      <div class="stop-card" data-id="${s.id}">
        <div class="row1">
          <span class="order-badge">${s.order}</span>
          <span class="badge ${s.category}">${s.category === "activite" ? "Activité" : "Dodo"}</span>
          <span class="stop-name">${escapeHtml(s.name)}</span>
          <span class="reorder-btns">
            <button type="button" class="reorder-btn" data-move="-1" data-id="${s.id}" title="Monter dans l'ordre">▲</button>
            <button type="button" class="reorder-btn" data-move="1" data-id="${s.id}" title="Descendre dans l'ordre">▼</button>
          </span>
        </div>
        <div class="meta">${typeLabel}${s.date ? " · " + s.date : ""}</div>
        ${s.rating ? `<div class="stars">${stars(s.rating)}</div>` : ""}
        ${s.notes ? `<div class="notes">${escapeHtml(s.notes)}</div>` : ""}
      </div>`;
}

function googleMapsDirectionsUrl(stopsList) {
  if (stopsList.length < 2) return "";
  const origin = stopsList[0];
  const destination = stopsList[stopsList.length - 1];
  const waypoints = stopsList.slice(1, -1);
  const params = new URLSearchParams({
    api: "1",
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    travelmode: "driving",
  });
  if (waypoints.length) {
    params.set("waypoints", waypoints.map((s) => `${s.lat},${s.lng}`).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function legRowHtml(a, b) {
  const leg = ensureLeg(a, b);
  let content;
  if (leg.status !== "ready") {
    content = `<span class="leg-loading">Calcul du trajet…</span>`;
  } else {
    const estimateNote = leg.source === "estimate" ? ` <span class="leg-estimate">(estimation à vol d'oiseau)</span>` : "";
    content = `🚗 ${formatKm(leg.distanceKm)} km · ${formatDuration(leg.durationMin)}${estimateNote}`;
  }
  const gmapsUrl = googleMapsDirectionsUrl([a, b]);
  return `<div class="leg-row">${content} <a class="leg-gmaps" href="${gmapsUrl}" target="_blank" rel="noopener">Google Maps ↗</a></div>`;
}

function renderGmapsLinks() {
  const container = document.getElementById("gmapsLinks");
  const visible = getVisibleStops();
  if (visible.length < 2) {
    container.innerHTML = "";
    return;
  }

  const chunks = [];
  let i = 0;
  while (i < visible.length - 1) {
    const chunk = visible.slice(i, i + GMAPS_MAX_STOPS_PER_LINK);
    chunks.push(chunk);
    i += GMAPS_MAX_STOPS_PER_LINK - 1;
  }

  container.innerHTML = chunks
    .map((chunk) => {
      const url = googleMapsDirectionsUrl(chunk);
      const label =
        chunks.length > 1
          ? `🗺️ Ouvrir étapes #${chunk[0].order} → #${chunk[chunk.length - 1].order} dans Google Maps ↗`
          : `🗺️ Ouvrir l'itinéraire dans Google Maps ↗`;
      return `<a class="gmaps-link-btn" href="${url}" target="_blank" rel="noopener">${label}</a>`;
    })
    .join("");
}

function renderList() {
  const container = document.getElementById("stopList");
  const visible = getVisibleStops();

  if (visible.length === 0) {
    container.innerHTML = `<p class="empty-msg">Aucun point pour l'instant.<br>Cherchez une adresse ci-dessus ou placez un point sur la carte pour commencer.</p>`;
    renderGmapsLinks();
    return;
  }

  let html = "";
  visible.forEach((s, i) => {
    html += stopCardHtml(s);
    if (showRoute && i < visible.length - 1) {
      html += legRowHtml(s, visible[i + 1]);
    }
  });
  container.innerHTML = html;

  container.querySelectorAll(".reorder-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      moveStop(btn.dataset.id, Number(btn.dataset.move));
    });
  });

  container.querySelectorAll(".stop-card").forEach((card) => {
    card.addEventListener("click", () => {
      const stop = stops.find((s) => s.id === card.dataset.id);
      if (!stop) return;
      map.setView([stop.lat, stop.lng], 14, { animate: true });
      const marker = markersById.get(stop.id);
      if (marker) marker.openPopup();
      if (window.innerWidth <= 800) closeSidebarMobile();
    });
  });

  renderGmapsLinks();
}

function renderStats() {
  const n = stops.length;
  const a = stops.filter((s) => s.category === "activite").length;
  const d = stops.filter((s) => s.category === "dodo").length;
  document.getElementById("stats").textContent = `${n} point${n > 1 ? "s" : ""} · ${a} activité${a > 1 ? "s" : ""} · ${d} dodo${d > 1 ? "s" : ""}`;
}

function refreshAll() {
  saveStops();
  rebuildMarkers();
  renderList();
  renderStats();
}

// ---------- Form ----------

const formOverlay = document.getElementById("formOverlay");
const stopForm = document.getElementById("stopForm");
const fName = document.getElementById("f-name");
const fCategory = document.getElementById("f-category");
const fType = document.getElementById("f-type");
const fDate = document.getElementById("f-date");
const fNotes = document.getElementById("f-notes");
const fCoords = document.getElementById("f-coords");
const ratingEl = document.getElementById("f-rating");
const deleteStopBtn = document.getElementById("deleteStopBtn");

function populateTypeOptions() {
  const cat = fCategory.value;
  fType.innerHTML = TYPES[cat].map((t) => `<option value="${t.value}">${t.label}</option>`).join("");
}

fCategory.addEventListener("change", populateTypeOptions);

ratingEl.addEventListener("click", (e) => {
  const star = e.target.closest("[data-star]");
  if (!star) return;
  setRating(Number(star.dataset.star));
});

function setRating(n) {
  ratingEl.dataset.value = String(n);
  [...ratingEl.children].forEach((el) => {
    el.classList.toggle("filled", Number(el.dataset.star) <= n);
  });
}

function openForm(id, latlng) {
  editingId = id;
  const editing = id ? stops.find((s) => s.id === id) : null;

  document.getElementById("formTitle").textContent = editing
    ? `Modifier l'étape #${editing.order}`
    : `Nouvelle étape (#${nextOrder()})`;
  deleteStopBtn.classList.toggle("hidden", !editing);

  fName.value = editing ? editing.name : "";
  fCategory.value = editing ? editing.category : "activite";
  populateTypeOptions();
  fType.value = editing ? editing.type : TYPES[fCategory.value][0].value;
  fDate.value = editing ? editing.date : "";
  fNotes.value = editing ? editing.notes : "";
  setRating(editing ? editing.rating : 0);

  const coords = editing ? { lat: editing.lat, lng: editing.lng } : latlng;
  fCoords.dataset.lat = coords.lat;
  fCoords.dataset.lng = coords.lng;
  fCoords.textContent = `📍 ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;

  if (tempMarker) {
    map.removeLayer(tempMarker);
    tempMarker = null;
  }
  if (!editing) {
    tempMarker = L.marker([coords.lat, coords.lng], {
      icon: makeIcon(fCategory.value, fType.value, nextOrder()),
    }).addTo(map);
  }

  formOverlay.classList.remove("hidden");
  fName.focus();
}

function closeForm() {
  formOverlay.classList.add("hidden");
  editingId = null;
  pendingLatLng = null;
  if (tempMarker) {
    map.removeLayer(tempMarker);
    tempMarker = null;
  }
}

document.getElementById("cancelForm").addEventListener("click", closeForm);

stopForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    name: fName.value.trim(),
    category: fCategory.value,
    type: fType.value,
    date: fDate.value,
    rating: Number(ratingEl.dataset.value),
    notes: fNotes.value.trim(),
    lat: Number(fCoords.dataset.lat),
    lng: Number(fCoords.dataset.lng),
  };
  if (!data.name) return;

  if (editingId) {
    const stop = stops.find((s) => s.id === editingId);
    Object.assign(stop, data);
  } else {
    stops.push({ id: uid(), createdAt: Date.now(), order: nextOrder(), ...data });
  }

  closeForm();
  refreshAll();
});

deleteStopBtn.addEventListener("click", () => {
  if (!editingId) return;
  deleteStop(editingId);
  closeForm();
});

function deleteStop(id) {
  if (!confirm("Supprimer ce point ?")) return;
  stops = stops.filter((s) => s.id !== id);
  renumber();
  refreshAll();
}

// ---------- Add mode ----------

const addModeBtn = document.getElementById("addModeBtn");

function setAddMode(value) {
  addMode = value;
  document.body.classList.toggle("add-mode", addMode);
  addModeBtn.classList.toggle("active", addMode);
  addModeBtn.textContent = addMode ? "Cliquez sur la carte…" : "📍 ou placer un point manuellement sur la carte";
}

addModeBtn.addEventListener("click", () => setAddMode(!addMode));

// ---------- Recherche d'adresse / de lieu ----------

const placeSearchInput = document.getElementById("placeSearch");
const searchResultsEl = document.getElementById("searchResults");
let searchDebounceTimer = null;
let searchToken = 0;

function hideSearchResults() {
  searchResultsEl.classList.add("hidden");
  searchResultsEl.innerHTML = "";
}

function shortenPlaceName(r) {
  if (r.name) return r.name;
  return r.display_name.split(",")[0];
}

function renderSearchResults(results) {
  if (!results.length) {
    searchResultsEl.innerHTML = `<div class="search-result-status">Aucun résultat.</div>`;
    return;
  }
  searchResultsEl.innerHTML = results
    .map((r, i) => `<div class="search-result-item" data-index="${i}">${escapeHtml(r.display_name)}</div>`)
    .join("");
  searchResultsEl.querySelectorAll(".search-result-item").forEach((el) => {
    el.addEventListener("click", () => selectSearchResult(results[Number(el.dataset.index)]));
  });
}

function selectSearchResult(r) {
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  hideSearchResults();
  placeSearchInput.value = "";
  if (addMode) setAddMode(false);
  map.setView([lat, lng], 15, { animate: true });
  openForm(null, { lat, lng });
  fName.value = shortenPlaceName(r);
}

async function runPlaceSearch(query) {
  const token = ++searchToken;
  searchResultsEl.classList.remove("hidden");
  searchResultsEl.innerHTML = `<div class="search-result-status">Recherche…</div>`;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&viewbox=${FINISTERE_VIEWBOX}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (token !== searchToken) return;
    if (!res.ok) throw new Error("HTTP " + res.status);
    const results = await res.json();
    if (token !== searchToken) return;
    renderSearchResults(results);
  } catch (e) {
    if (token !== searchToken) return;
    searchResultsEl.innerHTML = `<div class="search-result-status">Recherche indisponible. Réessayez, ou placez un point sur la carte.</div>`;
  }
}

placeSearchInput.addEventListener("input", () => {
  const query = placeSearchInput.value.trim();
  clearTimeout(searchDebounceTimer);
  if (query.length < 3) {
    hideSearchResults();
    return;
  }
  searchDebounceTimer = setTimeout(() => runPlaceSearch(query), 400);
});

placeSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideSearchResults();
  } else if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(searchDebounceTimer);
    const query = placeSearchInput.value.trim();
    if (query.length >= 3) runPlaceSearch(query);
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest("#searchWrap")) hideSearchResults();
});

// ---------- Filters ----------

document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    rebuildMarkers();
    renderList();
  });
});

// ---------- Itinéraire (afficher/masquer) ----------

const routeToggle = document.getElementById("routeToggle");
let showRoute = routeToggle.checked;

routeToggle.addEventListener("change", () => {
  showRoute = routeToggle.checked;
  rebuildRoute();
  renderList();
});

// ---------- Seed examples ----------

document.getElementById("seedBtn").addEventListener("click", () => {
  if (!confirm("Ajouter quelques points d'exemple dans le Finistère ?")) return;
  SEED_STOPS.forEach((s) => stops.push({ id: uid(), createdAt: Date.now(), order: nextOrder(), ...s }));
  refreshAll();
});

// ---------- Export / Import ----------

document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(stops, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roadtrip-finistere-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildGpx() {
  const ordered = sortedStops();

  const wpts = ordered
    .map((s) => {
      const typeLabel = (TYPES[s.category].find((t) => t.value === s.type) || {}).label || s.type;
      const desc = `${typeLabel}${s.notes ? " — " + s.notes : ""}`;
      return `  <wpt lat="${s.lat}" lon="${s.lng}">
    <name>${escapeXml(`#${s.order} ${s.name}`)}</name>
    <desc>${escapeXml(desc)}</desc>
  </wpt>`;
    })
    .join("\n");

  const trkpts = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];
    const leg = legCache.get(legKey(a, b));
    const coords =
      leg && leg.status === "ready"
        ? leg.coords
        : [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ];
    coords.forEach(([lat, lng]) => trkpts.push(`      <trkpt lat="${lat}" lon="${lng}"></trkpt>`));
  }

  const trk =
    trkpts.length > 0
      ? `  <trk>
    <name>Itinéraire roadtrip Finistère</name>
    <trkseg>
${trkpts.join("\n")}
    </trkseg>
  </trk>\n`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Roadtrip Finistère" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
${trk}</gpx>
`;
}

document.getElementById("exportGpxBtn").addEventListener("click", () => {
  const blob = new Blob([buildGpx()], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roadtrip-finistere-${new Date().toISOString().slice(0, 10)}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("importInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error("Format invalide");
      if (confirm(`Importer ${imported.length} point(s) ? Cela remplacera les données actuelles.`)) {
        stops = assignMissingOrders(imported);
        legCache.clear();
        refreshAll();
      }
    } catch (err) {
      alert("Fichier invalide : " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// ---------- Sidebar toggle (mobile) ----------

const sidebar = document.getElementById("sidebar");
document.getElementById("toggleSidebar").addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

function closeSidebarMobile() {
  sidebar.classList.remove("open");
}

// ---------- Init ----------

populateTypeOptions();
refreshAll();
