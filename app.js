"use strict";

const STORAGE_KEY = "astroapp.mobile.preferences.v1";
const FIELD_STORAGE_KEY = "astroapp.mobile.field-kit.v1";
const ATLAS_DETAIL_URL = "./assets/light-pollution-atlas-2025-detail.bin";
const MAP_MAX_ZOOM = { world: 256, "north-america": 256 };
const MAP_TILE_CACHE_LIMIT = 32;
const TRACKER_DRIFT = { rough: 15, good: 5, excellent: 1 };
const DEFAULT_PACKING_ITEMS = [
  "Camera and lens", "Tripod / mount", "Star tracker", "Counterweights", "Intervalometer",
  "Memory cards", "Spare batteries", "Power bank", "Dew heater", "Red headlamp",
  "Filters", "Cables and adapters", "Finder / guide scope", "Warm layers",
];
const $ = (id) => document.getElementById(id);
const dom = {
  status: $("offlineStatus"), statusText: $("offlineStatusText"), toast: $("toast"),
  screens: [...document.querySelectorAll(".screen")], nav: [...document.querySelectorAll(".nav-button")],
  date: $("skyDate"), timeline: $("skyTimeline"), targets: $("skyTargets"),
  mapCanvas: $("pollutionMap"), frameCanvas: $("framingChart"),
};

const ZONES = [
  { id: "0", color: "#000000", name: "Pristine", lpi: "< 0.01", sqm: "22.00+" },
  { id: "1a", color: "#222222", name: "Excellent dark sky", lpi: "0.01–0.06", sqm: "21.99–21.93" },
  { id: "1b", color: "#424242", name: "Typical dark sky", lpi: "0.06–0.11", sqm: "21.93–21.89" },
  { id: "2a", color: "#142f72", name: "Rural sky", lpi: "0.11–0.19", sqm: "21.89–21.81" },
  { id: "2b", color: "#2154d8", name: "Rural sky", lpi: "0.19–0.33", sqm: "21.81–21.69" },
  { id: "3a", color: "#0f5714", name: "Rural / suburban", lpi: "0.33–0.58", sqm: "21.69–21.51" },
  { id: "3b", color: "#1fa12a", name: "Suburban sky", lpi: "0.58–1.00", sqm: "21.51–21.25" },
  { id: "4a", color: "#6e641e", name: "Suburban sky", lpi: "1.00–1.73", sqm: "21.25–20.91" },
  { id: "4b", color: "#b8a625", name: "Suburban / urban", lpi: "1.73–3.00", sqm: "20.91–20.49" },
  { id: "5a", color: "#bf641e", name: "Urban sky", lpi: "3.00–5.20", sqm: "20.49–20.02" },
  { id: "5b", color: "#fd9650", name: "Bright urban sky", lpi: "5.20–9.00", sqm: "20.02–19.50" },
  { id: "6a", color: "#fb5a49", name: "Bright urban sky", lpi: "9.00–15.59", sqm: "19.50–18.95" },
  { id: "6b", color: "#fb998a", name: "City sky", lpi: "15.59–27.00", sqm: "18.95–18.38" },
  { id: "7a", color: "#a0a0a0", name: "Inner-city sky", lpi: "27.00–46.77", sqm: "18.38–17.80" },
  { id: "7b", color: "#f2f2f2", name: "Bright inner-city", lpi: "> 46.77", sqm: "< 17.80" },
];

const state = {
  defaults: { cameras: [], lenses: [] },
  prefs: { site: { name: "Set observing site", lat: 0, lon: 0 }, cameras: [], lenses: [] },
  siteConfigured: false,
  targets: [], stars: [], cameraCatalog: [], lensCatalog: [], targetImages: {}, targetImageCache: {}, selectedTarget: null, night: null,
  framePreviewMode: "detail",
  mapArea: "world", mapZoom: 1, mapPanX: 0, mapPanY: 0, mapImage: null,
  mapTransform: null, mapPointers: new Map(), mapMoved: false, mapLast: null, mapPinch: null,
  mapAtlas: null, mapAtlasPromise: null, mapAtlasFailed: false, mapTiles: new Map(), mapSampleId: 0,
  fieldSession: { target: "", exposure: 60, lights: 0, darks: 0, flats: 0, bias: 0 },
  packingItems: DEFAULT_PACKING_ITEMS.map((name) => ({ name, checked: false })),
  mapPin: null, mapNeedsFocus: false, pendingMapFocus: null, offlineReady: false, toastTimer: 0,
};

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 2800);
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function loadPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!stored || typeof stored !== "object") return;
    if (stored.site && typeof stored.site.name === "string" &&
        finite(stored.site.lat, 91) >= -90 && finite(stored.site.lat, -91) <= 90 &&
        finite(stored.site.lon, 181) >= -180 && finite(stored.site.lon, -181) <= 180) {
      state.prefs.site = { name: stored.site.name.slice(0, 60), lat: Number(stored.site.lat), lon: Number(stored.site.lon) };
      state.siteConfigured = Boolean(stored.site.name.trim() && stored.site.name !== "Set observing site");
    }
    if (Array.isArray(stored.cameras)) state.prefs.cameras = stored.cameras.filter(validCamera).slice(0, 100);
    if (Array.isArray(stored.lenses)) state.prefs.lenses = stored.lenses.filter(validLens).slice(0, 100);
  } catch { /* Use bundled defaults when local storage is unavailable or malformed. */ }
}

function validCamera(item) {
  return item && typeof item.name === "string" && item.name.length <= 60 &&
    finite(item.sensor_width, 0) > 0 && finite(item.sensor_height, 0) > 0 && finite(item.pixel_size_um, 0) > 0;
}

function validLens(item) {
  return item && typeof item.name === "string" && item.name.length <= 60 &&
    finite(item.focal_length, 0) > 0 && finite(item.f_ratio, 0) > 0;
}

function savePreferences() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.prefs)); }
  catch { toast("This browser could not save changes. Check available iPhone storage."); }
}

function loadFieldKit() {
  try {
    const stored = JSON.parse(localStorage.getItem(FIELD_STORAGE_KEY) || "null");
    if (!stored || typeof stored !== "object") return;
    const session = stored.session;
    if (session && typeof session === "object") {
      state.fieldSession = {
        target: typeof session.target === "string" ? session.target.slice(0, 80) : "",
        exposure: clamp(finite(session.exposure, 60), 0.1, 86400),
        lights: clamp(Math.floor(finite(session.lights, 0)), 0, 1000000),
        darks: clamp(Math.floor(finite(session.darks, 0)), 0, 1000000),
        flats: clamp(Math.floor(finite(session.flats, 0)), 0, 1000000),
        bias: clamp(Math.floor(finite(session.bias, 0)), 0, 1000000),
      };
    }
    if (Array.isArray(stored.packingItems)) {
      state.packingItems = stored.packingItems.filter((item) => item && typeof item.name === "string" && item.name.trim())
        .slice(0, 100).map((item) => ({ name: item.name.trim().slice(0, 60), checked: Boolean(item.checked) }));
    }
  } catch { /* Use the default field kit when local storage is malformed. */ }
}

function saveFieldKit() {
  try {
    localStorage.setItem(FIELD_STORAGE_KEY, JSON.stringify({ session: state.fieldSession, packingItems: state.packingItems }));
  } catch { toast("This browser could not save the field kit. Check available iPhone storage."); }
}

function populateFieldGear() {
  const cameraSelect = $("fieldCamera"), lensSelect = $("fieldLens");
  const previousCamera = cameraSelect.value, previousLens = lensSelect.value;
  cameraSelect.replaceChildren(); lensSelect.replaceChildren();
  const cameraPrompt = document.createElement("option"); cameraPrompt.value = "";
  cameraPrompt.textContent = state.prefs.cameras.length ? "Choose camera" : "Add a camera in My Gear";
  cameraSelect.append(cameraPrompt);
  state.prefs.cameras.forEach((camera, index) => {
    const option = document.createElement("option"); option.value = String(index); option.textContent = camera.name; cameraSelect.append(option);
  });
  const lensPrompt = document.createElement("option"); lensPrompt.value = "";
  lensPrompt.textContent = state.prefs.lenses.length ? "Choose lens / scope" : "Add a lens in My Gear";
  lensSelect.append(lensPrompt);
  state.prefs.lenses.forEach((lens, index) => {
    const option = document.createElement("option"); option.value = String(index); option.textContent = lens.name; lensSelect.append(option);
  });
  if (previousCamera && state.prefs.cameras[Number(previousCamera)]) cameraSelect.value = previousCamera;
  else if (state.prefs.cameras.length) cameraSelect.value = "0";
  if (previousLens && state.prefs.lenses[Number(previousLens)]) lensSelect.value = previousLens;
  else if (state.prefs.lenses.length) lensSelect.value = "0";
  const lens = lensSelect.value === "" ? null : state.prefs.lenses[Number(lensSelect.value)];
  $("fieldFocal").value = lens ? lens.focal_length : "";
  $("fieldFNumber").value = lens ? lens.f_ratio : "";
  updateExposureGuide();
}

function formatExposure(seconds) {
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} h`;
  if (seconds >= 60) return `${(seconds / 60).toFixed(1)} min`;
  return `${seconds.toFixed(1)} s`;
}

function updateExposureGuide() {
  const cameraIndex = $("fieldCamera").value;
  const camera = cameraIndex === "" ? null : state.prefs.cameras[Number(cameraIndex)];
  const focal = finite($("fieldFocal").value, 0), fNumber = finite($("fieldFNumber").value, 0);
  if (!camera || focal <= 0 || fNumber <= 0) {
    $("fieldNpf").textContent = camera ? "Enter focal length and f-number" : "Add camera and optics in My Gear";
    $("field500").textContent = "—"; $("fieldTracked").textContent = "—"; $("fieldImageScale").textContent = "—";
    return;
  }
  const cropFactor = 36 / camera.sensor_width;
  const npf = (35 * fNumber + 30 * camera.pixel_size_um) / focal;
  const rule500 = 500 / (focal * cropFactor);
  const imageScale = (camera.pixel_size_um / focal) * 206.265;
  const quality = $("fieldAlignment").value || "good";
  const trackedSeconds = (1.5 * imageScale / TRACKER_DRIFT[quality]) * 60;
  $("fieldNpf").textContent = `${formatExposure(npf)} · start here`;
  $("field500").textContent = `${formatExposure(rule500)} · generous estimate`;
  $("fieldTracked").textContent = `${formatExposure(trackedSeconds)} max guide`;
  $("fieldImageScale").textContent = `${imageScale.toFixed(2)} arcsec / pixel`;
}

function renderFieldSession() {
  const session = state.fieldSession;
  $("sessionTarget").value = session.target;
  $("sessionExposure").value = String(session.exposure);
  $("sessionLights").value = String(session.lights);
  $("sessionDarks").value = String(session.darks);
  $("sessionFlats").value = String(session.flats);
  $("sessionBias").value = String(session.bias);
  updateFieldSession();
}

function formatIntegration(seconds) {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} min`;
  return `${Math.round(seconds)} sec`;
}

