"use strict";

const TZ = "Europe/Berlin";

const PLACES_KEY = "commute:places";
const ROUTE_KEY = "commute:route";
const SETTINGS_KEY = "commute:settings";
const SAVED_KEY = "commute:saved";
const LAST_KEY = "commute:last";

const SEED_PLACES = [
  {
    id: "seed-home",
    name: "Home",
    address: "",
    isHome: true,
    stations: [
      { stopId: "91000300", label: "München, Moosach", lat: 48.1808, lon: 11.5076, walkMin: 12, bikeMin: 6, distanceMeters: 1069 },
    ],
  },
  {
    id: "seed-work1",
    name: "BMW Garching",
    address: "",
    isHome: false,
    stations: [
      { stopId: "1002009", label: "Hochbrück (Obb), Carl-von-Linde-Straße", lat: 48.2503, lon: 11.6085, walkMin: 5, bikeMin: Infinity, distanceMeters: 170 },
      { stopId: "1002012", label: "Hochbrück (Obb), Voithstraße", lat: 48.2504, lon: 11.6129, walkMin: 10, bikeMin: Infinity, distanceMeters: 400 },
    ],
  },
  {
    id: "seed-work2",
    name: "BMW FIZ",
    address: "",
    isHome: false,
    stations: [
      { stopId: "91000760", label: "München, Am Hart", lat: 48.1967, lon: 11.5718, walkMin: 8, bikeMin: Infinity, distanceMeters: 612 },
    ],
  },
];

const DEFAULT_SETTINGS = { maxBikeMinutes: 20, useStart: false, startValue: "", travelMode: "auto" };

const ACCESS_LABEL = { walk: "Walk", bike: "Bike" };
const MODE_LABEL = { auto: "Auto", bike: "Bike forced", transit: "Transit only" };

const state = {
  places: [],
  gpsPlace: null,
  route: { fromId: null, toId: null },
  savedCommutes: [],
  pickerSide: "from",
  searchTimer: null,
  data: null,
  offlineData: null,
  timer: null,
  settings: loadSettings(),
};

// ---------------------------------------------------------------- storage

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}
function saveSettings(s) {
  state.settings = s;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
function loadPlaces() {
  try {
    const raw = localStorage.getItem(PLACES_KEY);
    if (raw) {
      const places = JSON.parse(raw);
      if (Array.isArray(places) && places.length > 0) return places;
    }
  } catch {}
  return SEED_PLACES.map((p) => JSON.parse(JSON.stringify(p)));
}
function savePlaces() {
  try { localStorage.setItem(PLACES_KEY, JSON.stringify(state.places)); } catch {}
}
function loadRoute() {
  try {
    const r = JSON.parse(localStorage.getItem(ROUTE_KEY) || "{}");
    if (r && r.fromId && r.toId) return { fromId: r.fromId, toId: r.toId };
  } catch {}
  return { fromId: state.places.find((p) => p.isHome)?.id ?? state.places[0]?.id, toId: state.places.find((p) => !p.isHome)?.id ?? state.places[1]?.id };
}
function saveRoute() {
  try { localStorage.setItem(ROUTE_KEY, JSON.stringify(state.route)); } catch {}
}
function loadSaved() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (raw) {
      const a = JSON.parse(raw);
      if (Array.isArray(a)) return a;
    }
  } catch {}
  return [];
}
function saveSaved() {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(state.savedCommutes)); } catch {}
}

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function placeById(id) {
  if (id === "gps" && state.gpsPlace) return state.gpsPlace;
  return state.places.find((p) => p.id === id);
}

// ---------------------------------------------------------------- time

function berlinTime(date) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
function berlinClock(dateStr) {
  return berlinTime(new Date(dateStr));
}
function minutesLabel(m) {
  return `${Math.round(m)} min`;
}

// ---------------------------------------------------------------- leg rendering

function dotClass(product, number) {
  const p = (product || "").toLowerCase();
  if (p.includes("u-bahn")) return "u";
  if (p.includes("s-bahn")) return "s";
  if (p.includes("tram")) return "tram";
  if (p.includes("bus")) return number && number.startsWith("X") ? "x" : "bus";
  if (p.includes("fussweg")) return "walk";
  return "x";
}

