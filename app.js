"use strict";

const STORAGE_KEY = "finistere-roadtrip-stops";

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

/** @typedef {{id:string, name:string, category:'activite'|'dodo', type:string, lat:number, lng:number, date:string, rating:number, notes:string, createdAt:number}} Stop */

/** @type {Stop[]} */
let stops = loadStops();
let currentFilter = "all";
let addMode = false;
let editingId = null;
let pendingLatLng = null;
let showRoute = false;

let tempMarker = null;
let routeLine = null;
const markersById = new Map();

function loadStops() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
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

// ---------- Map ----------

const map = L.map("map").setView([48.15, -4.3], 10);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

function makeIcon(category, type) {
  const emoji = TYPE_EMOJI[type] || (category === "dodo" ? "🚐" : "📍");
  return L.divIcon({
    className: "",
    html: `<div class="marker-pin ${category}"><span>${emoji}</span></div>`,
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
      <h3>${escapeHtml(stop.name)}</h3>
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
    const marker = L.marker([stop.lat, stop.lng], { icon: makeIcon(stop.category, stop.type) }).addTo(map);
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
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  if (!showRoute) return;
  const ordered = getVisibleStops()
    .filter((s) => s.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  if (ordered.length < 2) return;
  routeLine = L.polyline(
    ordered.map((s) => [s.lat, s.lng]),
    { color: "#26241f", weight: 2, dashArray: "6 6" }
  ).addTo(map);
}

function getVisibleStops() {
  if (currentFilter === "all") return stops;
  return stops.filter((s) => s.category === currentFilter);
}

map.on("click", (e) => {
  if (!addMode) return;
  pendingLatLng = e.latlng;
  setAddMode(false);
  openForm(null, pendingLatLng);
});

// ---------- Sidebar list ----------

function renderList() {
  const container = document.getElementById("stopList");
  const visible = getVisibleStops().slice().sort((a, b) => b.createdAt - a.createdAt);

  if (visible.length === 0) {
    container.innerHTML = `<p class="empty-msg">Aucun point pour l'instant.<br>Cliquez sur "+ Ajouter un point" puis sur la carte pour commencer.</p>`;
    return;
  }

  container.innerHTML = visible
    .map((s) => {
      const typeLabel = (TYPES[s.category].find((t) => t.value === s.type) || {}).label || s.type;
      return `
      <div class="stop-card" data-id="${s.id}">
        <div class="row1">
          <span><span class="badge ${s.category}">${s.category === "activite" ? "Activité" : "Dodo"}</span>${escapeHtml(s.name)}</span>
        </div>
        <div class="meta">${typeLabel}${s.date ? " · " + s.date : ""}</div>
        ${s.rating ? `<div class="stars">${stars(s.rating)}</div>` : ""}
        ${s.notes ? `<div class="notes">${escapeHtml(s.notes)}</div>` : ""}
      </div>`;
    })
    .join("");

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

  document.getElementById("formTitle").textContent = editing ? "Modifier le point" : "Nouveau point";
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
    tempMarker = L.marker([coords.lat, coords.lng], { icon: makeIcon(fCategory.value, fType.value) }).addTo(map);
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
    stops.push({ id: uid(), createdAt: Date.now(), ...data });
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
  refreshAll();
}

// ---------- Add mode ----------

const addModeBtn = document.getElementById("addModeBtn");

function setAddMode(value) {
  addMode = value;
  document.body.classList.toggle("add-mode", addMode);
  addModeBtn.classList.toggle("active", addMode);
  addModeBtn.textContent = addMode ? "Cliquez sur la carte..." : "+ Ajouter un point sur la carte";
}

addModeBtn.addEventListener("click", () => setAddMode(!addMode));

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

// ---------- Route toggle ----------

const routeToggle = document.getElementById("routeToggle");
routeToggle.addEventListener("click", () => {
  showRoute = !showRoute;
  routeToggle.classList.toggle("active", showRoute);
  rebuildRoute();
});

// ---------- Seed examples ----------

document.getElementById("seedBtn").addEventListener("click", () => {
  if (!confirm("Ajouter quelques points d'exemple dans le Finistère ?")) return;
  SEED_STOPS.forEach((s) => stops.push({ id: uid(), createdAt: Date.now(), ...s }));
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

document.getElementById("importInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error("Format invalide");
      if (confirm(`Importer ${imported.length} point(s) ? Cela remplacera les données actuelles.`)) {
        stops = imported;
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