function updateFieldSession() {
  state.fieldSession.target = $("sessionTarget").value.trim().slice(0, 80);
  state.fieldSession.exposure = clamp(finite($("sessionExposure").value, 60), 0.1, 86400);
  $("sessionExposure").value = String(state.fieldSession.exposure);
  for (const [key, id] of [["lights", "sessionLights"], ["darks", "sessionDarks"], ["flats", "sessionFlats"], ["bias", "sessionBias"]]) {
    state.fieldSession[key] = clamp(Math.floor(finite($(id).value, 0)), 0, 1000000);
    $(id).value = String(state.fieldSession[key]);
  }
  const total = state.fieldSession.lights * state.fieldSession.exposure;
  $("sessionIntegration").textContent = formatIntegration(total);
  if (state.fieldSession.lights === 0) $("sessionReminder").textContent = "Counts and target are saved on this iPhone as you update them.";
  else {
    const missing = [["darks", state.fieldSession.darks], ["flats", state.fieldSession.flats], ["bias frames", state.fieldSession.bias]]
      .filter(([, count]) => count === 0).map(([name]) => name);
    $("sessionReminder").textContent = missing.length
      ? `Check whether your workflow needs ${missing.join(", ")}. This tracker keeps counts and integration time; it does not replace calibration planning.`
      : "Light and calibration counts are saved on this iPhone.";
  }
  saveFieldKit();
}

function updatePackingStatus() {
  const packed = state.packingItems.filter((item) => item.checked).length;
  $("packingStatus").textContent = `${packed} / ${state.packingItems.length}`;
}

function renderPackingList() {
  const root = $("packingChecklist"); root.replaceChildren();
  if (!state.packingItems.length) {
    const empty = document.createElement("p"); empty.className = "small-note"; empty.textContent = "Add the items you want to bring."; root.append(empty);
  }
  state.packingItems.forEach((item, index) => {
    const row = document.createElement("div"); row.className = `packing-item${item.checked ? " checked" : ""}`;
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = item.checked;
    check.setAttribute("aria-label", `${item.checked ? "Uncheck" : "Check"} ${item.name}`);
    check.addEventListener("change", () => {
      item.checked = check.checked; row.classList.toggle("checked", item.checked);
      check.setAttribute("aria-label", `${item.checked ? "Uncheck" : "Check"} ${item.name}`);
      updatePackingStatus(); saveFieldKit();
    });
    const label = document.createElement("span"); label.textContent = item.name;
    const remove = document.createElement("button"); remove.className = "packing-remove"; remove.type = "button";
    remove.textContent = "×"; remove.setAttribute("aria-label", `Remove ${item.name}`);
    remove.addEventListener("click", () => { state.packingItems.splice(index, 1); renderPackingList(); saveFieldKit(); });
    row.append(check, label, remove); root.append(row);
  });
  updatePackingStatus();
}

function addPackingItem() {
  const input = $("newPackingItem"), name = input.value.trim().slice(0, 60);
  if (!name) return;
  if (state.packingItems.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    toast("That item is already on the list."); return;
  }
  if (state.packingItems.length >= 100) { toast("The packing list is full."); return; }
  state.packingItems.push({ name, checked: false }); input.value = "";
  renderPackingList(); saveFieldKit();
}

function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
function radians(degrees) { return degrees * Math.PI / 180; }
function degrees(radiansValue) { return radiansValue * 180 / Math.PI; }
function norm360(value) { return ((value % 360) + 360) % 360; }

function julianDate(date) { return date.getTime() / 86400000 + 2440587.5; }

function localSiderealDegrees(date, longitude) {
  const d = julianDate(date) - 2451545;
  return norm360(280.46061837 + 360.98564736629 * d + longitude);
}

function altitude(raDeg, decDeg, date, latitude, longitude) {
  const ha = radians(norm360(localSiderealDegrees(date, longitude) - raDeg));
  const dec = radians(decDeg), lat = radians(latitude);
  return degrees(Math.asin(clamp(Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha), -1, 1)));
}

function sunLongitude(jd) {
  const t = (jd - 2451545) / 36525;
  const l0 = 280.46646 + 36000.76983 * t + .0003032 * t * t;
  const m = radians(357.52911 + 35999.05029 * t - .0001537 * t * t);
  const c = (1.914602 - .004817 * t) * Math.sin(m) + .019993 * Math.sin(2 * m) + .000289 * Math.sin(3 * m);
  return l0 + c;
}

function moonEcliptic(jd) {
  const t = (jd - 2451545) / 36525;
  const lp = 218.3164477 + 481267.88123421 * t;
  const d = radians(297.8501921 + 445267.1114034 * t);
  const m = radians(357.5291092 + 35999.0502909 * t);
  const mp = radians(134.9633964 + 477198.8675055 * t);
  const f = radians(93.272095 + 483202.0175233 * t);
  const lon = lp + 6.288774 * Math.sin(mp) + 1.274027 * Math.sin(2 * d - mp) + .658314 * Math.sin(2 * d) + .213618 * Math.sin(2 * mp) - .185116 * Math.sin(m) - .114332 * Math.sin(2 * f);
  const lat = 5.128122 * Math.sin(f) + .280602 * Math.sin(mp + f) + .277693 * Math.sin(mp - f) + .173237 * Math.sin(2 * d - f) + .055413 * Math.sin(2 * d - mp + f) + .046271 * Math.sin(2 * d - mp - f);
  return [lon, lat];
}

function eclipticToEquatorial(lonDeg, latDeg = 0) {
  const lon = radians(lonDeg), lat = radians(latDeg), eps = radians(23.4393);
  const ra = Math.atan2(Math.sin(lon) * Math.cos(eps) - Math.tan(lat) * Math.sin(eps), Math.cos(lon));
  const dec = Math.asin(Math.sin(lat) * Math.cos(eps) + Math.cos(lat) * Math.sin(eps) * Math.sin(lon));
  return [norm360(degrees(ra)), degrees(dec)];
}

function sunAlt(date, site = state.prefs.site) {
  const [ra, dec] = eclipticToEquatorial(sunLongitude(julianDate(date)));
  return altitude(ra, dec, date, site.lat, site.lon);
}

function moonAlt(date, site = state.prefs.site) {
  const { ra, dec } = moonEquatorial(date);
  return altitude(ra, dec, date, site.lat, site.lon);
}

function moonEquatorial(date) {
  const [lon, lat] = moonEcliptic(julianDate(date));
  const [ra, dec] = eclipticToEquatorial(lon, lat);
  return { ra, dec };
}

function moonPhase(date) {
  const jd = julianDate(date), t = (jd - 2451545) / 36525;
  const elongation = norm360((218.3164477 + 481267.88123421 * t +
    6.288774 * Math.sin(radians(134.9633964 + 477198.8675055 * t)) +
    1.274027 * Math.sin(radians(2 * (297.8501921 + 445267.1114034 * t) - (134.9633964 + 477198.8675055 * t))) -
    .185116 * Math.sin(radians(357.5291092 + 35999.0502909 * t))) - sunLongitude(jd));
  const illumination = (1 - Math.cos(radians(elongation))) / 2;
  const names = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
  const index = Math.floor((elongation + 22.5) / 45) % 8;
  return { illumination, name: names[index], waxing: elongation < 180 };
}