function shortDotText(leg) {
  const p = (leg.product || "").toLowerCase();
  const n = leg.number || "";
  if (p.includes("u-bahn")) return "U" + n.replace(/^u/i, "");
  if (p.includes("s-bahn")) return n;
  if (n) return n.startsWith("X") ? "X" : n.slice(0, 3);
  return p.slice(0, 1).toUpperCase();
}

function renderWeather(w, travelMode, fromName) {
  const box = $("#weather");
  box.classList.remove("hidden");
  box.innerHTML = "";

  box.appendChild(el("div", "w-kicker", `Now at ${fromName || "your location"}`));

  const reading = el("div", "w-reading");
  reading.appendChild(el("span", "w-temp", `${Math.round(w.tempNow)}C`));
  reading.appendChild(el("span", "w-feels", `feels ${Math.round(w.apparentTempNow)}C`));
  box.appendChild(reading);

  const forcedBike = travelMode === "bike" && !w.bikeAllowed;
  const verdict = el("div", "w-verdict");
  if (w.bikeAllowed && !forcedBike) {
    verdict.textContent = "Bike friendly";
    verdict.className = "w-verdict good";
  } else if (forcedBike) {
    verdict.textContent = "Bike forced - weather is rough!";
    verdict.className = "w-verdict warn";
  } else if (w.blockedBy.includes("rain") && w.blockedBy.includes("cold")) {
    verdict.textContent = "Too cold and rainy to bike";
    verdict.className = "w-verdict bad";
  } else if (w.blockedBy.includes("rain")) {
    verdict.textContent = "Rain - take transit";
    verdict.className = "w-verdict bad";
  } else {
    verdict.textContent = "Under 5C - take transit";
    verdict.className = "w-verdict warn";
  }
  box.appendChild(verdict);

  const parts = [];
  if (w.precipProbMax > 0) parts.push(`rain ${Math.round(w.precipProbMax)}%`);
  if (w.precipMax > 0) parts.push(`${w.precipMax.toFixed(1)} mm`);
  if (w.windMax > 0) parts.push(`wind ${Math.round(w.windMax)} km/h`);
  parts.push(`low ${Math.round(w.tempMin)}C next 2h`);
  box.appendChild(el("div", "w-detail", parts.join("  |  ")));
}

function renderOptions(data) {
  const box = $("#options");
  box.innerHTML = "";

  if (data.options.length === 0) {
    if (data.travelMode === "bike") {
      box.appendChild(el("p", "loading", "No bike options - origin must be HOME"));
    } else {
      box.appendChild(el("p", "loading", "No transit/bike options right now."));
    }
    return;
  }

  data.options.forEach((opt, i) => {
    const card = el("article", `option${i === 0 ? " best" : ""}`);
    card.appendChild(renderHead(opt, i === 0, data));
    card.appendChild(renderLegs(opt, data));
    box.appendChild(card);
  });
}

function renderHead(opt, isBest, data) {
  const head = el("div", "option-head");

  const main = el("div", "option-main");

  const arrival = el("div", "opt-arrival");
  arrival.appendChild(el("span", "", berlinClock(opt.arriveAt)));
  if (opt.realtimeArrival && opt.totalDelayMin > 0) {
    arrival.appendChild(el("div", "late", `+${opt.totalDelayMin}'`));
  } else if (opt.realtimeArrival) {
    arrival.appendChild(el("div", "arr-min", "live"));
  }
  main.appendChild(arrival);

  const mid = el("div", "opt-mid");
  const title = el("div", "opt-title", `${data.fromName} > ${data.toName}`);
  if (isBest) title.appendChild(el("span", "opt-best-tag", "Fastest"));
  mid.appendChild(title);

  const route = el("div", "opt-lines", opt.kind === "bike" ? "Bike all the way" : opt.title);
  mid.appendChild(route);

  if (opt.hasDelay) {
    const d = el("div", "opt-sub");
    d.appendChild(el("span", "delay", `! ${opt.totalDelayMin > 0 ? "+" : ""}${opt.totalDelayMin}' delay`));
    mid.appendChild(d);
  }

  main.appendChild(mid);

  const total = el("div", "opt-total");
  total.appendChild(el("div", "big", minutesLabel(opt.totalMin)));
  total.appendChild(el("div", "lbl", "total"));
  main.appendChild(total);
  head.appendChild(main);

  const timing = el("div", "option-timing");
  const leave = el("div", "opt-leave");
  leave.appendChild(el("span", "opt-leave-lbl", "leave"));
  leave.appendChild(el("span", "opt-leave-time", berlinClock(opt.leaveAt)));
  timing.appendChild(leave);
  const timingDetail = `${ACCESS_LABEL[opt.originAccess.mode]} ${opt.originAccess.minutes}'${opt.egress.mode === "bike" ? ` | bike ${opt.egress.minutes}' home` : ""}`;
  timing.appendChild(el("span", "timing-detail", timingDetail));
  head.appendChild(timing);

  return head;
}

