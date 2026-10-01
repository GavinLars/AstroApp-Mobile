"use strict";

const STORAGE_KEY = "astroapp.mobile.preferences.v1";
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
  targets: [], stars: [], selectedTarget: null, night: null,
  mapArea: "world", mapZoom: 1, mapPanX: 0, mapPanY: 0, mapImage: null,
  mapTransform: null, mapPointers: new Map(), mapMoved: false, mapLast: null, mapPinch: null,
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
    if (Array.isArray(stored.cameras)) state.prefs.cameras = stored.cameras.filter(validCamera).slice(0, 40);
    if (Array.isArray(stored.lenses)) state.prefs.lenses = stored.lenses.filter(validLens).slice(0, 60);
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
  const [lon, lat] = moonEcliptic(julianDate(date));
  const [ra, dec] = eclipticToEquatorial(lon, lat);
  return altitude(ra, dec, date, site.lat, site.lon);
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
  ctx.fillStyle = "rgba(247,215,139,.25)";
  if (night.darkStart && night.darkEnd) ctx.fillRect(xFor(night.darkStart), 15, Math.max(0, xFor(night.darkEnd) - xFor(night.darkStart)), 60);
  if (night.moonrise && night.moonset && night.moonset > night.moonrise) {
    ctx.fillStyle = "rgba(247,215,139,.12)";
    ctx.fillRect(xFor(night.moonrise), 15, Math.max(1, xFor(night.moonset) - xFor(night.moonrise)), 60);
  } else if (night.moonrise) {
    ctx.fillStyle = "rgba(247,215,139,.12)"; ctx.fillRect(xFor(night.moonrise), 15, Math.max(1, w - xFor(night.moonrise)), 60);
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

function renderTargets(dateText) {
  const list = dom.targets;
  list.replaceChildren();
  if (!state.targets.length) return;
  if (!state.siteConfigured) {
    $("targetCount").textContent = "Set a site";
    const p = document.createElement("p"); p.className = "small-note";
    p.textContent = "Add your observing site in My Gear to see targets for local darkness.";
    list.append(p); return;
  }
  if (!state.night) return;
  const night = state.night;
  const begin = night.sunset || night.nightStart;
  const finish = night.sunrise || night.nightEnd;
  const samples = [];
  for (let i = 0; i <= 72; i++) {
    const date = new Date(begin.getTime() + (finish - begin) * i / 72);
    const sun = sunAlt(date), moon = moonAlt(date);
    samples.push({ date, lst: localSiderealDegrees(date, state.prefs.site.lon), dark: sun <= -18, moonFree: moon <= .125, sunDark: sun <= -.833 });
  }
  const phase = moonPhase(dateAtLocalNoon(dateText));
  const ranked = state.targets.map((target) => {
    const vals = samples.map((sample) => ({ sample, alt: targetAlt(target.ra, target.dec, sample) }));
    const dark = vals.filter((item) => item.sample.dark && (phase.illumination < .45 || item.sample.moonFree));
    const allDark = vals.filter((item) => item.sample.dark);
    const considered = dark.length ? dark : allDark.length ? allDark : vals.filter((item) => item.sample.sunDark);
    const best = considered.reduce((a, b) => b.alt > a.alt ? b : a, { alt: -90, sample: samples[0] });
    return { ...target, bestAlt: best.alt, bestAt: best.sample.date, darkMoonless: dark.length > 0 };
  }).filter((target) => target.bestAlt >= 12).sort((a, b) => b.bestAlt - a.bestAlt).slice(0, 8);
  $("targetCount").textContent = `${ranked.length} picks`;
  if (!ranked.length) {
    const p = document.createElement("p"); p.className = "small-note"; p.textContent = "No catalog targets rise high enough during darkness at this site tonight."; list.append(p); return;
  }
  for (const target of ranked) {
    const row = document.createElement("button"); row.type = "button"; row.className = "target-row"; row.dataset.target = target.name;
    const info = document.createElement("div");
    const title = document.createElement("h3"); title.textContent = target.name;
    const sub = document.createElement("p"); sub.textContent = `${target.type} · highest near ${timeLabel(target.bestAt)}`;
    info.append(title, sub);
    const score = document.createElement("div"); score.className = "target-score";
    const altitudeText = document.createElement("strong"); altitudeText.textContent = `${Math.round(target.bestAlt)}° high`;
    const condition = document.createElement("span"); condition.textContent = target.darkMoonless ? "Dark window" : "Moon up";
    score.append(altitudeText, condition); row.append(info, score); list.append(row);
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
  $("darkWindow").textContent = !hasSite ? "Set a site"
    : night.darkStart && night.darkEnd ? `${timeLabel(night.darkStart)} – ${timeLabel(night.darkEnd)}` : "No full dark";
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
  state.mapZoom = clamp(zoom, 1, 8);
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
  const oldScale = old.scale, fit = Math.min(rect.width / state.mapImage.width, rect.height / state.mapImage.height);
  state.mapZoom = clamp(nextZoom, 1, 8);
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

function updateMapReading(lat, lon, color) {
  const zone = nearestZone(color);
  state.mapPin = { lat, lon };
  $("readingZone").textContent = `Zone ${zone.id} · ${zone.name}`;
  $("readingCoordinates").textContent = formatCoords(lat, lon);
  $("readingBrightness").textContent = `${zone.lpi} LPI · about ${zone.sqm} mag/arcsec²`;
  $("readingSwatch").style.background = zone.color;
  $("readingExplanation").textContent = "Approximate artificial zenith brightness for this atlas pixel. It is not a Bortle score or a live measurement.";
  $("saveMapPin").disabled = false;
  $("mapHint").textContent = `Zone ${zone.id} · tap another point`;
  renderMap();
}

function inspectMapPoint(clientX, clientY) {
  const transform = state.mapTransform, rect = dom.mapCanvas.getBoundingClientRect();
  if (!transform || !state.mapImage) return;
  const x = clientX - rect.left, y = clientY - rect.top;
  const sx = (x - transform.x) / transform.scale, sy = (y - transform.y) / transform.scale;
  if (sx < 0 || sx >= state.mapImage.width || sy < 0 || sy >= state.mapImage.height) { toast("Tap inside the map area to inspect a location."); return; }
  const bounds = mapBounds(state.mapArea);
  const lon = bounds.lonMin + sx / state.mapImage.width * (bounds.lonMax - bounds.lonMin);
  const lat = bounds.latMax - sy / state.mapImage.height * (bounds.latMax - bounds.latMin);
  const ctx = dom.mapCanvas.getContext("2d");
  try {
    renderMap(false);
    const color = ctx.getImageData(Math.round(x * transform.dpr), Math.round(y * transform.dpr), 1, 1).data;
    updateMapReading(lat, lon, color);
  } catch { toast("Could not read this map pixel."); }
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
  const cameraSelect = $("frameCamera"), lensSelect = $("frameLens");
  cameraSelect.replaceChildren(); lensSelect.replaceChildren();
  cameras.forEach((camera, index) => {
    const option = document.createElement("option"); option.value = String(index); option.textContent = camera.name; cameraSelect.append(option);
  });
  lenses.forEach((lens, index) => {
    const option = document.createElement("option"); option.value = String(index); option.textContent = lens.name; lensSelect.append(option);
  });
  renderGearList("cameraList", cameras, "camera"); renderGearList("lensList", lenses, "lens");
  if (lenses.length && !$('frameFocal').value) $("frameFocal").value = lenses[0].focal_length;
  updateFraming();
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
    details.textContent = kind === "camera" ? `${item.sensor_width} × ${item.sensor_height} mm · ${item.pixel_size_um} μm pixels` : `${item.focal_length} mm · f/${item.f_ratio}`;
    description.append(name, details);
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-item"; remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${item.name}`); remove.dataset.removeKind = kind; remove.dataset.removeIndex = String(index);
    row.append(description, remove); root.append(row);
  });
}

function fillTargetOptions() {
  const datalist = $("frameTargetOptions"); datalist.replaceChildren();
  for (const target of state.targets) {
    const option = document.createElement("option"); option.value = target.name; datalist.append(option);
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
  if (target) { state.selectedTarget = target; $("frameTargetSearch").value = target.name; }
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

function drawFraming() {
  const canvas = dom.frameCanvas, rect = canvas.getBoundingClientRect();
  if (rect.width < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height, target = activeTarget();
  ctx.fillStyle = "#07121e"; ctx.fillRect(0, 0, w, h);
  const camera = state.prefs.cameras[Number($("frameCamera").value)] || state.prefs.cameras[0];
  const focal = finite($("frameFocal").value, 0);
  if (!target || !camera || focal <= 0) {
    ctx.fillStyle = "#9eb0bd"; ctx.font = "13px -apple-system, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(!camera ? "Add a camera in My Gear to see framing" : "Choose a target and focal length", w / 2, h / 2); return;
  }
  const fovX = fieldOfView(camera.sensor_width, focal), fovY = fieldOfView(camera.sensor_height, focal);
  const margin = 22, plotW = w - margin * 2, plotH = h - margin * 2;
  const centerX = w / 2, centerY = h / 2, rotation = radians(finite($("frameRotation").value, 0));
  ctx.strokeStyle = "rgba(128,224,210,.12)"; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(margin + plotW * i / 4, margin); ctx.lineTo(margin + plotW * i / 4, h - margin); ctx.stroke(); ctx.beginPath(); ctx.moveTo(margin, margin + plotH * i / 4); ctx.lineTo(w - margin, margin + plotH * i / 4); ctx.stroke(); }
  const ra0 = radians(target.ra), dec0 = radians(target.dec);
  for (const star of state.stars) {
    const ra = radians(star[1]), dec = radians(star[2]), dra = ra - ra0;
    const cosc = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(dra);
    if (cosc <= 0) continue;
    const tangentX = Math.cos(dec) * Math.sin(dra) / cosc;
    const tangentY = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(dra)) / cosc;
    const sx = degrees(tangentX), sy = degrees(tangentY);
    if (Math.abs(sx) > fovX * .65 || Math.abs(sy) > fovY * .65) continue;
    const px = centerX + sx / fovX * plotW, py = centerY - sy / fovY * plotH;
    const mag = finite(star[3], 6.5), radius = clamp(2.1 - (mag + .5) * .24, .55, 2.1);
    ctx.beginPath(); ctx.fillStyle = colorForStar(star[4]); ctx.globalAlpha = clamp(1.15 - mag / 9, .35, .92);
    ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(centerX, centerY); ctx.rotate(-rotation);
  ctx.strokeStyle = "#80e0d2"; ctx.lineWidth = 2; ctx.setLineDash([7, 4]);
  ctx.strokeRect(-plotW / 2, -plotH / 2, plotW, plotH); ctx.setLineDash([]);
  ctx.restore();
  const sizeX = clamp((target.size_deg?.[0] || .2) / fovX * plotW, 5, plotW * .9);
  const sizeY = clamp((target.size_deg?.[1] || .2) / fovY * plotH, 5, plotH * .9);
  ctx.strokeStyle = "#ffd991"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(centerX, centerY, sizeX / 2, sizeY / 2, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(centerX - 7, centerY); ctx.lineTo(centerX + 7, centerY); ctx.moveTo(centerX, centerY - 7); ctx.lineTo(centerX, centerY + 7); ctx.stroke();
  ctx.fillStyle = "#9eb0bd"; ctx.font = "10px -apple-system, sans-serif"; ctx.textAlign = "center"; ctx.fillText("N", centerX, 13);
}

function updateFraming() {
  const target = activeTarget();
  const camera = state.prefs.cameras[Number($("frameCamera").value)] || state.prefs.cameras[0];
  const focal = finite($("frameFocal").value, 0);
  $("frameRotationLabel").textContent = `${finite($("frameRotation").value, 0)}°`;
  $("chartTargetName").textContent = target ? target.name : "Target center";
  if (camera && focal > 0) {
    $("frameFov").textContent = `${fieldOfView(camera.sensor_width, focal).toFixed(2)}° × ${fieldOfView(camera.sensor_height, focal).toFixed(2)}°`;
  } else $("frameFov").textContent = "Add camera and focal length";
  $("frameTargetSize").textContent = target ? `${target.size_deg[0]}° × ${target.size_deg[1]}° · ${target.type}` : "Choose a catalog target";
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
    const item = { name: $("newCameraName").value.trim(), sensor_width: finite($("newCameraWidth").value), sensor_height: finite($("newCameraHeight").value), pixel_size_um: finite($("newCameraPixel").value) };
    if (!item.name || !validCamera(item)) { toast("Enter a name and valid sensor dimensions."); return; }
    state.prefs.cameras.push(item);
    for (const id of ["newCameraName", "newCameraWidth", "newCameraHeight", "newCameraPixel"]) $(id).value = "";
  } else {
    const item = { name: $("newLensName").value.trim(), focal_length: finite($("newLensFocal").value), f_ratio: finite($("newLensRatio").value) };
    if (!item.name || !validLens(item)) { toast("Enter a name, focal length, and f-number."); return; }
    state.prefs.lenses.push(item);
    for (const id of ["newLensName", "newLensFocal", "newLensRatio"]) $(id).value = "";
  }
  savePreferences(); populateGear(); toast(`${kind === "camera" ? "Camera" : "Lens / telescope"} added.`);
}

function downloadGear() {
  const file = new Blob([JSON.stringify(state.prefs, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(file); link.download = "astroapp-gear.json";
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
    state.prefs = { cameras: incoming.cameras.slice(0, 40), lenses: incoming.lenses.slice(0, 60), site: site ? { name: site.name.slice(0, 60), lat: Number(site.lat), lon: Number(site.lon) } : state.prefs.site };
    if (site) state.siteConfigured = Boolean(site.name.trim() && site.name !== "Set observing site");
    state.mapPin = state.siteConfigured ? state.prefs.site : null;
    savePreferences(); updateSiteLabels(); populateGear(); renderSky(); toast("Gear file imported.");
    if (state.mapImage && state.siteConfigured) focusMapOn(state.prefs.site.lat, state.prefs.site.lon, Math.max(state.mapZoom, 1.2));
  } catch (error) { toast(error.message || "Could not read that gear file."); }
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
  $("mapZoomIn").addEventListener("click", () => changeMapZoom(state.mapZoom * 1.45));
  $("mapZoomOut").addEventListener("click", () => changeMapZoom(state.mapZoom / 1.45));
  $("saveMapPin").addEventListener("click", () => {
    if (!state.mapPin) return;
    state.prefs.site = { name: "Pinned location", lat: state.mapPin.lat, lon: state.mapPin.lon };
    state.siteConfigured = true;
    savePreferences(); updateSiteLabels(); renderSky(); toast("Map pin saved as your observing site.");
  });
  setupMapPointerEvents();
  $("frameTargetSearch").addEventListener("change", (event) => selectTarget(event.currentTarget.value));
  $("frameTargetSearch").addEventListener("input", (event) => {
    const match = state.targets.find((item) => item.name.toLocaleLowerCase() === event.currentTarget.value.trim().toLocaleLowerCase());
    if (match) { state.selectedTarget = match; updateFraming(); }
  });
  $("frameCamera").addEventListener("change", updateFraming);
  $("frameLens").addEventListener("change", () => {
    const lens = state.prefs.lenses[Number($("frameLens").value)];
    if (lens) $("frameFocal").value = lens.focal_length;
    updateFraming();
  });
  $("frameFocal").addEventListener("input", updateFraming);
  $("frameRotation").addEventListener("input", updateFraming);
  dom.targets.addEventListener("click", (event) => {
    const row = event.target.closest("[data-target]");
    if (row) { selectTarget(row.dataset.target); activateScreen("framing"); }
  });
  $("saveSite").addEventListener("click", saveSiteFromFields);
  $("addCamera").addEventListener("click", () => addGear("camera"));
  $("addLens").addEventListener("click", () => addGear("lens"));
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
  window.addEventListener("online", () => { if (!state.offlineReady) setupOffline(); });
}

function changeDate(days) {
  const date = dateAtLocalNoon(dom.date.value || localDateISO());
  date.setDate(date.getDate() + days); dom.date.value = localDateISO(date); renderSky();
}

async function init() {
  try {
    const [defaults, targetData, stars] = await Promise.all([
      fetch("./data/default-settings.json").then((response) => { if (!response.ok) throw new Error("Settings file unavailable"); return response.json(); }),
      fetch("./data/deep-sky-targets.json").then((response) => { if (!response.ok) throw new Error("Target catalog unavailable"); return response.json(); }),
      fetch("./data/stars-mag65.json").then((response) => { if (!response.ok) throw new Error("Star catalog unavailable"); return response.json(); }),
    ]);
    state.defaults = defaults;
    state.prefs.cameras = Array.isArray(defaults.cameras) ? defaults.cameras.filter(validCamera) : [];
    state.prefs.lenses = Array.isArray(defaults.lenses) ? defaults.lenses.filter(validLens) : [];
    state.targets = Object.entries(targetData).filter(([, item]) => Number.isFinite(item.ra) && Number.isFinite(item.dec) && Array.isArray(item.size_deg))
      .map(([name, item]) => ({ name, ra: item.ra, dec: item.dec, size_deg: item.size_deg, type: item.type || "Deep sky object" }));
    state.stars = stars.filter((star) => Array.isArray(star) && Number.isFinite(star[1]) && Number.isFinite(star[2]));
    loadPreferences();
  } catch (error) {
    renderOfflineStatus("Local data unavailable", "error");
    toast("AstroApp could not load its bundled sky data. Reopen while online to finish setup.");
    console.error(error);
  }
  updateSiteLabels();
  dom.date.value = localDateISO();
  renderZoneLegend(); fillTargetOptions(); populateGear();
  const initialTarget = activeTarget(); if (initialTarget) $("frameTargetSearch").value = initialTarget.name;
  renderSky(); bindEvents();
  const site = state.prefs.site;
  setMapArea(site.lat >= 7 && site.lat <= 75 && site.lon >= -180 && site.lon <= -51 ? "north-america" : "world", true);
  setupOffline();
}

init();