function dateAtLocalNoon(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function crossingTime(start, end, fn, level, rising) {
  const step = 5 * 60000;
  let previousDate = start;
  let previous = fn(previousDate) - level;
  for (let ms = start.getTime() + step; ms <= end.getTime(); ms += step) {
    const currentDate = new Date(Math.min(ms, end.getTime()));
    const current = fn(currentDate) - level;
    const crossed = rising ? previous < 0 && current >= 0 : previous >= 0 && current < 0;
    if (crossed && current !== previous) {
      const fraction = clamp(previous / (previous - current), 0, 1);
      return new Date(previousDate.getTime() + (currentDate.getTime() - previousDate.getTime()) * fraction);
    }
    previousDate = currentDate;
    previous = current;
  }
  return null;
}

function findNight(dateText) {
  const noon = dateAtLocalNoon(dateText);
  const end = new Date(noon.getTime() + 30 * 3600000);
  const sunset = crossingTime(noon, end, sunAlt, -.833, false);
  const searchStart = sunset || new Date(noon.getTime() + 7 * 3600000);
  const sunrise = crossingTime(searchStart, end, sunAlt, -.833, true);
  const darkStart = sunset ? crossingTime(sunset, sunrise || end, sunAlt, -18, false) : null;
  const darkEnd = darkStart ? crossingTime(darkStart, sunrise || end, sunAlt, -18, true) : null;
  const nightStart = sunset || new Date(noon.getTime() + 6 * 3600000);
  const nightEnd = sunrise || new Date(nightStart.getTime() + 12 * 3600000);
  const moonrise = crossingTime(nightStart, nightEnd, moonAlt, .125, true);
  const moonset = crossingTime(nightStart, nightEnd, moonAlt, .125, false);
  return { noon, sunset, sunrise, darkStart, darkEnd, nightStart, nightEnd, moonrise, moonset, end };
}

function moonFreeDarkWindows(night) {
  if (!night?.darkStart || !night?.darkEnd || night.darkEnd <= night.darkStart) return [];
  const start = night.darkStart, end = night.darkEnd, step = 5 * 60000, horizon = .125;
  const windows = [];
  let previousTime = start, previousAltitude = moonAlt(start), inside = previousAltitude <= horizon;
  let windowStart = inside ? start : null;
  for (let ms = start.getTime() + step; ms <= end.getTime() + step; ms += step) {
    const currentTime = new Date(Math.min(ms, end.getTime()));
    const currentAltitude = moonAlt(currentTime), currentInside = currentAltitude <= horizon;
    if (currentInside !== inside) {
      const fraction = clamp((horizon - previousAltitude) / (currentAltitude - previousAltitude), 0, 1);
      const boundary = new Date(previousTime.getTime() + (currentTime.getTime() - previousTime.getTime()) * fraction);
      if (inside && windowStart) windows.push({ start: windowStart, end: boundary });
      else windowStart = boundary;
      inside = currentInside;
    }
    previousTime = currentTime;
    previousAltitude = currentAltitude;
    if (currentTime >= end) break;
  }
  if (inside && windowStart) windows.push({ start: windowStart, end });
  return windows.filter((window) => window.end - window.start >= 10 * 60000);
}

function moonFreeDarkLabel(night) {
  if (!night?.darkStart || !night?.darkEnd) return "No full dark";
  const windows = moonFreeDarkWindows(night);
  if (!windows.length) return "None tonight";
  return windows.map((window) => `${timeLabel(window.start)}–${timeLabel(window.end)}`).join(" · ");
}

function timeLabel(date) {
  return date ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Not today";
}

function dateLabel(date) {
  return date ? date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
}

function formatCoords(lat, lon) { return `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(2)}°${lon < 0 ? "W" : "E"}`; }

function updateSiteLabels() {
  const site = state.prefs.site;
  $("skySiteName").textContent = state.siteConfigured ? site.name : "Set observing site";
  $("skyCoordinates").textContent = state.siteConfigured ? `· ${formatCoords(site.lat, site.lon)}` : "";
  $("siteNameInput").value = state.siteConfigured ? site.name : "";
  $("siteLatInput").value = state.siteConfigured ? Number(site.lat).toFixed(4) : "";
  $("siteLonInput").value = state.siteConfigured ? Number(site.lon).toFixed(4) : "";
}

function localDateISO(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function setEventGrid(items) {
  const grid = $("skyEvents");
  grid.replaceChildren();
  for (const [label, value] of items) {
    const event = document.createElement("div"); event.className = "event";
    const small = document.createElement("span"); small.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = value;
    event.append(small, strong); grid.append(event);
  }
}

function drawTimeline() {
  const canvas = dom.timeline;
  if (!canvas || !state.night) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(104 * dpr);
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = 104, night = state.night;
  const start = night.sunset || night.nightStart, end = night.sunrise || night.nightEnd;
  const span = Math.max(end - start, 1);
  const xFor = (date) => clamp(((date - start) / span) * w, 0, w);
  ctx.clearRect(0, 0, w, h);
  const segments = 72;
  for (let i = 0; i < segments; i++) {
    const a = new Date(start.getTime() + span * i / segments);
    const mid = new Date(start.getTime() + span * (i + .5) / segments);
    const alt = sunAlt(mid);
    ctx.fillStyle = alt > -.833 ? "#40394a" : alt > -6 ? "#454065" : alt > -12 ? "#313657" : alt > -18 ? "#26344e" : "#1b3347";
    ctx.fillRect(w * i / segments, 15, w / segments + 1, 60);
  }
  ctx.fillStyle = "rgba(128,224,210,.26)";
  for (const window of moonFreeDarkWindows(night)) ctx.fillRect(xFor(window.start), 15, Math.max(1, xFor(window.end) - xFor(window.start)), 60);
  ctx.fillStyle = "rgba(247,215,139,.13)";
  for (let i = 0; i < segments; i++) {
    const mid = new Date(start.getTime() + span * (i + .5) / segments);
    if (moonAlt(mid) > .125) ctx.fillRect(w * i / segments, 15, w / segments + 1, 60);
  }
  ctx.beginPath(); ctx.strokeStyle = "#f7d78b"; ctx.lineWidth = 2;
  for (let i = 0; i <= 50; i++) {
    const date = new Date(start.getTime() + span * i / 50);
    const alt = moonAlt(date);
    const x = w * i / 50, y = 68 - clamp((alt + 5) / 90, 0, 1) * 44;
    if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(235,244,247,.22)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 76); ctx.lineTo(w, 76); ctx.stroke();
  ctx.fillStyle = "#b6c7d0"; ctx.font = "10px -apple-system, sans-serif"; ctx.textAlign = "left";
  ctx.fillText(timeLabel(start), 1, 96); ctx.textAlign = "right"; ctx.fillText(timeLabel(end), w - 1, 96);
  for (const event of [night.sunset, night.darkStart, night.darkEnd, night.sunrise]) {
    if (!event) continue;
    const x = xFor(event); ctx.strokeStyle = "rgba(235,244,247,.35)"; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(x, 9); ctx.lineTo(x, 79); ctx.stroke(); ctx.setLineDash([]);
  }
}

function targetAlt(ra, dec, sample) {
  const ha = radians(norm360(sample.lst - ra));
  const d = radians(dec), lat = radians(state.prefs.site.lat);
  return degrees(Math.asin(clamp(Math.sin(d) * Math.sin(lat) + Math.cos(d) * Math.cos(lat) * Math.cos(ha), -1, 1)));
}

function frameSetup() {
  const cameraValue = $("frameCamera").value, lensValue = $("frameLens").value;
  const camera = cameraValue === "" ? null : state.prefs.cameras[Number(cameraValue)] || null;
  const lens = lensValue === "" ? null : state.prefs.lenses[Number(lensValue)] || null;
  const focal = finite($("frameFocal").value, lens?.focal_length || 0);
  return camera && focal > 0 ? { camera, lens, focal,
    fovX: fieldOfView(camera.sensor_width, focal), fovY: fieldOfView(camera.sensor_height, focal) } : null;
}

function targetFit(target, setup) {
  if (!setup) return { score: .5, reason: "Add your camera and lens for a gear fit estimate." };
  const width = Math.max(.01, finite(target.size_deg?.[0], .2));
  const height = Math.max(.01, finite(target.size_deg?.[1], .2));
  const x = width / setup.fovX, y = height / setup.fovY;
  const fill = Math.max(.005, Math.max(x, y));
  const idealScore = clamp(1 - Math.abs(Math.log(fill / .42)) / Math.log(5), 0, 1);
  const cropped = x > .92 || y > .92;
  const percent = Math.round(Math.max(x, y) * 100);
  const reason = cropped ? "too large for the full target to fit" : percent < 7
    ? `wide framing; the target spans about ${percent}% of the frame's long side`
    : `fits with about ${percent}% of the frame's long side covered`;
  const quality = cropped ? "Tight frame" : idealScore >= .7 ? "Good fit" : idealScore >= .4 ? "Fair fit" : "Wide view";
  return { score: cropped ? idealScore * .25 : idealScore, reason, quality, cropped, x, y };
}

function angularSeparation(raA, decA, raB, decB) {
  const a = radians(decA), b = radians(decB);
  return degrees(Math.acos(clamp(Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(radians(raA - raB)), -1, 1)));
}

function renderTargets(dateText) {
  const lists = [dom.targets, $("framingTargets")];
  lists.forEach((list) => list.replaceChildren());
  if (!state.targets.length) return;
  if (!state.siteConfigured) {
    $("targetCount").textContent = "Set a site";
    $("framingTargetCount").textContent = "Set a site";
    $("recommendationContext").textContent = "Set your observing location to match target visibility to tonight.";
    $("framingRecommendationContext").textContent = $("recommendationContext").textContent;
    const p = document.createElement("p"); p.className = "small-note";
    p.textContent = "Add your observing site in My Gear to see targets for local darkness.";
    lists.forEach((list) => list.append(p.cloneNode(true))); return;
  }
  if (!state.night) return;
  const night = state.night;
  const begin = night.sunset || night.nightStart;
  const finish = night.sunrise || night.nightEnd;
  const samples = [];
  for (let i = 0; i <= 72; i++) {
    const date = new Date(begin.getTime() + (finish - begin) * i / 72);
    const sun = sunAlt(date), moon = moonAlt(date);
    samples.push({ date, lst: localSiderealDegrees(date, state.prefs.site.lon), moon: moonEquatorial(date), dark: sun <= -18, moonFree: moon <= .125, sunDark: sun <= -.833 });
  }
  const phase = moonPhase(dateAtLocalNoon(dateText));
  const setup = frameSetup();
  const setupText = setup ? `${setup.camera.name} · ${setup.lens?.name || `${setup.focal} mm`} at ${setup.focal} mm` : "Add your camera and optic in My Gear for gear-matched picks";
  $("recommendationContext").textContent = `${setupText} · ${phase.name}, ${Math.round(phase.illumination * 100)}% illuminated`;
  $("framingRecommendationContext").textContent = $("recommendationContext").textContent;
  const ranked = state.targets.map((target) => {
    const vals = samples.map((sample) => ({ sample, alt: targetAlt(target.ra, target.dec, sample) }));
    const dark = vals.filter((item) => item.sample.dark);
    const moonless = dark.filter((item) => item.sample.moonFree);
    const considered = moonless.length ? moonless : dark.length ? dark : vals.filter((item) => item.sample.sunDark);
    const fit = targetFit(target, setup);
    const scored = considered.map((item) => {
      const moon = item.sample.moon;
      const separation = angularSeparation(target.ra, target.dec, moon.ra, moon.dec);
      const moonPenalty = item.sample.moonFree ? 0 : phase.illumination * clamp(1 - separation / 105, 0, 1);
      const altitudeScore = clamp((item.alt - 10) / 75, 0, 1);
      const moonScore = item.sample.moonFree ? 1 : 1 - moonPenalty;
      const score = setup ? fit.score * .50 + altitudeScore * .28 + moonScore * .22 : altitudeScore * .65 + moonScore * .35;
      return { ...item, separation, score };
    });
    const best = scored.reduce((a, b) => b.score > a.score ? b : a, { score: -1, alt: -90, sample: samples[0], separation: 0 });
    return { ...target, bestAlt: best.alt, bestAt: best.sample.date, darkMoonless: best.sample.moonFree,
      moonSeparation: best.separation, fitReason: fit.reason, fitQuality: fit.quality, fitScore: fit.score, score: best.score };
  }).filter((target) => target.bestAlt >= 12).sort((a, b) => b.score - a.score).slice(0, 8);
  $("targetCount").textContent = `${ranked.length} picks`;
  $("framingTargetCount").textContent = `${ranked.length} picks`;
  if (!ranked.length) {
    const p = document.createElement("p"); p.className = "small-note"; p.textContent = "No catalog targets rise high enough during darkness at this site tonight.";
    lists.forEach((list) => list.append(p.cloneNode(true))); return;
  }
  for (const target of ranked) {
    const row = document.createElement("button"); row.type = "button"; row.className = "target-row"; row.dataset.target = target.name;
    const info = document.createElement("div");
    const title = document.createElement("h3"); title.textContent = target.name;
    const sub = document.createElement("p");
    const moonReason = target.darkMoonless ? "Moon below horizon" : `Moon ${Math.round(target.moonSeparation)}° away`;
    sub.textContent = `${target.type} · ${target.fitReason} · ${moonReason} · ${Math.round(target.bestAlt)}° high near ${timeLabel(target.bestAt)}`;
    info.append(title, sub);
    const score = document.createElement("div"); score.className = "target-score";
    const altitudeText = document.createElement("strong"); altitudeText.textContent = `${Math.round(target.bestAlt)}° high`;
    const condition = document.createElement("span"); condition.textContent = setup ? target.fitQuality : target.darkMoonless ? "Moon-free" : "Moon up";
    score.append(altitudeText, condition); row.append(info, score);
    lists.forEach((list, index) => list.append(index ? row.cloneNode(true) : row));
  }
}

function renderSky() {
  const dateText = dom.date.value || localDateISO();
  state.night = state.siteConfigured ? findNight(dateText) : null;
  const phase = moonPhase(dateAtLocalNoon(dateText));
  $("moonPhase").textContent = phase.name;
  $("moonPercent").textContent = `${Math.round(phase.illumination * 100)}% illuminated`;
  const orb = $("moonOrb");
  orb.classList.toggle("waxing", phase.waxing); orb.classList.toggle("waning", !phase.waxing);
  orb.style.setProperty("--moon-shadow", `${phase.illumination * 100}%`);
  $("moonAdvice").textContent = phase.illumination < .2 ? "A dim Moon leaves more contrast for faint targets." : phase.illumination < .55 ? "The Moon adds some glow; try targets away from it." : "Bright moonlight favors star clusters and narrowband targets.";
  const night = state.night;
  const hasSite = state.siteConfigured;
  $("darkWindow").textContent = !hasSite ? "Set a site" : moonFreeDarkLabel(night);
  $("timelineDate").textContent = !hasSite ? "Local times need a site"
    : night.sunset ? `${dateLabel(night.sunset)} · local time` : "Local night timeline";
  $("skyLocationPrompt").hidden = hasSite;
  dom.timeline.hidden = !hasSite;
  $("timelineLegend").hidden = !hasSite;
  $("skyEvents").hidden = !hasSite;
  if (hasSite) setEventGrid([
    ["Sunset", timeLabel(night.sunset)], ["Astronomical dusk", timeLabel(night.darkStart)],
    ["Moonrise", timeLabel(night.moonrise)], ["Moonset", timeLabel(night.moonset)],
    ["Astronomical dawn", timeLabel(night.darkEnd)], ["Sunrise", timeLabel(night.sunrise)],
  ]);
  else setEventGrid([]);
  drawTimeline(); renderTargets(dateText);
}

function localImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}

function mapBounds(area) {
  return area === "north-america" ? { lonMin: -180, lonMax: -51, latMin: 7, latMax: 75 } : { lonMin: -180, lonMax: 180, latMin: -65, latMax: 75 };
}

function mapSourcePoint(lat, lon, area = state.mapArea) {
  const bounds = mapBounds(area);
  return { x: (lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin) * state.mapImage.width,
    y: (bounds.latMax - lat) / (bounds.latMax - bounds.latMin) * state.mapImage.height };
}

function mapMaxZoom() { return MAP_MAX_ZOOM[state.mapArea] || 64; }

function mapDetailLevel() {
  if (state.mapZoom <= 8) return null;
  if (state.mapZoom >= 32) return 0;
  if (state.mapZoom >= 16) return 1;
  return 2;
}

async function loadAtlasImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not decode atlas tile."));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

async function loadAtlasBundle() {
  if (state.mapAtlas) return state.mapAtlas;
  if (!state.mapAtlasPromise) {
    state.mapAtlasPromise = fetch(ATLAS_DETAIL_URL).then(async (response) => {
      if (!response.ok) throw new Error("High-resolution atlas bundle is unavailable.");
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer), view = new DataView(buffer);
      if (bytes.length < 8 || String.fromCharCode(...bytes.slice(0, 4)) !== "AATP") throw new Error("Invalid atlas bundle.");
      const headerLength = view.getUint32(4, true), headerEnd = 8 + headerLength;
      if (headerEnd > bytes.length) throw new Error("Incomplete atlas bundle.");
      const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, headerEnd)));
      state.mapAtlas = { buffer, payloadOffset: headerEnd, header };
      return state.mapAtlas;
    }).catch((error) => { state.mapAtlasPromise = null; throw error; });
  }
  return state.mapAtlasPromise;
}