function renderLegs(opt, data) {
  const wrap = el("div", "legs");
  if (opt.kind === "bike") {
    const leg = el("div", "leg bike");
    const rail = el("div", "rail");
    rail.appendChild(el("div", "dot", ""));
    rail.appendChild(el("div", "line"));
    leg.appendChild(rail);
    const body = el("div", "body");
    body.appendChild(el("div", "access-title", `Bike ${opt.originAccess.minutes}'`));
    body.appendChild(el("div", "access-route", `${data.fromName} > ${data.toName}`));
    wrap.appendChild(leg);
    return wrap;
  }

  if (opt.originAccess && opt.originAccess.minutes > 0) {
    wrap.appendChild(accessLeg(opt.originAccess.mode, opt.originAccess.minutes, data.fromName, firstStationName(opt)));
  }

  for (let i = 0; i < opt.legs.length; i += 1) {
    const leg = opt.legs[i];
    const hasFollowingTransit = opt.legs.slice(i + 1).some((item) => item.type === "transit");
    wrap.appendChild(legRow(leg, hasFollowingTransit));
  }

  if (opt.egress && opt.egress.minutes > 0) {
    wrap.appendChild(accessLeg(opt.egress.mode, opt.egress.minutes, lastStationName(opt), data.toName));
  }

  return wrap;
}

function firstStationName(opt) {
  const first = opt.legs.find((l) => l.type === "transit");
  return first ? first.from : "";
}
function lastStationName(opt) {
  const last = [...opt.legs].reverse().find((l) => l.type === "transit");
  return last ? last.to : "";
}

function accessLeg(mode, minutes, from, to) {
  const leg = el("div", `leg ${mode === "bike" ? "bike" : "walk"}`);
  const rail = el("div", "rail");
  rail.appendChild(el("div", "dot", ""));
  rail.appendChild(el("div", "line"));
  leg.appendChild(rail);
  const body = el("div", "body");
  body.appendChild(el("div", "access-title", `${ACCESS_LABEL[mode]} ${minutes}'`));
  body.appendChild(el("div", "access-route", `${from} > ${to}`));
  leg.appendChild(body);
  return leg;
}

function legRow(leg, hasFollowingTransit = false) {
  const isTransferWalk = leg.type === "walk" && Boolean(leg.from);
  const div = el("div", `leg ${leg.type}${isTransferWalk ? " transfer" : ""}`);
  const rail = el("div", "rail");

  if (leg.type === "walk") {
    rail.appendChild(el("div", "dot", ""));
    rail.appendChild(el("div", "line"));
    div.appendChild(rail);
    const body = el("div", "body");
    const row = el("div", "row");
    row.appendChild(el("span", "t", ""));
    const lbl = leg.to ? `${leg.from} > ${leg.to}` : leg.from;
    row.appendChild(el("span", "place", `${isTransferWalk ? "Change" : "Walk"} ${leg.minutes}'${lbl ? " | " + lbl : ""}`));
    body.appendChild(row);
    div.appendChild(body);
    return div;
  }

  const dotCls = dotClass(leg.product, leg.number);
  const dot = el("div", `dot ${dotCls}`, shortDotText(leg));
  rail.appendChild(dot);
  rail.appendChild(el("div", "line"));
  div.appendChild(rail);

  const body = el("div", "body");
  const row = el("div", "row");
  const t = el("span", `t${leg.delayMin !== 0 ? " rt" : ""}`, berlinClock(leg.departAt));
  row.appendChild(t);
  row.appendChild(el("span", "place", leg.from));
  if (leg.platform) row.appendChild(el("span", "plat", `Pl. ${leg.platform}`));
  if (leg.delayMin !== 0) {
    row.appendChild(el("span", "badge delay", `${leg.delayMin > 0 ? "+" : ""}${leg.delayMin}'`));
  }
  body.appendChild(row);

  const row2 = el("div", "row");
  row2.appendChild(el("span", `t${leg.delayMin !== 0 ? " rt" : ""}`, berlinClock(leg.arriveAt)));
  row2.appendChild(el("span", "place", leg.to));
  if (hasFollowingTransit) row2.appendChild(el("span", "hub-badge", "Change"));
  body.appendChild(row2);

  const notes = el("div", "notes", `${leg.product} ${leg.number} > ${leg.destination}`);
  body.appendChild(notes);

  div.appendChild(body);
  return div;
}

function renderError(msg) {
  $("#options").innerHTML = "";
  const e = $("#error");
  e.classList.remove("hidden");
  e.textContent = msg;
}
function renderStale() {
  $("#stale").classList.remove("hidden");
}

// ---------------------------------------------------------------- route picker

function renderRouteButtons() {
  const from = placeById(state.route.fromId);
  const to = placeById(state.route.toId);
  $("#from-btn").innerHTML = "";
  $("#to-btn").innerHTML = "";
  $("#from-btn").appendChild(el("span", "pb-label", "from"));
  $("#from-btn").appendChild(el("span", "pb-name", from ? from.name : "Choose"));
  if (state.route.fromId === "gps" && from) appendGpsTag($("#from-btn"));
  $("#to-btn").appendChild(el("span", "pb-label", "to"));
  $("#to-btn").appendChild(el("span", "pb-name", to ? to.name : "Choose"));
  if (state.route.toId === "gps" && to) appendGpsTag($("#to-btn"));
}

function appendGpsTag(btn) {
  btn.appendChild(el("span", "gps-tag", "GPS"));
}

function openPicker(side) {
  state.pickerSide = side;
  document.body.classList.add("sheet-open");
  $("#picker-title").textContent = side === "from" ? "Start" : "Destination";
  $("#picker-search").value = "";
  $("#picker-results").classList.add("hidden");
  $("#picker-results").innerHTML = "";
  $("#gps-status").classList.add("hidden");
  $("#gps-status").textContent = "";
  renderSavedPlaces();
  $("#picker-sheet").classList.remove("hidden");
  $("#settings-overlay").classList.remove("hidden");
  setTimeout(() => $("#picker-search").focus(), 50);
}
function closePicker() {
  $("#picker-sheet").classList.add("hidden");
  $("#settings-overlay").classList.add("hidden");
  document.body.classList.remove("sheet-open");
}

function renderSavedPlaces() {
  const box = $("#picker-saved");
  box.innerHTML = "";
  if (state.places.length === 0) return;
  box.appendChild(el("div", "picker-section", "Saved places"));

  for (const p of state.places) {
    const row = el("button", "place-row");
    row.addEventListener("click", () => selectPlace(p.id));

    const name = el("span", "pr-name", p.name);
    if (p.isHome) name.appendChild(el("span", "pr-home", "home"));
    row.appendChild(name);

    const station = el("span", "pr-station", p.stations[0] ? p.stations[0].label : "");
    row.appendChild(station);

    if (p.isHome) {
      row.appendChild(el("span", "set-home is-home", "HOME"));
    } else {
      const btn = el("button", "set-home", "SET HOME");
      btn.setAttribute("aria-label", `Set ${p.name} as home`);
      btn.title = "Set as home - enables bike options";
      btn.addEventListener("click", (e) => { e.stopPropagation(); setHome(p.id); });
      row.appendChild(btn);
    }

    const del = el("span", "pr-del", "X");
    del.addEventListener("click", (e) => { e.stopPropagation(); deletePlace(p.id); });
    row.appendChild(del);

    box.appendChild(row);
  }
}

function selectPlace(id) {
  if (!placeById(id)) return;
  if (state.pickerSide === "from") state.route.fromId = id;
  else state.route.toId = id;
  saveRoute();
  closePicker();
  renderRouteButtons();
  load();
}