function atlasTile(layer, level, tileX, tileY) {
  const key = `${layer}:${level}:${tileX}:${tileY}`;
  let tile = state.mapTiles.get(key);
  if (tile) {
    state.mapTiles.delete(key); state.mapTiles.set(key, tile);
    return tile;
  }
  tile = { image: null, promise: null };
  state.mapTiles.set(key, tile);
  tile.promise = loadAtlasBundle().then(async (bundle) => {
    const entry = bundle.header.tiles[layer]?.[`${level}/${tileX}/${tileY}`];
    if (!entry) throw new Error("Atlas tile is missing.");
    const start = bundle.payloadOffset + entry.offset;
    const blob = new Blob([bundle.buffer.slice(start, start + entry.length)], { type: "image/png" });
    tile.image = await loadAtlasImage(blob);
    tile.promise = null;
    trimAtlasTileCache();
    renderMap();
    return tile.image;
  }).catch((error) => {
    state.mapTiles.delete(key);
    state.mapAtlasFailed = true;
    $("mapHint").textContent = "Map detail unavailable · reopen online to refresh";
    console.warn(error);
    return null;
  });
  return tile;
}

function trimAtlasTileCache() {
  if (state.mapTiles.size <= MAP_TILE_CACHE_LIMIT) return;
  for (const [key, tile] of state.mapTiles) {
    if (!tile.promise) {
      state.mapTiles.delete(key);
      if (state.mapTiles.size <= MAP_TILE_CACHE_LIMIT) break;
    }
  }
}

function drawAtlasDetail(ctx, transform) {
  const level = mapDetailLevel();
  if (level === null) return;
  if (!state.mapAtlas) {
    if (!state.mapAtlasFailed) loadAtlasBundle().then(() => renderMap()).catch(() => {
      state.mapAtlasFailed = true;
      $("mapHint").textContent = "Map detail unavailable · reopen online to refresh";
    });
    return;
  }
  const meta = state.mapAtlas.header.layers[`${state.mapArea}-display`];
  const levelScale = 2 ** level;
  const levelWidth = Math.ceil(meta.width / levelScale), levelHeight = Math.ceil(meta.height / levelScale);
  const tileSize = state.mapAtlas.header.tileSize;
  const rawLeft = (0 - transform.x) / transform.scale / state.mapImage.width * levelWidth;
  const rawTop = (0 - transform.y) / transform.scale / state.mapImage.height * levelHeight;
  const rawRight = (transform.w - transform.x) / transform.scale / state.mapImage.width * levelWidth;
  const rawBottom = (transform.h - transform.y) / transform.scale / state.mapImage.height * levelHeight;
  if (rawRight <= 0 || rawBottom <= 0 || rawLeft >= levelWidth || rawTop >= levelHeight) return;
  const sourceLeft = Math.max(0, rawLeft), sourceTop = Math.max(0, rawTop);
  const sourceRight = Math.min(levelWidth, rawRight), sourceBottom = Math.min(levelHeight, rawBottom);
  const minTileX = Math.max(0, Math.floor(sourceLeft / tileSize)), minTileY = Math.max(0, Math.floor(sourceTop / tileSize));
  const maxTileX = Math.min(Math.ceil(levelWidth / tileSize) - 1, Math.floor(Math.max(0, sourceRight - 1) / tileSize));
  const maxTileY = Math.min(Math.ceil(levelHeight / tileSize) - 1, Math.floor(Math.max(0, sourceBottom - 1) / tileSize));
  for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
      const tile = atlasTile(`${state.mapArea}-display`, level, tileX, tileY);
      if (!tile.image) continue;
      const x = transform.x + tileX * tileSize * state.mapImage.width / levelWidth * transform.scale;
      const y = transform.y + tileY * tileSize * state.mapImage.height / levelHeight * transform.scale;
      const width = tile.image.naturalWidth * state.mapImage.width / levelWidth * transform.scale;
      const height = tile.image.naturalHeight * state.mapImage.height / levelHeight * transform.scale;
      ctx.drawImage(tile.image, x, y, width, height);
    }
  }
}

function formatMapDistance(km) {
  if (km >= 1000) return `${Math.round(km).toLocaleString()} km`;
  if (km >= 10) return `${Math.round(km)} km`;
  if (km >= 1) return `${km.toFixed(1)} km`;
  return `${Math.round(km * 1000)} m`;
}

function updateMapScale(transform) {
  const bounds = mapBounds(state.mapArea);
  const centerSourceY = (transform.h / 2 - transform.y) / transform.scale;
  const centerLat = clamp(bounds.latMax - centerSourceY / state.mapImage.height * (bounds.latMax - bounds.latMin), bounds.latMin, bounds.latMax);
  const kmPerPixel = (bounds.lonMax - bounds.lonMin) * 111.32 * Math.cos(centerLat * Math.PI / 180) /
    state.mapImage.width / transform.scale;
  const targetKm = Math.max(0.001, kmPerPixel * transform.w * 0.24);
  const power = 10 ** Math.floor(Math.log10(targetKm));
  const scaleKm = [5, 2, 1].map((factor) => factor * power).find((value) => value <= targetKm) || power;
  $("mapScaleText").textContent = `~${formatMapDistance(scaleKm)}`;
  $("mapZoomText").textContent = `${state.mapZoom.toFixed(state.mapZoom < 10 ? 1 : 0)}×`;
  $("mapScaleBar").style.width = `${Math.min(transform.w * 0.55, Math.max(1, scaleKm / kmPerPixel))}px`;
  $("mapZoomIn").disabled = state.mapZoom >= mapMaxZoom();
  $("mapZoomOut").disabled = state.mapZoom <= 1;
}

function resizeMapCanvas() {
  const rect = dom.mapCanvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
  if (dom.mapCanvas.width !== width || dom.mapCanvas.height !== height) { dom.mapCanvas.width = width; dom.mapCanvas.height = height; }
  renderMap();
}

function renderMap(showPin = true) {
  const canvas = dom.mapCanvas, image = state.mapImage;
  if (!canvas || !image) return;
  const rect = canvas.getBoundingClientRect(), dpr = canvas.width / Math.max(rect.width, 1);
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height;
  ctx.fillStyle = "#050c12"; ctx.fillRect(0, 0, w, h);
  const fit = Math.min(w / image.width, h / image.height);
  const scale = fit * state.mapZoom;
  const x = (w - image.width * fit) / 2 + state.mapPanX + (image.width * fit - image.width * scale) / 2;
  const y = (h - image.height * fit) / 2 + state.mapPanY + (image.height * fit - image.height * scale) / 2;
  const drawW = image.width * scale, drawH = image.height * scale;
  ctx.drawImage(image, x, y, drawW, drawH);
  state.mapTransform = { x, y, scale, dpr, w, h };
  drawAtlasDetail(ctx, state.mapTransform);
  updateMapScale(state.mapTransform);
  const pin = showPin ? (state.mapPin || (state.siteConfigured ? state.prefs.site : null)) : null;
  const pinBounds = mapBounds(state.mapArea);
  if (pin && pin.lat >= pinBounds.latMin && pin.lat <= pinBounds.latMax && pin.lon >= pinBounds.lonMin && pin.lon <= pinBounds.lonMax) {
    const src = mapSourcePoint(pin.lat, pin.lon);
    const px = x + src.x * scale, py = y + src.y * scale;
    if (px >= 0 && px <= w && py >= 0 && py <= h) {
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fillStyle = "#ffdf8d"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#08131f"; ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 15, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,223,141,.8)"; ctx.lineWidth = 1; ctx.stroke();
    }
  }
}