function setHome(id) {
  const p = placeById(id);
  if (!p || p.isHome) return;
  for (const other of state.places) if (other.id !== id) other.isHome = false;
  p.isHome = true;
  savePlaces();
  renderSavedPlaces();
  renderRouteButtons();
  load();
}

function deletePlace(id) {
  if (state.places.length <= 1) return;
  const idx = state.places.findIndex((p) => p.id === id);
  if (idx === -1) return;
  state.places.splice(idx, 1);
  savePlaces();
  if (state.route.fromId === id) state.route.fromId = null;
  if (state.route.toId === id) state.route.toId = null;
  if (!state.route.fromId) state.route.fromId = state.places[0]?.id ?? null;
  if (!state.route.toId) state.route.toId = state.places.find((p) => p.id !== state.route.fromId)?.id ?? state.places[1]?.id ?? null;
  saveRoute();
  renderSavedPlaces();
  renderRouteButtons();
  load();
}

function swapRoute() {
  const f = state.route.fromId;
  state.route.fromId = state.route.toId;
  state.route.toId = f;
  saveRoute();
  renderRouteButtons();
  load();
}

// ---------------------------------------------------------------- saved commutes

function commuteName() {
  const from = placeById(state.route.fromId);
  const to = placeById(state.route.toId);
  return `${from ? from.name : "?"} > ${to ? to.name : "?"}`;
}

function saveCurrentCommute() {
  if (!placeById(state.route.fromId) || !placeById(state.route.toId)) return;
  const name = commuteName();
  // Don't duplicate an identical saved commute.
  const existing = state.savedCommutes.find(
    (c) => c.fromId === state.route.fromId && c.toId === state.route.toId,
  );
  if (!existing) {
    state.savedCommutes.push({
      id: "c-" + Date.now(),
      name,
      fromId: state.route.fromId,
      toId: state.route.toId,
    });
    saveSaved();
  }
  renderSavedCommutes();
}

function selectSavedCommute(id) {
  const c = state.savedCommutes.find((x) => x.id === id);
  if (!c || !placeById(c.fromId) || !placeById(c.toId)) return;
  state.route = { fromId: c.fromId, toId: c.toId };
  saveRoute();
  renderRouteButtons();
  renderSavedCommutes();
  load();
}

function deleteSavedCommute(id) {
  state.savedCommutes = state.savedCommutes.filter((x) => x.id !== id);
  saveSaved();
  renderSavedCommutes();
}

function renderSavedCommutes() {
  const box = $("#saved-commutes");
  box.innerHTML = "";

  const saveBtn = el("button", "sc-save", "SAVE ROUTE");
  saveBtn.title = "Save current start and destination";
  saveBtn.addEventListener("click", saveCurrentCommute);
  box.appendChild(saveBtn);

  if (state.savedCommutes.length === 0) return;

  for (const c of state.savedCommutes) {
    const active = c.fromId === state.route.fromId && c.toId === state.route.toId;
    const chip = el("button", `sc-chip${active ? " active" : ""}`);
    chip.setAttribute("role", "listitem");
    chip.addEventListener("click", () => selectSavedCommute(c.id));

    chip.appendChild(el("span", "sc-name", c.name));

    const del = el("span", "sc-del", "X");
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteSavedCommute(c.id); });
    chip.appendChild(del);

    box.appendChild(chip);
  }
}

// ---------------------------------------------------------------- search

function onSearchInput() {
  clearTimeout(state.searchTimer);
  const q = $("#picker-search").value.trim();
  const results = $("#picker-results");
  if (q.length < 2) {
    results.classList.add("hidden");
    results.innerHTML = "";
    return;
  }
  state.searchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      renderSearchResults(data.results || []);
    } catch {
      results.innerHTML = "";
      results.appendChild(el("p", "loading", "Search failed"));
    }
  }, 350);
}

function renderSearchResults(results) {
  const box = $("#picker-results");
  box.innerHTML = "";
  if (results.length === 0) {
    box.appendChild(el("p", "loading", "Nothing found - try a station or street"));
    box.classList.remove("hidden");
    return;
  }
  box.classList.remove("hidden");
  for (const r of results) {
    const row = el("button", "place-row");
    row.addEventListener("click", () => selectSearchResult(r));

    const name = el("span", "pr-name", r.name);
    if (r.kind === "stop") name.appendChild(el("span", "pr-home", "station"));
    row.appendChild(name);

    row.appendChild(el("span", "pr-station", kindLabel(r.kind)));
    box.appendChild(row);
  }
}

function kindLabel(kind) {
  if (kind === "stop") return "MVV stop";
  if (kind === "place") return "place";
  return "address";
}

async function selectSearchResult(r) {
  let place;
  if (r.kind === "stop") {
    let lat = r.lat, lon = r.lon;
    if (lat == null || lon == null) {
      try {
        const res = await fetch(`/api/station?stopId=${r.stopId}`);
        const data = await res.json();
        if (data.station) { lat = data.station.lat; lon = data.station.lon; }
      } catch {}
    }
    place = {
      id: "p-" + Date.now(),
      name: r.name,
      address: r.name,
      isHome: false,
      stations: [{ stopId: r.stopId, label: r.name, lat, lon, walkMin: 0, bikeMin: Infinity, distanceMeters: 0 }],
    };
  } else {
    const stations = await resolveStations(r.lat, r.lon);
    if (stations.length === 0) return;
    place = {
      id: "p-" + Date.now(),
      name: r.name,
      address: r.name,
      lat: r.lat,
      lon: r.lon,
      isHome: false,
      stations,
    };
  }
  addPlaceAndSelect(place);
}

async function resolveStations(lat, lon) {
  try {
    const res = await fetch(`/api/stations?lat=${lat}&lon=${lon}`);
    const data = await res.json();
    return data.stations || [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- GPS location

function setGpsStatus(msg, isError) {
  const s = $("#gps-status");
  s.textContent = msg;
  s.classList.toggle("hidden", !msg);
  s.classList.toggle("gps-error", Boolean(isError));
}

function gpsErrorText(code) {
  if (code === 1) return "Location permission denied - allow it in your browser";
  if (code === 2) return "Location unavailable - try again";
  if (code === 3) return "Location timed out - check GPS and try again";
  return "Couldn't get your location";
}

function useCurrentLocation() {
  const btn = $("#picker-gps");
  btn.disabled = true;
  setGpsStatus("Locating...");
  if (!("geolocation" in navigator)) {
    btn.disabled = false;
    setGpsStatus("GPS not supported on this device", true);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        setGpsStatus("Finding nearby stations...");
        const [revRes, stRes] = await Promise.all([
          fetch(`/api/reverse?lat=${lat}&lon=${lon}`),
          fetch(`/api/stations?lat=${lat}&lon=${lon}`),
        ]);
        const rev = await revRes.json().catch(() => ({}));
        const st = await stRes.json().catch(() => ({ stations: [] }));
        const stations = st.stations || [];
        if (stations.length === 0) {
          setGpsStatus("No nearby MVV stations found", true);
          return;
        }
        state.gpsPlace = {
          id: "gps",
          name: (rev.name || "Current location").slice(0, 60),
          address: "",
          lat,
          lon,
          isHome: false,
          stations,
        };
        selectPlace("gps");
      } catch {
        setGpsStatus("Couldn't resolve location", true);
      } finally {
        btn.disabled = false;
      }
    },
    (err) => {
      btn.disabled = false;
      setGpsStatus(gpsErrorText(err && err.code), true);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
}

/** Re-fix the GPS position if the route references it (silent on failure). */
async function refreshGpsIfNeeded() {
  if (state.route.fromId !== "gps" && state.route.toId !== "gps") return;
  if (!("geolocation" in navigator)) {
    fallbackFromGps();
    return;
  }
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }),
    );
    const { latitude: lat, longitude: lon } = pos.coords;
    const [revRes, stRes] = await Promise.all([
      fetch(`/api/reverse?lat=${lat}&lon=${lon}`),
      fetch(`/api/stations?lat=${lat}&lon=${lon}`),
    ]);
    const rev = await revRes.json().catch(() => ({}));
    const st = await stRes.json().catch(() => ({ stations: [] }));
    const stations = st.stations || [];
    if (stations.length === 0) {
      fallbackFromGps();
      return;
    }
    state.gpsPlace = {
      id: "gps",
      name: (rev.name || "Current location").slice(0, 60),
      address: "",
      lat,
      lon,
      isHome: false,
      stations,
    };
  } catch {
    fallbackFromGps();
  }
}