function setMapArea(area, focusSite = true) {
  state.mapSampleId++;
  if (!(["world", "north-america"].includes(area))) return;
  state.mapArea = area;
  $("mapWorld").classList.toggle("active", area === "world");
  $("mapNorthAmerica").classList.toggle("active", area === "north-america");
  const imageUrl = area === "world" ? "./assets/world-atlas-2025.png" : "./assets/north-america-atlas-2025.png";
  localImage(imageUrl).then((image) => {
    state.mapImage = image; state.mapZoom = area === "world" ? 1 : 1;
    state.mapPanX = 0; state.mapPanY = 0;
    const pending = state.pendingMapFocus;
    if (pending) { state.pendingMapFocus = null; focusMapOn(pending.lat, pending.lon, pending.zoom); }
    else if (focusSite && state.siteConfigured) {
      const site = state.prefs.site;
      const zoom = area === "north-america" ? 1.2 : 1.5;
      if (dom.mapCanvas.getBoundingClientRect().width > 0) focusMapOn(site.lat, site.lon, zoom);
      else { state.mapNeedsFocus = true; resizeMapCanvas(); }
    } else resizeMapCanvas();
  }).catch(() => { $("mapHint").textContent = "Map file could not be loaded"; });
}

function focusMapOn(lat, lon, zoom = state.mapZoom) {
  if (!state.mapImage) return;
  const bounds = mapBounds(state.mapArea);
  if (lat < bounds.latMin || lat > bounds.latMax || lon < bounds.lonMin || lon > bounds.lonMax) {
    toast("This location is outside the selected map. Switching to the world map.");
    state.pendingMapFocus = { lat, lon, zoom: 1.6 };
    setMapArea("world", false); return;
  }
  const canvas = dom.mapCanvas, rect = canvas.getBoundingClientRect(), fit = Math.min(rect.width / state.mapImage.width, rect.height / state.mapImage.height);
  if (rect.width < 2 || rect.height < 2) { state.mapNeedsFocus = true; return; }
  state.mapNeedsFocus = false;
  state.mapZoom = clamp(zoom, 1, mapMaxZoom());
  const scale = fit * state.mapZoom;
  const baseX = (rect.width - state.mapImage.width * fit) / 2 + (state.mapImage.width * fit - state.mapImage.width * scale) / 2;
  const baseY = (rect.height - state.mapImage.height * fit) / 2 + (state.mapImage.height * fit - state.mapImage.height * scale) / 2;
  const src = mapSourcePoint(lat, lon);
  state.mapPanX = rect.width / 2 - (baseX + src.x * scale);
  state.mapPanY = rect.height / 2 - (baseY + src.y * scale);
  resizeMapCanvas();
}

function changeMapZoom(nextZoom, anchorX = null, anchorY = null) {
  if (!state.mapImage || !state.mapTransform) return;
  const canvas = dom.mapCanvas, rect = canvas.getBoundingClientRect();
  const anchor = { x: anchorX ?? rect.width / 2, y: anchorY ?? rect.height / 2 };
  const old = state.mapTransform;
  const srcX = (anchor.x - old.x) / old.scale, srcY = (anchor.y - old.y) / old.scale;
  const fit = Math.min(rect.width / state.mapImage.width, rect.height / state.mapImage.height);
  state.mapZoom = clamp(nextZoom, 1, mapMaxZoom());
  const scale = fit * state.mapZoom;
  const baseX = (rect.width - state.mapImage.width * fit) / 2 + (state.mapImage.width * fit - state.mapImage.width * scale) / 2;
  const baseY = (rect.height - state.mapImage.height * fit) / 2 + (state.mapImage.height * fit - state.mapImage.height * scale) / 2;
  state.mapPanX = anchor.x - (baseX + srcX * scale);
  state.mapPanY = anchor.y - (baseY + srcY * scale);
  resizeMapCanvas();
}

function nearestZone(rgba) {
  let winner = ZONES[0], best = Infinity;
  const r = rgba[0], g = rgba[1], b = rgba[2];
  for (const zone of ZONES) {
    const color = zone.color.slice(1);
    const zr = parseInt(color.slice(0, 2), 16), zg = parseInt(color.slice(2, 4), 16), zb = parseInt(color.slice(4, 6), 16);
    const score = (r - zr) ** 2 + (g - zg) ** 2 + (b - zb) ** 2;
    if (score < best) { best = score; winner = zone; }
  }
  return winner;
}

async function sampleAtlasCell(lat, lon, area = state.mapArea) {
  const bundle = await loadAtlasBundle(), bounds = mapBounds(area);
  const meta = bundle.header.layers[`${area}-data`], tileSize = bundle.header.tileSize;
  const pixelX = clamp(Math.floor((lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin) * meta.width), 0, meta.width - 1);
  const pixelY = clamp(Math.floor((bounds.latMax - lat) / (bounds.latMax - bounds.latMin) * meta.height), 0, meta.height - 1);
  const tile = atlasTile(`${area}-data`, 0, Math.floor(pixelX / tileSize), Math.floor(pixelY / tileSize));
  const image = tile.image || await tile.promise;
  if (!image) throw new Error("The detailed atlas reading could not be loaded.");
  const sample = document.createElement("canvas"); sample.width = 1; sample.height = 1;
  const context = sample.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, pixelX % tileSize, pixelY % tileSize, 1, 1, 0, 0, 1, 1);
  return context.getImageData(0, 0, 1, 1).data;
}

function mapGridSpacing(area, latitude) {
  const kmPerCellNorthSouth = 111.32 / (area === "north-america" ? 120 : 40);
  const kmPerCellEastWest = kmPerCellNorthSouth * Math.cos(latitude * Math.PI / 180);
  return `Atlas grid spacing here: about ${kmPerCellNorthSouth.toFixed(1)} × ${kmPerCellEastWest.toFixed(1)} km`;
}

function updateMapReading(lat, lon, color) {
  const zone = nearestZone(color);
  state.mapPin = { lat, lon };
  $("readingZone").textContent = `Zone ${zone.id} · ${zone.name}`;
  $("readingCoordinates").textContent = `Tapped ${formatCoords(lat, lon)}`;
  $("readingGrid").textContent = mapGridSpacing(state.mapArea, lat);
  $("readingBrightness").textContent = `${zone.lpi} LPI · about ${zone.sqm} mag/arcsec²`;
  $("readingSwatch").style.background = zone.color;
  $("readingExplanation").textContent = state.mapArea === "north-america"
    ? "2025 satellite-based model estimate at zenith, sampled from the 1/120° North America atlas. Grid spacing is not prediction accuracy; local lighting and terrain can differ. Not a Bortle score or field measurement."
    : "2025 satellite-based model estimate at zenith, sampled from the 1/40° world atlas. Grid spacing is not prediction accuracy; local lighting and terrain can differ. Not a Bortle score or field measurement.";
  $("saveMapPin").disabled = false;
  $("mapHint").textContent = `Zone ${zone.id} · tap to compare`;
  renderMap();
}

async function inspectMapPoint(clientX, clientY) {
  const transform = state.mapTransform, rect = dom.mapCanvas.getBoundingClientRect();
  if (!transform || !state.mapImage) return;
  const x = clientX - rect.left, y = clientY - rect.top;
  const sx = (x - transform.x) / transform.scale, sy = (y - transform.y) / transform.scale;
  if (sx < 0 || sx >= state.mapImage.width || sy < 0 || sy >= state.mapImage.height) { toast("Tap inside the map area to inspect a location."); return; }
  const sampleId = ++state.mapSampleId;
  const bounds = mapBounds(state.mapArea);
  const lon = bounds.lonMin + sx / state.mapImage.width * (bounds.lonMax - bounds.lonMin);
  const lat = bounds.latMax - sy / state.mapImage.height * (bounds.latMax - bounds.latMin);
  try {
    let color;
    if (state.mapArea === "north-america" || state.mapArea === "world") color = await sampleAtlasCell(lat, lon);
    else {
      const ctx = dom.mapCanvas.getContext("2d");
      renderMap(false);
      color = ctx.getImageData(Math.round(x * transform.dpr), Math.round(y * transform.dpr), 1, 1).data;
    }
    if (sampleId !== state.mapSampleId) return;
    updateMapReading(lat, lon, color);
  } catch {
    if (sampleId === state.mapSampleId) toast("Could not load the offline atlas reading.");
  }
}

function renderZoneLegend() {
  const root = $("zoneLegend"); root.replaceChildren();
  for (const zone of ZONES) {
    const item = document.createElement("div"); item.className = "zone-key";
    const swatch = document.createElement("i"); swatch.style.background = zone.color;
    const label = document.createElement("span"); label.textContent = `${zone.id} · ${zone.lpi}`;
    item.append(swatch, label); root.append(item);
  }
}

function populateGear() {
  const cameras = state.prefs.cameras, lenses = state.prefs.lenses;
  const previousCamera = cameras[Number($("frameCamera").value)]?.name;
  const previousLens = lenses[Number($("frameLens").value)]?.name;
  populateSavedGearSelect($("frameCamera"), cameras, "Choose camera", "sensor_width", previousCamera);
  populateSavedGearSelect($("frameLens"), lenses, "Choose lens / scope", "focal_length", previousLens);
  populateCatalogSelect($("cameraCatalogSelect"), state.cameraCatalog, "Choose a camera", "camera");
  populateCatalogSelect($("lensCatalogSelect"), state.lensCatalog, "Choose a lens or telescope", "lens");
  renderGearList("cameraList", cameras, "camera"); renderGearList("lensList", lenses, "lens");
  if (lenses.length && !$('frameFocal').value) $("frameFocal").value = lenses[Number($("frameLens").value)]?.focal_length || lenses[0].focal_length;
  updateFraming();
  populateFieldGear();
}

function populateSavedGearSelect(select, items, prompt, detailKey, selectedName) {
  select.replaceChildren();
  const first = document.createElement("option"); first.value = "";
  first.textContent = items.length ? prompt : "Add gear in My Gear"; select.append(first);
  items.forEach((item, index) => {
    const option = document.createElement("option"); option.value = String(index);
    option.textContent = detailKey === "sensor_width"
      ? `${item.name} · ${item.sensor_width} × ${item.sensor_height} mm`
      : `${item.name} · ${item.focal_length}${item.focal_max ? `–${item.focal_max}` : ""} mm · f/${item.f_ratio}`;
    select.append(option);
  });
  const index = items.findIndex((item) => item.name === selectedName);
  select.value = index >= 0 ? String(index) : items.length ? "0" : "";
}

function populateCatalogSelect(select, items, prompt, type) {
  select.replaceChildren();
  const first = document.createElement("option"); first.value = ""; first.textContent = prompt; select.append(first);
  const optgroup = document.createElement("optgroup");
  optgroup.label = type === "camera" ? "Camera catalog" : "Lens and telescope catalog";
  [...items].sort((a, b) => a.name.localeCompare(b.name)).forEach((item) => {
    const index = items.indexOf(item), option = document.createElement("option"); option.value = String(index);
    option.textContent = type === "camera"
      ? `${item.name} · ${item.sensor_width} × ${item.sensor_height} mm`
      : `${item.name} · ${item.focal_length}${item.focal_max ? `–${item.focal_max}` : ""} mm · f/${item.f_ratio}`;
    optgroup.append(option);
  });
  select.append(optgroup);
}