function fallbackFromGps() {
  state.gpsPlace = null;
  if (state.route.fromId === "gps") state.route.fromId = state.places[0]?.id ?? null;
  if (state.route.toId === "gps") state.route.toId = state.places.find((p) => p.id !== state.route.fromId)?.id ?? state.places[1]?.id ?? null;
  saveRoute();
}

function addPlaceAndSelect(place) {
  // Dedupe: if a place with the same primary stop exists, select it instead.
  const existing = state.places.find((p) => p.stations[0]?.stopId === place.stations[0]?.stopId);
  const id = existing ? existing.id : place.id;
  if (!existing) {
    state.places.push(place);
    savePlaces();
  }
  selectPlace(id);
}

// ---------------------------------------------------------------- data

async function load() {
  clearTimeout(state.timer);
  const box = $("#options");
  box.innerHTML = "";
  box.appendChild(el("p", "loading", "Loading..."));

  const from = placeById(state.route.fromId);
  const to = placeById(state.route.toId);
  if (!from || !to) {
    box.innerHTML = "";
    box.appendChild(el("p", "loading", "Pick a start and destination."));
    return;
  }

  const body = {
    from,
    to,
    maxBikeMinutes: state.settings.maxBikeMinutes,
    travelMode: state.settings.travelMode,
  };
  if (state.settings.useStart && state.settings.startValue) {
    body.start = new Date(state.settings.startValue).toISOString();
  }

  try {
    const res = await fetch("/api/commute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state.data = data;
    localStorage.setItem(LAST_KEY, JSON.stringify({ at: Date.now(), data }));
    $("#error").classList.add("hidden");
    $("#stale").classList.add("hidden");
    render();
  } catch (err) {
    const offline = readOffline();
    if (offline) {
      state.offlineData = offline;
      $("#error").classList.add("hidden");
      renderStale();
      render();
    } else {
      renderError(`Couldn't load live data: ${err.message}`);
    }
  } finally {
    state.timer = setTimeout(load, 60_000);
  }
}

function readOffline() {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    if (data.from === state.route.fromId && data.to === state.route.toId) {
      data._stale = true;
      data._staleAt = at;
      return data;
    }
  } catch {}
  return null;
}

function render() {
  const data = state.offlineData || state.data;
  if (!data) return;
  if (data.weather) renderWeather(data.weather, data.travelMode, data.fromName);

  const updated = $("#updated");
  if (data._stale) {
    updated.textContent = "Stale data";
  } else if (data.startTime) {
    updated.textContent = `Depart ${berlinClock(data.startTime)}`;
  } else {
    updated.textContent = `Live | ${berlinTime(new Date(data.generatedAt))}`;
  }

  renderPrefs(data);
  renderOptions(data);
}

function renderPrefs(data) {
  const prefs = $("#prefs");
  const chips = [];
  if (data.maxBikeMinutes && data.maxBikeMinutes !== 20) {
    chips.push(`Max bike ${data.maxBikeMinutes} min`);
  }
  if (data.travelMode && data.travelMode !== "auto") {
    chips.push(MODE_LABEL[data.travelMode] || data.travelMode);
  }
  if (chips.length === 0) {
    prefs.classList.add("hidden");
    prefs.innerHTML = "";
  } else {
    prefs.classList.remove("hidden");
    prefs.innerHTML = "";
    chips.forEach((c) => prefs.appendChild(el("span", "chip", c)));
  }
}

// ---------------------------------------------------------------- depart + settings

function setDepart(useStart, startValue) {
  saveSettings({ ...state.settings, useStart, startValue: useStart ? startValue : "" });
  const input = $("#depart-input");
  const nowBtn = $("#depart-now");
  const atBtn = $("#depart-at");
  input.hidden = !useStart;
  nowBtn.setAttribute("aria-pressed", String(!useStart));
  atBtn.setAttribute("aria-pressed", String(useStart));
  nowBtn.classList.toggle("active", !useStart);
  atBtn.classList.toggle("active", useStart);
  if (useStart) {
    input.value = startValue;
    input.focus();
  }
}

function defaultStartValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return toLocalInputValue(d);
}

/** True when a stored datetime-local value has already passed. */
function isPastStart(v) {
  const t = new Date(v).getTime();
  return Number.isNaN(t) || t <= Date.now();
}

function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initDepart() {
  const s = state.settings;
  // A stored start time in the past is stale — reset to "now" so the app
  // reflects the user's current time instead of an old value.
  const useStart = s.useStart && s.startValue && !isPastStart(s.startValue);
  setDepart(useStart, useStart ? s.startValue : "");

  $("#depart-now").addEventListener("click", () => { setDepart(false, ""); load(); });
  $("#depart-at").addEventListener("click", () => {
    // Default to the next full hour unless the user has a valid future time set.
    const v = state.settings.startValue && !isPastStart(state.settings.startValue)
      ? state.settings.startValue
      : defaultStartValue();
    setDepart(true, v);
    try { $("#depart-input").showPicker && $("#depart-input").showPicker(); } catch {}
  });
  $("#depart-input").addEventListener("change", () => {
    if ($("#depart-input").value) {
      saveSettings({ ...state.settings, useStart: true, startValue: $("#depart-input").value });
      load();
    }
  });
}

function openSettings() {
  document.body.classList.add("sheet-open");
  $("#max-bike").value = state.settings.maxBikeMinutes;
  $("#settings-sheet").classList.remove("hidden");
  $("#settings-overlay").classList.remove("hidden");
}
function closeSettings() {
  $("#settings-sheet").classList.add("hidden");
  $("#settings-overlay").classList.add("hidden");
  document.body.classList.remove("sheet-open");
}
function saveSettingsFromForm() {
  const max = Math.min(240, Math.max(1, Math.round(Number($("#max-bike").value) || DEFAULT_SETTINGS.maxBikeMinutes)));
  saveSettings({ ...state.settings, maxBikeMinutes: max });
  closeSettings();
  load();
}
function resetSettings() {
  saveSettings({ ...DEFAULT_SETTINGS });
  setDepart(false, "");
  setTravelMode("auto");
  closeSettings();
  load();
}

function initSettings() {
  $("#settings-btn").addEventListener("click", openSettings);
  $("#settings-close").addEventListener("click", closeSettings);
  $("#settings-save").addEventListener("click", saveSettingsFromForm);
  $("#settings-reset").addEventListener("click", resetSettings);
}

// ---------------------------------------------------------------- travel mode

function setTravelMode(mode) {
  saveSettings({ ...state.settings, travelMode: mode });
  ["auto", "bike", "transit"].forEach((m) => {
    const btn = $(`#mode-${m}`);
    btn.classList.toggle("active", m === mode);
    btn.setAttribute("aria-pressed", String(m === mode));
  });
}

function initMode() {
  setTravelMode(state.settings.travelMode || "auto");
  $("#mode-auto").addEventListener("click", () => { setTravelMode("auto"); load(); });
  $("#mode-bike").addEventListener("click", () => { setTravelMode("bike"); load(); });
  $("#mode-transit").addEventListener("click", () => { setTravelMode("transit"); load(); });
}

// ---------------------------------------------------------------- init

function init() {
  state.places = loadPlaces();
  state.savedCommutes = loadSaved();
  if (!state.route.fromId || !state.route.toId) {
    state.route = loadRoute();
  }
  savePlaces(); // persist seed if it was just created

  renderRouteButtons();
  renderSavedCommutes();
  initDepart();
  initMode();
  initSettings();

  $("#from-btn").addEventListener("click", () => openPicker("from"));
  $("#to-btn").addEventListener("click", () => openPicker("to"));
  $("#swap-btn").addEventListener("click", swapRoute);
  $("#picker-close").addEventListener("click", closePicker);
  $("#picker-gps").addEventListener("click", useCurrentLocation);
  $("#settings-overlay").addEventListener("click", () => { closePicker(); closeSettings(); });
  $("#picker-search").addEventListener("input", onSearchInput);
  document.getElementById("refresh").addEventListener("click", load);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closePicker(); closeSettings(); }
  });

  refreshGpsIfNeeded().then(() => {
    renderRouteButtons();
    load();
  });
}

init();