function addCatalogGear(kind) {
  const select = $(kind === "camera" ? "cameraCatalogSelect" : "lensCatalogSelect");
  const catalog = kind === "camera" ? state.cameraCatalog : state.lensCatalog;
  const saved = kind === "camera" ? state.prefs.cameras : state.prefs.lenses;
  const item = select.value === "" ? null : catalog[Number(select.value)];
  if (!item) { toast(`Choose a ${kind === "camera" ? "camera" : "lens or telescope"} first.`); return; }
  if (saved.some((existing) => existing.name.toLocaleLowerCase() === item.name.toLocaleLowerCase())) {
    toast(`${item.name} is already in My Gear.`); return;
  }
  if (saved.length >= 100) { toast(`My Gear can save up to 100 ${kind === "camera" ? "cameras" : "lenses / scopes"}.`); return; }
  saved.push({ ...item });
  savePreferences(); populateGear();
  const selectId = kind === "camera" ? "frameCamera" : "frameLens";
  const savedSelect = $(selectId);
  savedSelect.value = String(saved.findIndex((entry) => entry.name === item.name));
  if (kind === "lens") $("frameFocal").value = item.focal_length;
  updateFraming(); renderSky();
  toast(`${item.name} added to My Gear.`);
}

function renderGearList(id, items, kind) {
  const root = $(id); root.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p"); empty.className = "small-note"; empty.textContent = `No ${kind === "camera" ? "cameras" : "lenses or telescopes"} saved yet.`; root.append(empty); return;
  }
  items.forEach((item, index) => {
    const row = document.createElement("div"); row.className = "saved-item";
    const description = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = item.name;
    const details = document.createElement("span");
    details.textContent = kind === "camera" ? `${item.sensor_width} × ${item.sensor_height} mm · ${item.pixel_size_um} μm pixels` : `${item.focal_length}${item.focal_max ? `–${item.focal_max}` : ""} mm · f/${item.f_ratio}`;
    description.append(name, details);
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-item"; remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${item.name}`); remove.dataset.removeKind = kind; remove.dataset.removeIndex = String(index);
    row.append(description, remove); root.append(row);
  });
}

function fillTargetOptions() {
  const select = $("frameTargetSelect"); select.replaceChildren();
  for (const target of [...state.targets].sort((a, b) => a.name.localeCompare(b.name))) {
    const option = document.createElement("option"); option.value = target.name;
    option.textContent = `${target.name} · ${target.type}`; select.append(option);
  }
}

function activeTarget() {
  if (!state.selectedTarget && state.targets.length) state.selectedTarget = state.targets.find((target) => target.name.startsWith("M31")) || state.targets[0];
  return state.selectedTarget;
}

function selectTarget(query) {
  const needle = query.trim().toLocaleLowerCase();
  let target = state.targets.find((item) => item.name.toLocaleLowerCase() === needle);
  if (!target && needle) target = state.targets.find((item) => item.name.toLocaleLowerCase().includes(needle));
  if (target) {
    state.selectedTarget = target;
    $("frameTargetSelect").value = target.name;
    state.framePreviewMode = "detail";
    $("frameTargetMode").setAttribute("aria-pressed", "true");
    $("frameCameraMode").setAttribute("aria-pressed", "false");
  }
  else if (!needle) state.selectedTarget = null;
  updateFraming();
}

function fieldOfView(sensor, focal) { return degrees(2 * Math.atan(sensor / (2 * focal))); }

function colorForStar(colorIndex) {
  if (!Number.isFinite(colorIndex)) return "#dbe8ff";
  const t = clamp((colorIndex + .3) / 1.8, 0, 1);
  const red = Math.round(150 + 105 * t), green = Math.round(190 - 95 * t), blue = Math.round(255 - 160 * t);
  return `rgb(${red},${green},${blue})`;
}

function getTargetImage(src) {
  if (state.targetImageCache[src]) return state.targetImageCache[src];
  const image = new Image();
  state.targetImageCache[src] = image;
  image.onload = () => drawFraming();
  image.src = src;
  return image;
}

function targetVisualSeed(name) {
  let seed = 2166136261;
  for (const char of name) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed += 0x6D2B79F5;
    let value = seed;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function drawCatalogTarget(ctx, target, width, height) {
  const random = targetVisualSeed(target.name);
  const type = target.type.toLocaleLowerCase();
  ctx.save(); ctx.globalCompositeOperation = "screen";
  if (type.includes("galaxy")) {
    const radius = Math.max(width, height) * .62;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    glow.addColorStop(0, "rgba(255,225,174,.95)"); glow.addColorStop(.13, "rgba(255,174,115,.77)");
    glow.addColorStop(.42, "rgba(128,178,255,.42)"); glow.addColorStop(1, "rgba(62,106,173,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(0, 0, width * .6, height * .6, -.22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(168,204,255,.45)"; ctx.lineWidth = Math.max(1, Math.min(width, height) * .035);
    for (const direction of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(width * .22, direction * height * .08, width * .36, direction * height * .46, -width * .42, direction * height * .35);
      ctx.stroke();
    }
  } else if (type.includes("cluster")) {
    const count = type.includes("globular") ? 54 : 28;
    for (let i = 0; i < count; i++) {
      const radius = Math.sqrt(random()) * .48, angle = random() * Math.PI * 2;
      const x = Math.cos(angle) * radius * width, y = Math.sin(angle) * radius * height;
      const size = .65 + random() * 1.5;
      ctx.fillStyle = random() > .72 ? "#ffd7a0" : "#d8e8ff";
      ctx.globalAlpha = .45 + random() * .5; ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    }
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(width, height) * .35);
    core.addColorStop(0, "rgba(255,232,190,.62)"); core.addColorStop(1, "rgba(255,232,190,0)");
    ctx.globalAlpha = 1; ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, Math.max(width, height) * .35, 0, Math.PI * 2); ctx.fill();
  } else if (type.includes("planetary")) {
    const radius = Math.max(width, height) * .42;
    const shell = ctx.createRadialGradient(0, 0, radius * .38, 0, 0, radius);
    shell.addColorStop(0, "rgba(4,12,20,0)"); shell.addColorStop(.46, "rgba(108,233,221,.12)");
    shell.addColorStop(.72, "rgba(127,238,220,.9)"); shell.addColorStop(1, "rgba(102,154,255,0)");
    ctx.fillStyle = shell; ctx.beginPath(); ctx.ellipse(0, 0, width * .47, height * .47, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,224,174,.9)"; ctx.beginPath(); ctx.arc(0, 0, 1.4, 0, Math.PI * 2); ctx.fill();
  } else {
    const radius = Math.max(width, height) * .72;
    for (let i = 0; i < 7; i++) {
      const x = (random() - .5) * width * .7, y = (random() - .5) * height * .7;
      const r = radius * (.32 + random() * .3);
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, r);
      cloud.addColorStop(0, i % 2 ? "rgba(255,179,127,.48)" : "rgba(130,197,255,.46)");
      cloud.addColorStop(1, "rgba(74,132,214,0)");
      ctx.fillStyle = cloud; ctx.beginPath(); ctx.ellipse(x, y, r, r * (.58 + random() * .42), random() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawFraming() {
  const canvas = dom.frameCanvas, rect = canvas.getBoundingClientRect();
  if (rect.width < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height, target = activeTarget();
  ctx.fillStyle = "#07121e"; ctx.fillRect(0, 0, w, h);
  const camera = $("frameCamera").value === "" ? null : state.prefs.cameras[Number($("frameCamera").value)] || null;
  const focal = finite($("frameFocal").value, 0);
  if (!target) {
    ctx.fillStyle = "#9eb0bd"; ctx.font = "13px -apple-system, sans-serif"; ctx.textAlign = "center";
    $("frameModeHint").textContent = "Choose a target to see its framing.";
    $("framingVisualLabel").textContent = "Object preview";
    ctx.fillText("Choose a target to see its framing", w / 2, h / 2); return;
  }
  const hasCamera = Boolean(camera && focal > 0);
  const showCameraField = hasCamera && state.framePreviewMode === "camera";
  const fovX = hasCamera ? fieldOfView(camera.sensor_width, focal) : 0;
  const fovY = hasCamera ? fieldOfView(camera.sensor_height, focal) : 0;
  const margin = 16, plot = { x: margin, y: margin, width: w - margin * 2, height: h - margin * 2 };
  const targetWidth = Math.max(.01, finite(target.size_deg?.[0], .2));
  const targetHeight = Math.max(.01, finite(target.size_deg?.[1], .2));
  const scale = showCameraField
    ? Math.min(plot.width / (fovX * 1.5), plot.height / (fovY * 1.5))
    : Math.min(plot.width * .42 / targetWidth, plot.height * .42 / targetHeight);
  const sceneFovX = plot.width / scale, sceneFovY = plot.height / scale;
  const frameW = hasCamera ? fovX * scale : 0, frameH = hasCamera ? fovY * scale : 0;
  const centerX = w / 2, centerY = h / 2, rotation = radians(finite($("frameRotation").value, 0));
  const frame = { x: centerX - frameW / 2, y: centerY - frameH / 2, width: frameW, height: frameH };
  ctx.fillStyle = "#02070d"; ctx.fillRect(plot.x, plot.y, plot.width, plot.height);
  ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.width, plot.height); ctx.clip();
  ctx.strokeStyle = "rgba(128,224,210,.12)"; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(plot.x + plot.width * i / 4, plot.y); ctx.lineTo(plot.x + plot.width * i / 4, plot.y + plot.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(plot.x, plot.y + plot.height * i / 4); ctx.lineTo(plot.x + plot.width, plot.y + plot.height * i / 4); ctx.stroke();
  }
  ctx.translate(centerX, centerY); ctx.rotate(-rotation); ctx.translate(-centerX, -centerY);
  const ra0 = radians(target.ra), dec0 = radians(target.dec);
  for (const star of state.stars) {
    const ra = radians(star[1]), dec = radians(star[2]), dra = ra - ra0;
    const cosc = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(dra);
    if (cosc <= 0) continue;
    const tangentX = Math.cos(dec) * Math.sin(dra) / cosc;
    const tangentY = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(dra)) / cosc;
    const sx = degrees(tangentX), sy = degrees(tangentY);
    if (Math.abs(sx) > sceneFovX * .55 || Math.abs(sy) > sceneFovY * .55) continue;
    const px = centerX + sx * scale, py = centerY - sy * scale;
    const mag = finite(star[3], 6.5), radius = clamp(2.1 - (mag + .5) * .24, .55, 2.1);
    ctx.beginPath(); ctx.fillStyle = colorForStar(star[4]); ctx.globalAlpha = clamp(1.15 - mag / 9, .35, .92);
    ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const width = Math.max(6, targetWidth * scale);
  const height = Math.max(6, targetHeight * scale);
  const source = state.targetImages[target.name];
  const reference = source ? getTargetImage(source.src) : null;
  if (reference?.complete && reference.naturalWidth) {
    const imageAspect = reference.naturalWidth / reference.naturalHeight;
    const boxAspect = width / height;
    let imageWidth = width, imageHeight = height;
    if (imageAspect > boxAspect) imageHeight = width / imageAspect;
    else imageWidth = height * imageAspect;
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(reference, centerX - imageWidth / 2, centerY - imageHeight / 2, imageWidth, imageHeight);
    ctx.globalCompositeOperation = "source-over";
  } else {
    ctx.save(); ctx.translate(centerX, centerY);
    drawCatalogTarget(ctx, target, width, height);
    ctx.restore();
  }
  ctx.restore();
  let sensorFits = false;
  if (hasCamera) {
    ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.width, plot.height); ctx.clip();
    ctx.strokeStyle = "#80e0d2"; ctx.lineWidth = 2;
    ctx.setLineDash(showCameraField ? [] : [6, 4]);
    ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
    sensorFits = frame.width <= plot.width && frame.height <= plot.height;
    if (!sensorFits && !showCameraField) {
      ctx.setLineDash([2, 5]); ctx.lineWidth = 1.5;
      ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
    }
    ctx.setLineDash([]); ctx.restore();
  }
  ctx.fillStyle = "#9eb0bd"; ctx.font = "10px -apple-system, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(showCameraField ? "1.5× CAMERA FIELD" : "TARGET DETAIL", centerX, Math.max(12, plot.y - 5));
  $("frameModeHint").textContent = !hasCamera
    ? "Target detail · add a camera and focal length to overlay your camera field."
    : showCameraField
    ? "Full sensor field · target and stars are shown at catalog scale."
    : sensorFits ? "Target detail · dashed teal box shows the complete camera field."
      : "Target detail · camera field extends beyond this zoomed view.";
  $("framingVisualLabel").textContent = source
    ? (source.caption || `${target.name} reference image`)
    : `${target.type} illustration · target detail`;
}

function updateFraming() {
  const target = activeTarget();
  const camera = $("frameCamera").value === "" ? null : state.prefs.cameras[Number($("frameCamera").value)] || null;
  const focal = finite($("frameFocal").value, 0);
  $("frameRotationLabel").textContent = `${finite($("frameRotation").value, 0)}°`;
  $("chartTargetName").textContent = target ? target.name : "Target center";
  if (camera && focal > 0) {
    $("frameFov").textContent = `${fieldOfView(camera.sensor_width, focal).toFixed(2)}° × ${fieldOfView(camera.sensor_height, focal).toFixed(2)}°`;
  } else $("frameFov").textContent = "Add camera and focal length";
  $("frameTargetSize").textContent = target ? `${target.size_deg[0]}° × ${target.size_deg[1]}° · ${target.type}` : "Choose a catalog target";
  const image = target ? state.targetImages[target.name] : null;
  $("targetImageCard").hidden = !image;
  if (image) {
    getTargetImage(image.src);
    const reference = $("targetReferenceImage");
    if (reference.dataset.src !== image.src) {
      reference.dataset.src = image.src;
      reference.onload = () => { if (reference.dataset.src === image.src) drawFraming(); };
      reference.src = image.src;
    }
    reference.alt = `${target.name} reference image`;
    $("targetImageName").textContent = image.caption || `${target.name} · reference view`;
    $("targetImageCredit").textContent = image.credit || "NASA image credit is listed in AstroApp attributions.";
  }
  drawFraming();
}

function setFramePreviewMode(mode) {
  if (mode !== "detail" && mode !== "camera") return;
  state.framePreviewMode = mode;
  $("frameTargetMode").setAttribute("aria-pressed", String(mode === "detail"));
  $("frameCameraMode").setAttribute("aria-pressed", String(mode === "camera"));
  drawFraming();
}

function activateScreen(name) {
  for (const screen of dom.screens) {
    const active = screen.id === `screen-${name}`;
    screen.hidden = !active; screen.classList.toggle("active", active);
  }
  for (const button of dom.nav) {
    const active = button.dataset.screen === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  }
  if (name === "pollution") requestAnimationFrame(() => {
    if (state.mapNeedsFocus) focusMapOn(state.prefs.site.lat, state.prefs.site.lon, state.mapArea === "north-america" ? 1.2 : 1.5);
    else resizeMapCanvas();
  });
  if (name === "framing") requestAnimationFrame(drawFraming);
}

function applyGPS() {
  if (!navigator.geolocation) { toast("Location is not available in this browser."); return; }
  toast("Waiting for location permission…");
  navigator.geolocation.getCurrentPosition((position) => {
    const lat = position.coords.latitude, lon = position.coords.longitude;
    state.prefs.site = { name: "Current location", lat, lon };
    state.siteConfigured = true;
    state.mapPin = state.prefs.site;
    savePreferences(); updateSiteLabels(); renderSky();
    if (state.mapImage) {
      const preferNA = lat >= 7 && lat <= 75 && lon >= -180 && lon <= -51;
      if ((preferNA && state.mapArea !== "north-america") || (!preferNA && state.mapArea !== "world")) setMapArea(preferNA ? "north-america" : "world", true);
      else focusMapOn(lat, lon, Math.max(state.mapZoom, 1.5));
    }
    toast("Current location saved on this iPhone.");
  }, (error) => toast(error.code === 1 ? "Location permission was not granted." : "Could not get a location fix."),
  { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

function saveSiteFromFields() {
  const name = $("siteNameInput").value.trim() || "Observing site";
  const lat = finite($("siteLatInput").value), lon = finite($("siteLonInput").value);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) { toast("Enter a valid latitude and longitude."); return; }
  state.prefs.site = { name: name.slice(0, 60), lat, lon };
  state.siteConfigured = true;
  state.mapPin = state.prefs.site;
  savePreferences(); updateSiteLabels(); renderSky();
  state.mapPin = state.prefs.site;
  if (state.mapImage) focusMapOn(lat, lon, Math.max(state.mapZoom, state.mapArea === "world" ? 1.5 : 1.2));
  toast("Observing site saved on this iPhone.");
}

function addGear(kind) {
  if (kind === "camera") {
    if (state.prefs.cameras.length >= 100) { toast("My Gear can save up to 100 cameras."); return; }
    const item = { name: $("newCameraName").value.trim(), sensor_width: finite($("newCameraWidth").value), sensor_height: finite($("newCameraHeight").value), pixel_size_um: finite($("newCameraPixel").value) };
    if (!item.name || !validCamera(item)) { toast("Enter a name and valid sensor dimensions."); return; }
    state.prefs.cameras.push(item);
    for (const id of ["newCameraName", "newCameraWidth", "newCameraHeight", "newCameraPixel"]) $(id).value = "";
  } else {
    if (state.prefs.lenses.length >= 100) { toast("My Gear can save up to 100 lenses / scopes."); return; }
    const item = { name: $("newLensName").value.trim(), focal_length: finite($("newLensFocal").value), f_ratio: finite($("newLensRatio").value) };
    if (!item.name || !validLens(item)) { toast("Enter a name, focal length, and f-number."); return; }
    state.prefs.lenses.push(item);
    for (const id of ["newLensName", "newLensFocal", "newLensRatio"]) $(id).value = "";
  }
  savePreferences(); populateGear(); toast(`${kind === "camera" ? "Camera" : "Lens / telescope"} added.`);
}

function downloadGear() {
  const backup = { ...state.prefs, fieldKit: { session: state.fieldSession, packingItems: state.packingItems } };
  const file = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(file); link.download = "astroapp-backup.json";
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function importGear(file) {
  try {
    const incoming = JSON.parse(await file.text());
    if (!incoming || !Array.isArray(incoming.cameras) || !Array.isArray(incoming.lenses) ||
        incoming.cameras.some((item) => !validCamera(item)) || incoming.lenses.some((item) => !validLens(item))) {
      throw new Error("This file does not contain valid camera and lens data.");
    }
    const site = incoming.site;
    if (site && (typeof site.name !== "string" || finite(site.lat, 91) < -90 || finite(site.lat, -91) > 90 || finite(site.lon, 181) < -180 || finite(site.lon, -181) > 180)) {
      throw new Error("This file has an invalid observing site.");
    }
    state.prefs = { cameras: incoming.cameras.slice(0, 100), lenses: incoming.lenses.slice(0, 100), site: site ? { name: site.name.slice(0, 60), lat: Number(site.lat), lon: Number(site.lon) } : state.prefs.site };
    if (site) state.siteConfigured = Boolean(site.name.trim() && site.name !== "Set observing site");
    state.mapPin = state.siteConfigured ? state.prefs.site : null;
    if (incoming.fieldKit && typeof incoming.fieldKit === "object") {
      const importedSession = incoming.fieldKit.session;
      if (importedSession && typeof importedSession === "object") {
        state.fieldSession = {
          target: typeof importedSession.target === "string" ? importedSession.target.slice(0, 80) : "",
          exposure: clamp(finite(importedSession.exposure, 60), 0.1, 86400),
          lights: clamp(Math.floor(finite(importedSession.lights, 0)), 0, 1000000),
          darks: clamp(Math.floor(finite(importedSession.darks, 0)), 0, 1000000),
          flats: clamp(Math.floor(finite(importedSession.flats, 0)), 0, 1000000),
          bias: clamp(Math.floor(finite(importedSession.bias, 0)), 0, 1000000),
        };
      }
      if (Array.isArray(incoming.fieldKit.packingItems)) {
        state.packingItems = incoming.fieldKit.packingItems.filter((item) => item && typeof item.name === "string" && item.name.trim())
          .slice(0, 100).map((item) => ({ name: item.name.trim().slice(0, 60), checked: Boolean(item.checked) }));
      }
      saveFieldKit(); renderFieldSession(); renderPackingList();
    }
    savePreferences(); updateSiteLabels(); populateGear(); renderSky(); toast("AstroApp backup imported.");
    if (state.mapImage && state.siteConfigured) focusMapOn(state.prefs.site.lat, state.prefs.site.lon, Math.max(state.mapZoom, 1.2));
  } catch (error) { toast(error.message || "Could not read that AstroApp backup."); }
}

function renderOfflineStatus(text, mode = "") {
  dom.statusText.textContent = text;
  dom.status.classList.toggle("ready", mode === "ready");
  dom.status.classList.toggle("error", mode === "error");
}

function checkOfflineCache(worker) {
  return new Promise((resolve) => {
    if (!worker) { resolve(false); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 12000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer); channel.port1.close(); resolve(Boolean(event.data?.ready));
    };
    worker.postMessage({ type: "CHECK_OFFLINE_CACHE" }, [channel.port2]);
  });
}

async function setupOffline() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    renderOfflineStatus("Secure setup needed", "error"); return;
  }
  renderOfflineStatus("Saving offline kit…");
  try {
    const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    const worker = registration.active || registration.waiting || registration.installing;
    if (worker?.state === "installing" || worker?.state === "activating") {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 90000);
        const complete = () => {
          if (worker.state === "activated" || worker.state === "redundant") {
            clearTimeout(timeout); worker.removeEventListener("statechange", complete); resolve();
          }
        };
        worker.addEventListener("statechange", complete);
        if (worker.state === "activated" || worker.state === "redundant") complete();
      });
    }
    if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
    const active = registration.active || registration.waiting || navigator.serviceWorker.controller;
    const ready = await checkOfflineCache(active);
    state.offlineReady = ready;
    renderOfflineStatus(ready ? "Offline ready" : navigator.onLine ? "Saving offline kit…" : "Offline setup incomplete", ready ? "ready" : "");
    if (!ready && navigator.onLine) setTimeout(() => setupOffline(), 3500);
  } catch {
    renderOfflineStatus(navigator.onLine ? "Offline setup failed" : "Offline setup needed", "error");
  }
}

function installDialog() {
  const dialog = $("installDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else toast("Open this page in Safari, then use Share → Add to Home Screen.");
}

function setupMapPointerEvents() {
  const canvas = dom.mapCanvas;
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault(); canvas.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    state.mapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    state.mapMoved = false;
    if (state.mapPointers.size === 1) state.mapLast = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
    else if (state.mapPointers.size === 2) {
      const points = [...state.mapPointers.values()];
      state.mapPinch = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), zoom: state.mapZoom,
        x: (points[0].x + points[1].x) / 2 - rect.left, y: (points[0].y + points[1].y) / 2 - rect.top };
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.mapPointers.has(event.pointerId)) return;
    const rect = canvas.getBoundingClientRect();
    state.mapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.mapPointers.size === 1 && state.mapLast) {
      const dx = event.clientX - state.mapLast.x, dy = event.clientY - state.mapLast.y;
      if (Math.hypot(event.clientX - state.mapLast.startX, event.clientY - state.mapLast.startY) > 5) state.mapMoved = true;
      state.mapPanX += dx; state.mapPanY += dy; state.mapLast.x = event.clientX; state.mapLast.y = event.clientY; renderMap();
    } else if (state.mapPointers.size >= 2 && state.mapPinch) {
      const points = [...state.mapPointers.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const midpoint = { x: (points[0].x + points[1].x) / 2 - rect.left, y: (points[0].y + points[1].y) / 2 - rect.top };
      if (Math.abs(distance - state.mapPinch.distance) > 1) { state.mapMoved = true; changeMapZoom(state.mapPinch.zoom * distance / state.mapPinch.distance, midpoint.x, midpoint.y); }
    }
  });
  const end = (event) => {
    const point = state.mapPointers.get(event.pointerId);
    if (point && state.mapPointers.size === 1 && !state.mapMoved) inspectMapPoint(point.x, point.y);
    state.mapPointers.delete(event.pointerId);
    if (state.mapPointers.size < 2) state.mapPinch = null;
    if (!state.mapPointers.size) { state.mapLast = null; state.mapMoved = false; }
  };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", (event) => { state.mapPointers.delete(event.pointerId); state.mapPinch = null; state.mapLast = null; });
}

function bindEvents() {
  dom.nav.forEach((button) => button.addEventListener("click", () => activateScreen(button.dataset.screen)));
  dom.status.addEventListener("click", installDialog);
  $("skyUseLocation").addEventListener("click", applyGPS);
  $("gearUseLocation").addEventListener("click", applyGPS);
  $("skyToday").addEventListener("click", () => { dom.date.value = localDateISO(); renderSky(); });
  $("skyPrevious").addEventListener("click", () => changeDate(-1));
  $("skyNext").addEventListener("click", () => changeDate(1));
  dom.date.addEventListener("change", renderSky);
  $("mapWorld").addEventListener("click", () => setMapArea("world"));
  $("mapNorthAmerica").addEventListener("click", () => setMapArea("north-america"));
  $("mapMySite").addEventListener("click", () => {
    if (!state.siteConfigured) { toast("Add an observing site in My Gear first."); return; }
    const site = state.prefs.site, preferNA = site.lat >= 7 && site.lat <= 75 && site.lon >= -180 && site.lon <= -51;
    const area = preferNA ? "north-america" : "world";
    if (area !== state.mapArea) setMapArea(area, true); else focusMapOn(site.lat, site.lon, Math.max(state.mapZoom, area === "world" ? 1.5 : 1.25));
  });
  $("mapZoomIn").addEventListener("click", () => changeMapZoom(state.mapZoom * 1.7));
  $("mapZoomOut").addEventListener("click", () => changeMapZoom(state.mapZoom / 1.7));
  $("saveMapPin").addEventListener("click", () => {
    if (!state.mapPin) return;
    state.prefs.site = { name: "Pinned location", lat: state.mapPin.lat, lon: state.mapPin.lon };
    state.siteConfigured = true;
    savePreferences(); updateSiteLabels(); renderSky(); toast("Map pin saved as your observing site.");
  });
  setupMapPointerEvents();
  $("frameTargetSelect").addEventListener("change", (event) => { selectTarget(event.currentTarget.value); renderSky(); });
  $("frameTargetMode").addEventListener("click", () => setFramePreviewMode("detail"));
  $("frameCameraMode").addEventListener("click", () => setFramePreviewMode("camera"));
  $("frameCamera").addEventListener("change", () => { updateFraming(); renderSky(); });
  $("frameLens").addEventListener("change", () => {
    const lens = state.prefs.lenses[Number($("frameLens").value)];
    if (lens) $("frameFocal").value = lens.focal_length;
    updateFraming(); renderSky();
  });
  $("frameFocal").addEventListener("input", updateFraming);
  $("frameFocal").addEventListener("change", renderSky);
  $("frameRotation").addEventListener("input", updateFraming);
  $("fieldCamera").addEventListener("change", updateExposureGuide);
  $("fieldLens").addEventListener("change", () => {
    const lensIndex = $("fieldLens").value;
    const lens = lensIndex === "" ? null : state.prefs.lenses[Number(lensIndex)];
    if (lens) { $("fieldFocal").value = lens.focal_length; $("fieldFNumber").value = lens.f_ratio; }
    updateExposureGuide();
  });
  $("fieldFocal").addEventListener("input", updateExposureGuide);
  $("fieldFNumber").addEventListener("input", updateExposureGuide);
  $("fieldAlignment").addEventListener("change", updateExposureGuide);
  for (const id of ["sessionTarget", "sessionExposure", "sessionLights", "sessionDarks", "sessionFlats", "sessionBias"]) {
    $(id).addEventListener("input", updateFieldSession);
    $(id).addEventListener("change", updateFieldSession);
  }
  $("resetSession").addEventListener("click", () => {
    for (const id of ["sessionLights", "sessionDarks", "sessionFlats", "sessionBias"]) $(id).value = "0";
    updateFieldSession(); toast("Session counts reset.");
  });
  $("addPackingItem").addEventListener("click", addPackingItem);
  $("newPackingItem").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addPackingItem(); } });
  $("resetPacking").addEventListener("click", () => {
    state.packingItems.forEach((item) => { item.checked = false; });
    renderPackingList(); saveFieldKit();
  });
  for (const list of [dom.targets, $("framingTargets")]) list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-target]");
    if (row) { selectTarget(row.dataset.target); renderSky(); activateScreen("framing"); }
  });
  $("saveSite").addEventListener("click", saveSiteFromFields);
  $("addCamera").addEventListener("click", () => addGear("camera"));
  $("addLens").addEventListener("click", () => addGear("lens"));
  $("addCatalogCamera").addEventListener("click", () => addCatalogGear("camera"));
  $("addCatalogLens").addEventListener("click", () => addCatalogGear("lens"));
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-kind]"); if (!button) return;
    const kind = button.dataset.removeKind, index = Number(button.dataset.removeIndex);
    if (kind === "camera") state.prefs.cameras.splice(index, 1); else state.prefs.lenses.splice(index, 1);
    savePreferences(); populateGear(); toast("Gear item removed.");
  });
  $("gearExport").addEventListener("click", downloadGear);
  $("gearImport").addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0]; if (file) importGear(file);
    event.currentTarget.value = "";
  });
  $("closeInstall").addEventListener("click", () => $("installDialog").close());
  $("doneInstall").addEventListener("click", () => $("installDialog").close());
  window.addEventListener("resize", () => { drawTimeline(); if (!$("screen-pollution").hidden) resizeMapCanvas(); if (!$("screen-framing").hidden) drawFraming(); });
  window.addEventListener("online", () => {
    state.mapAtlasFailed = false;
    if (!state.offlineReady) setupOffline();
    if (state.mapZoom > 8) renderMap();
  });
}

function changeDate(days) {
  const date = dateAtLocalNoon(dom.date.value || localDateISO());
  date.setDate(date.getDate() + days); dom.date.value = localDateISO(date); renderSky();
}

async function init() {
  try {
    const [defaults, targetData, stars, equipment, imageData] = await Promise.all([
      fetch("./data/default-settings.json").then((response) => { if (!response.ok) throw new Error("Settings file unavailable"); return response.json(); }),
      fetch("./data/deep-sky-targets.json").then((response) => { if (!response.ok) throw new Error("Target catalog unavailable"); return response.json(); }),
      fetch("./data/stars-mag65.json").then((response) => { if (!response.ok) throw new Error("Star catalog unavailable"); return response.json(); }),
      fetch("./data/equipment-catalog.json").then((response) => { if (!response.ok) throw new Error("Equipment catalog unavailable"); return response.json(); }),
      fetch("./data/deep-sky-images.json").then((response) => { if (!response.ok) throw new Error("Image catalog unavailable"); return response.json(); }),
    ]);
    state.defaults = defaults;
    state.prefs.cameras = Array.isArray(defaults.cameras) ? defaults.cameras.filter(validCamera) : [];
    state.prefs.lenses = Array.isArray(defaults.lenses) ? defaults.lenses.filter(validLens) : [];
    state.targets = Object.entries(targetData).filter(([, item]) => Number.isFinite(item.ra) && Number.isFinite(item.dec) && Array.isArray(item.size_deg))
      .map(([name, item]) => ({ name, ra: item.ra, dec: item.dec, size_deg: item.size_deg, type: item.type || "Deep sky object" }));
    state.stars = stars.filter((star) => Array.isArray(star) && Number.isFinite(star[1]) && Number.isFinite(star[2]));
    state.cameraCatalog = Array.isArray(equipment.cameras) ? equipment.cameras.filter(validCamera) : [];
    state.lensCatalog = Array.isArray(equipment.lenses) ? equipment.lenses.filter(validLens) : [];
    state.targetImages = imageData && typeof imageData === "object" ? imageData : {};
    loadPreferences();
  } catch (error) {
    renderOfflineStatus("Local data unavailable", "error");
    toast("AstroApp could not load its bundled sky data. Reopen while online to finish setup.");
    console.error(error);
  }
  loadFieldKit();
  updateSiteLabels();
  dom.date.value = localDateISO();
  renderZoneLegend(); fillTargetOptions(); populateGear(); renderFieldSession(); renderPackingList();
  const initialTarget = activeTarget(); if (initialTarget) $("frameTargetSelect").value = initialTarget.name;
  renderSky(); bindEvents();
  const site = state.prefs.site;
  setMapArea(site.lat >= 7 && site.lat <= 75 && site.lon >= -180 && site.lon <= -51 ? "north-america" : "world", true);
  setupOffline();
}

init();
