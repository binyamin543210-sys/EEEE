
// BNAPP Calendar LUX – app.js
// גרסת דפדפן נקייה – בלי build, עובדת ישירות מ-index.html

const BNAPP = {
  today: new Date(),
  viewYear: null,
  viewMonth: null, // 0-11
  city: {
    name: "Holon, Israel",
    lat: 32.0158,
    lon: 34.7874,
    tzid: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jerusalem",
  },
  events: {},     // { 'YYYY-MM-DD': [event,...] }
  holidays: {},   // { 'YYYY-MM-DD': { title, category } }
  shabbat: {},    // { 'YYYY-MM-DD': { candle: 'HH:MM', havdalah: 'HH:MM' } }
  weather: {},    // { 'YYYY-MM-DD': { ... } }
};

const hebrewDayFormatter = new Intl.DateTimeFormat("he-u-ca-hebrew", {
  day: "numeric",
  month: "short",
});
const hebrewMonthFormatter = new Intl.DateTimeFormat("he-u-ca-hebrew", {
  month: "long",
  year: "numeric",
});
const gregMonthFormatter = new Intl.DateTimeFormat("he-IL", {
  month: "long",
  year: "numeric",
});
const gregDateFormatter = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  weekday: "long",
});

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function cloneDate(d) {
  return new Date(d.getTime());
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function pad2(n) {
  return n.toString().padStart(2, "0");
}

function getWeekday(d) {
  // JS: 0=Sunday ... 6=Saturday
  return d.getDay();
}

// ---- Firebase helpers (db נוצר בקובץ firebase-config.js) ----

function dbRef(path) {
  if (typeof db === "undefined") return null;
  return db.ref(path);
}

function loadEventsFromFirebase() {
  const ref = dbRef("/events");
  if (!ref) return;
  ref.on("value", (snap) => {
    const val = snap.val() || {};
    BNAPP.events = val;
    renderCalendar();
  });
}

function saveEventToFirebase(key, evt) {
  const ref = dbRef("/events/" + key);
  if (!ref) return;
  const list = BNAPP.events[key] || [];
  list.push(evt);
  BNAPP.events[key] = list;
  ref.set(list);
}

// ---- Auto events: עבודה + אוכל ומקלחת ----

function getAutoEventsForDate(d) {
  const weekday = getWeekday(d); // 0=Sunday
  const auto = [];
  // ראשון–חמישי: עבודה 8–17 + אוכל 17–18:30
  if (weekday >= 0 && weekday <= 4) {
    auto.push({
      title: "עבודה",
      kind: "event",
      owner: "both",
      start: "08:00",
      end: "17:00",
      auto: true,
    });
    auto.push({
      title: "אוכל ומקלחת",
      kind: "event",
      owner: "both",
      start: "17:00",
      end: "18:30",
      auto: true,
    });
  }
  return auto;
}

// ---- Hebcal + GeoNames + Weather ----

async function fetchHolidaysForMonth(year, month) {
  // month: 0-11 -> API expects 1-12
  const m = month + 1;
  const url = `https://www.hebcal.com/hebcal?cfg=json&v=1&year=${year}&month=${m}&maj=on&min=on&mod=on&nx=on&ss=on&mf=on&c=on&geo=pos&latitude=${BNAPP.city.lat}&longitude=${BNAPP.city.lon}&tzid=${encodeURIComponent(
    BNAPP.city.tzid
  )}&m=50`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    const holidays = {};
    if (Array.isArray(json.items)) {
      for (const item of json.items) {
        if (!item.date || !item.title) continue;
        const key = item.date.slice(0, 10);
        // לא מסמנים כל הדלקת נרות כשבת כדי לא להציף
        holidays[key] = {
          title: item.title,
          category: item.category || null,
        };
      }
    }
    BNAPP.holidays = holidays;
  } catch (err) {
    console.error("holiday fetch failed", err);
  }
}

async function fetchShabbatForRange() {
  // לוקחים 2 חודשים קדימה
  const from = new Date(BNAPP.viewYear, BNAPP.viewMonth, 1);
  const to = new Date(BNAPP.viewYear, BNAPP.viewMonth + 2, 0);
  const isoFrom = from.toISOString().slice(0, 10);
  const isoTo = to.toISOString().slice(0, 10);
  const url = `https://www.hebcal.com/shabbat?cfg=json&geo=pos&latitude=${BNAPP.city.lat}&longitude=${BNAPP.city.lon}&tzid=${encodeURIComponent(
    BNAPP.city.tzid
  )}&m=50&start=${isoFrom}&end=${isoTo}`;
  const map = {};
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (Array.isArray(json.items)) {
      for (const item of json.items) {
        if (!item.date || !item.category) continue;
        const dKey = item.date.slice(0, 10);
        if (!map[dKey]) map[dKey] = {};
        if (item.category === "candles") {
          map[dKey].candle = item.title.replace(/.*?\s(\d\d?:\d\d).*/, "$1");
        } else if (item.category === "havdalah") {
          map[dKey].havdalah = item.title.replace(/.*?\s(\d\d?:\d\d).*/, "$1");
        }
      }
    }
    BNAPP.shabbat = map;
  } catch (err) {
    console.error("shabbat fetch failed", err);
  }
}

// Weather – Open Meteo
async function fetchWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${BNAPP.city.lat}&longitude=${BNAPP.city.lon}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    const weather = {};
    if (json.daily && Array.isArray(json.daily.time)) {
      for (let i = 0; i < json.daily.time.length; i++) {
        const key = json.daily.time[i];
        weather[key] = {
          code: json.daily.weathercode[i],
          tmax: json.daily.temperature_2m_max[i],
          tmin: json.daily.temperature_2m_min[i],
        };
      }
    }
    BNAPP.weather = weather;
    BNAPP.currentWeather = json.current_weather || null;
  } catch (err) {
    console.error("weather fetch failed", err);
  }
}

function weatherEmoji(code) {
  if (code === undefined || code === null) return "🌡";
  if (code === 0) return "☀️";
  if (code === 1 || code === 2) return "🌤";
  if (code === 3) return "☁️";
  if (code >= 45 && code <= 48) return "🌫";
  if (code >= 51 && code <= 67) return "🌦";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌧";
  if (code >= 95) return "⛈";
  return "🌡";
}

// ---- Rendering ----

async function refreshExternalData() {
  await Promise.all([
    fetchHolidaysForMonth(BNAPP.viewYear, BNAPP.viewMonth),
    fetchShabbatForRange(),
    fetchWeather(),
  ]);
  renderCalendar();
}

function initViewMonth() {
  const t = BNAPP.today;
  BNAPP.viewYear = t.getFullYear();
  BNAPP.viewMonth = t.getMonth();
}

function renderHeaders() {
  const headerGreg = document.getElementById("gregorianHeader");
  const headerHeb = document.getElementById("hebrewHeader");
  const todayLabel = document.getElementById("todayLabel");
  const locationLabel = document.getElementById("locationLabel");

  const sampleDate = new Date(BNAPP.viewYear, BNAPP.viewMonth, 1);
  headerGreg.textContent = gregMonthFormatter.format(sampleDate);
  headerHeb.textContent = hebrewMonthFormatter.format(sampleDate);
  todayLabel.textContent = gregDateFormatter.format(BNAPP.today);
  locationLabel.textContent = BNAPP.city.name;
}

function buildMonthDays(year, month) {
  const first = new Date(year, month, 1);
  const startWeekday = getWeekday(first); // 0=Sunday
  const days = [];

  // תקן: נתחיל מהראשון של השבוע של היום הראשון
  const start = new Date(year, month, 1 - startWeekday);
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push(d);
  }
  return days;
}

function renderCalendar() {
  if (BNAPP.viewYear === null) initViewMonth();
  renderHeaders();
  const grid = document.getElementById("calendarGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const days = buildMonthDays(BNAPP.viewYear, BNAPP.viewMonth);

  for (const d of days) {
    const key = dateKey(d);
    const cell = document.createElement("div");
    cell.className = "day-cell";
    if (d.getMonth() !== BNAPP.viewMonth) {
      cell.classList.add("day-cell-outside");
    }
    if (dateKey(BNAPP.today) === key) {
      cell.classList.add("today");
    }

    // Header: Gregorian + Hebrew
    const top = document.createElement("div");
    top.className = "day-top";
    const left = document.createElement("div");
    const gSpan = document.createElement("div");
    gSpan.className = "day-num";
    gSpan.textContent = d.getDate();
    const hSpan = document.createElement("div");
    hSpan.className = "day-hebrew-num";
    hSpan.textContent = hebrewDayFormatter.format(d).replace(/\s.*$/, "");
    left.appendChild(gSpan);
    left.appendChild(hSpan);

    const right = document.createElement("div");
    right.style.textAlign = "left";

    // Holiday name if exists
    const holiday = BNAPP.holidays[key];
    if (holiday && !/Parashat/.test(holiday.title)) {
      const hol = document.createElement("div");
      hol.className = "day-holiday";
      hol.textContent = holiday.title;
      right.appendChild(hol);
    }

    top.appendChild(left);
    top.appendChild(right);
    cell.appendChild(top);

    // Shabbat marker
    const weekday = getWeekday(d);
    const shab = BNAPP.shabbat[key];
    if (weekday === 5 && shab && shab.candle) {
      const icon = document.createElement("div");
      icon.className = "shabbat-candle";
      icon.textContent = "🕯";
      cell.appendChild(icon);
    }
    if (weekday === 6 && shab && shab.havdalah) {
      const icon = document.createElement("div");
      icon.className = "shabbat-stars";
      icon.textContent = "✨";
      cell.appendChild(icon);
    }

    // Events preview
    const content = document.createElement("div");
    content.className = "day-content";

    const dayEvents = (BNAPP.events[key] || []).filter((e) => !e.auto);
    const autoEvents = getAutoEventsForDate(d);
    const allForCount = dayEvents;
    if (dayEvents.length > 0) {
      const maxPreview = 2;
      for (let i = 0; i < Math.min(maxPreview, dayEvents.length); i++) {
        const ev = dayEvents[i];
        const row = document.createElement("div");
        row.className = "day-event-row";
        const dot = document.createElement("span");
        dot.className = "dot";
        if (ev.owner === "benjamin") dot.classList.add("dot-benjamin");
        else if (ev.owner === "nana") dot.classList.add("dot-nana");
        else dot.classList.add("dot-both");
        const text = document.createElement("span");
        text.textContent = ev.title;
        row.appendChild(dot);
        row.appendChild(text);
        content.appendChild(row);
      }
      if (dayEvents.length > maxPreview) {
        const more = document.createElement("div");
        more.className = "day-event-row";
        const dot = document.createElement("span");
        dot.className = "dot dot-auto";
        const text = document.createElement("span");
        text.textContent = `+ עוד ${dayEvents.length - maxPreview}`;
        more.appendChild(dot);
        more.appendChild(text);
        content.appendChild(more);
      }
    } else {
      // אין אירועים – אפשר להציג מזג אוויר קטן
      const w = BNAPP.weather[key];
      if (w) {
        const row = document.createElement("div");
        row.className = "day-event-row";
        const emoji = document.createElement("span");
        emoji.textContent = weatherEmoji(w.code);
        const text = document.createElement("span");
        text.textContent = `${Math.round(w.tmax)}°/${Math.round(w.tmin)}°`;
        row.appendChild(emoji);
        row.appendChild(text);
        content.appendChild(row);
      }
    }

    cell.appendChild(content);

    // Highlight if has >2 user events
    if (allForCount.length > 2) {
      cell.classList.add("glow");
    }

    cell.addEventListener("click", () => openDayModal(d));
    grid.appendChild(cell);
  }
}

// ---- Day modal ----

function openDayModal(d) {
  const key = dateKey(d);
  const modal = document.getElementById("dayModal");
  const hebEl = document.getElementById("dayModalHebrew");
  const gregEl = document.getElementById("dayModalGreg");
  const holEl = document.getElementById("dayModalHoliday");
  const shabEl = document.getElementById("dayShabbatInfo");
  const weatherInline = document.getElementById("dayWeatherInline");
  const hoursCol = document.getElementById("hoursColumn");
  const eventsList = document.getElementById("dayEventsList");

  hebEl.textContent = hebrewMonthFormatter.format(d).replace(/\d+.*/, "");
  gregEl.textContent = gregDateFormatter.format(d);
  const holiday = BNAPP.holidays[key];
  holEl.textContent = holiday ? holiday.title : "";

  // Shabbat info if Friday/Saturday
  shabEl.textContent = "";
  const weekday = getWeekday(d);
  const shab = BNAPP.shabbat[key];
  if (weekday === 5 && shab && shab.candle) {
    shabEl.textContent = `🕯 כניסת שבת: ${shab.candle}`;
  } else if (weekday === 6 && shab && shab.havdalah) {
    shabEl.textContent = `✨ יציאת שבת: ${shab.havdalah}`;
  }

  // Hours column
  hoursCol.innerHTML = "";
  for (let h = 6; h <= 23; h++) {
    const row = document.createElement("div");
    row.className = "hour-slot";
    row.textContent = `${pad2(h)}:00`;
    hoursCol.appendChild(row);
  }

  // Inline weather
  weatherInline.innerHTML = "";
  const w = BNAPP.weather[key];
  if (w) {
    const span = document.createElement("span");
    span.textContent = `${weatherEmoji(w.code)}  ${Math.round(
      w.tmax
    )}° / ${Math.round(w.tmin)}°`;
    weatherInline.appendChild(span);
  }

  // Events list
  eventsList.innerHTML = "";
  const userEvents = (BNAPP.events[key] || []).filter((e) => !e.auto);
  const autoEvents = getAutoEventsForDate(d);
  const merged = [...autoEvents, ...userEvents];
  merged.sort((a, b) => (a.start || "00:00").localeCompare(b.start || "00:00"));

  for (const ev of merged) {
    const row = document.createElement("div");
    row.className = "event-pill";
    if (ev.owner === "benjamin") row.classList.add("benjamin");
    else if (ev.owner === "nana") row.classList.add("nana");
    else row.classList.add("both");
    if (ev.auto) row.classList.add("auto");

    const title = document.createElement("div");
    title.className = "event-pill-title";
    title.textContent = ev.title;
    row.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "event-pill-meta";
    const who =
      ev.owner === "benjamin"
        ? "בנימין"
        : ev.owner === "nana"
        ? "ננה"
        : "משותף";
    meta.textContent = `${who} • ${ev.kind === "task" ? "משימה" : "אירוע"} • ${
      ev.start || ""
    }${ev.end ? "–" + ev.end : ""}`;
    row.appendChild(meta);

    if (ev.address) {
      const addr = document.createElement("div");
      addr.className = "event-pill-meta";
      addr.textContent = ev.address;
      row.appendChild(addr);

      const actions = document.createElement("div");
      const wazeBtn = document.createElement("button");
      wazeBtn.className = "btn tiny primary-soft";
      wazeBtn.textContent = "פתח Waze";
      wazeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const url =
          "https://waze.com/ul?q=" + encodeURIComponent(ev.address || "");
        window.open(url, "_blank");
      });
      actions.appendChild(wazeBtn);
      row.appendChild(actions);
    }

    eventsList.appendChild(row);
  }

  const addBtn = document.getElementById("addEventFromDayBtn");
  addBtn.onclick = () => openEventModal(d);

  modal.classList.remove("hidden");
}

// ---- Event modal ----

function openEventModal(date) {
  const modal = document.getElementById("eventModal");
  const title = document.getElementById("eventModalTitle");
  const dateInput = document.getElementById("eventDate");
  const startInput = document.getElementById("eventStart");
  const endInput = document.getElementById("eventEnd");
  const addressInput = document.getElementById("eventAddress");
  const kindSelect = document.getElementById("eventKind");
  const ownerSelect = document.getElementById("eventOwner");
  const notifyCheck = document.getElementById("eventNotify");
  const notifyMinutes = document.getElementById("eventNotifyMinutes");

  title.textContent = "אירוע חדש";
  if (date) {
    const k = dateKey(date);
    dateInput.value = k;
  } else {
    dateInput.value = dateKey(BNAPP.today);
  }
  startInput.value = "18:00";
  endInput.value = "";
  addressInput.value = "";
  kindSelect.value = "event";
  ownerSelect.value = "benjamin";
  notifyCheck.checked = true;
  notifyMinutes.value = "60";

  modal.classList.remove("hidden");
}

function handleEventFormSubmit(e) {
  e.preventDefault();
  const dateInput = document.getElementById("eventDate");
  const startInput = document.getElementById("eventStart");
  const endInput = document.getElementById("eventEnd");
  const addressInput = document.getElementById("eventAddress");
  const kindSelect = document.getElementById("eventKind");
  const ownerSelect = document.getElementById("eventOwner");
  const notifyCheck = document.getElementById("eventNotify");
  const notifyMinutes = document.getElementById("eventNotifyMinutes");

  const key = dateInput.value;
  if (!key) return;

  const ev = {
    title: document.getElementById("eventTitle").value || "ללא כותרת",
    kind: kindSelect.value,
    owner: ownerSelect.value,
    start: startInput.value,
    end: endInput.value || null,
    address: addressInput.value || null,
    notify: notifyCheck.checked,
    notifyMinutes: parseInt(notifyMinutes.value || "60", 10),
    auto: false,
  };

  saveEventToFirebase(key, ev);
  document.getElementById("eventModal").classList.add("hidden");
  renderCalendar();
}

// ---- Free time & tasks ----

function calculateFreeTime(date) {
  const key = dateKey(date);
  const workBlocks = getAutoEventsForDate(date);
  const userEvents = (BNAPP.events[key] || []).filter((e) => !e.auto);

  const blocks = [];
  for (const ev of [...workBlocks, ...userEvents]) {
    if (!ev.start || !ev.end) continue;
    blocks.push({
      start: ev.start,
      end: ev.end,
    });
  }
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  const result = [];
  let cursor = "06:00";
  for (const b of blocks) {
    if (b.start > cursor) {
      result.push({ start: cursor, end: b.start });
    }
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < "23:00") {
    result.push({ start: cursor, end: "23:00" });
  }
  return result;
}

function openFreeTimeModal() {
  const modal = document.getElementById("freeTimeModal");
  const content = document.getElementById("freeTimeContent");
  const today = BNAPP.today;
  const slots = calculateFreeTime(today);
  content.innerHTML = "";
  if (!slots.length) {
    content.textContent = "אין היום זמן חופשי 😊";
  } else {
    const ul = document.createElement("ul");
    for (const s of slots) {
      const li = document.createElement("li");
      li.textContent = `${s.start} – ${s.end}`;
      ul.appendChild(li);
    }
    content.appendChild(ul);
  }
  modal.classList.remove("hidden");
}

function openTasksModal() {
  const modal = document.getElementById("tasksModal");
  const content = document.getElementById("tasksContent");
  content.innerHTML = "";

  const now = BNAPP.today;
  const monthAhead = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const tasks = [];

  for (
    let d = cloneDate(now);
    d <= monthAhead;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  ) {
    const key = dateKey(d);
    const dayEvents = BNAPP.events[key] || [];
    for (const ev of dayEvents) {
      if (ev.kind === "task") {
        tasks.push({ date: cloneDate(d), ev });
      }
    }
  }

  if (!tasks.length) {
    content.textContent = "אין משימות בחודש הקרוב ✔";
  } else {
    for (const t of tasks) {
      const row = document.createElement("div");
      row.className = "task-item";
      row.textContent = `${gregDateFormatter.format(t.date)} – ${t.ev.title}`;
      content.appendChild(row);
    }
  }

  modal.classList.remove("hidden");
}

// ---- Weather modal ----

function openWeatherModal() {
  const modal = document.getElementById("weatherModal");
  const content = document.getElementById("weatherContent");
  content.innerHTML = "";

  const cw = BNAPP.currentWeather;
  const hero = document.createElement("div");
  hero.className = "weather-hero";
  const left = document.createElement("div");
  left.className = "weather-hero-main";
  const title = document.createElement("div");
  title.textContent = BNAPP.city.name;
  const temp = document.createElement("div");
  temp.className = "weather-hero-temp";
  temp.textContent = cw ? `${Math.round(cw.temperature)}°` : "--";
  const desc = document.createElement("div");
  desc.className = "weather-hero-desc";
  desc.textContent = "מזג אוויר נוכחי";
  left.appendChild(title);
  left.appendChild(temp);
  left.appendChild(desc);

  const right = document.createElement("div");
  right.className = "weather-hero-icon";
  right.textContent = cw ? weatherEmoji(cw.weathercode) : "🌡";

  hero.appendChild(left);
  hero.appendChild(right);
  content.appendChild(hero);

  // daily strip
  const stripTitle = document.createElement("div");
  stripTitle.className = "weather-subline";
  stripTitle.textContent = "תחזית לימים הקרובים:";
  content.appendChild(stripTitle);

  const strip = document.createElement("div");
  strip.className = "weather-daily-strip";
  for (const [key, w] of Object.entries(BNAPP.weather)) {
    const d = new Date(key + "T12:00:00");
    const card = document.createElement("div");
    card.className = "weather-day-card";
    const name = document.createElement("div");
    name.className = "weather-day-name";
    name.textContent = ["א", "ב", "ג", "ד", "ה", "ו", "ש"][getWeekday(d)];
    const icon = document.createElement("div");
    icon.className = "weather-day-icon";
    icon.textContent = weatherEmoji(w.code);
    const temp = document.createElement("div");
    temp.className = "weather-day-temp";
    temp.textContent = `${Math.round(w.tmax)}° / ${Math.round(w.tmin)}°`;
    card.appendChild(name);
    card.appendChild(icon);
    card.appendChild(temp);
    strip.appendChild(card);
  }
  content.appendChild(strip);

  modal.classList.remove("hidden");
}

// ---- City search (GeoNames) ----

async function searchCities(query) {
  const status = document.getElementById("citySearchStatus");
  const results = document.getElementById("cityResults");
  status.textContent = "מחפש...";
  results.innerHTML = "";
  try {
    const url = `https://secure.geonames.org/searchJSON?q=${encodeURIComponent(
      query
    )}&maxRows=10&username=binyamin543210&style=FULL`;
    const res = await fetch(url);
    const json = await res.json();
    if (!Array.isArray(json.geonames) || !json.geonames.length) {
      status.textContent = "לא נמצאו ערים. נסה דיוק אחר.";
      return;
    }
    status.textContent = "";
    for (const g of json.geonames) {
      const item = document.createElement("div");
      item.className = "city-item";
      const name = document.createElement("div");
      name.textContent = `${g.name}, ${g.countryName}`;
      const coords = document.createElement("div");
      coords.className = "hint";
      coords.textContent = `lat ${g.lat}, lon ${g.lng}`;
      item.appendChild(name);
      item.appendChild(coords);
      item.addEventListener("click", () => {
        BNAPP.city = {
          name: `${g.name}, ${g.countryName}`,
          lat: g.lat,
          lon: g.lng,
          tzid:
            g.timezone && g.timezone.timeZoneId
              ? g.timezone.timeZoneId
              : Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        localStorage.setItem("bnapp-city", JSON.stringify(BNAPP.city));
        document.getElementById("cityModal").classList.add("hidden");
        refreshExternalData();
      });
      results.appendChild(item);
    }
  } catch (err) {
    console.error("city search failed", err);
    status.textContent = "שגיאה בחיפוש עיר";
  }
}

// ---- Search events ----

function openSearchModal() {
  const modal = document.getElementById("searchModal");
  const qInput = document.getElementById("searchQuery");
  const results = document.getElementById("searchResults");
  const status = document.getElementById("searchStatus");
  qInput.value = "";
  results.innerHTML = "";
  status.textContent = "";
  modal.classList.remove("hidden");
}

function runSearch() {
  const q = (document.getElementById("searchQuery").value || "").trim();
  const results = document.getElementById("searchResults");
  const status = document.getElementById("searchStatus");
  results.innerHTML = "";
  if (!q) {
    status.textContent = "הקלד משהו לחיפוש";
    return;
  }
  const lower = q.toLowerCase();
  const found = [];
  for (const [key, list] of Object.entries(BNAPP.events || {})) {
    for (const ev of list) {
      if ((ev.title || "").toLowerCase().includes(lower)) {
        found.push({ key, ev });
      }
    }
  }
  if (!found.length) {
    status.textContent = "לא נמצאו תוצאות";
    return;
  }
  status.textContent = "";
  for (const item of found) {
    const row = document.createElement("div");
    row.className = "search-item";
    row.textContent = `${item.key}: ${item.ev.title}`;
    row.addEventListener("click", () => {
      const d = new Date(item.key + "T12:00:00");
      BNAPP.viewYear = d.getFullYear();
      BNAPP.viewMonth = d.getMonth();
      renderCalendar();
      openDayModal(d);
      document.getElementById("searchModal").classList.add("hidden");
    });
    results.appendChild(row);
  }
}

// ---- Theme ----

function initThemeToggle() {
  const toggle = document.getElementById("themeToggle");
  const saved = localStorage.getItem("bnapp-theme");
  if (saved === "light") {
    document.body.classList.remove("dark");
    toggle.checked = false;
  } else {
    document.body.classList.add("dark");
    toggle.checked = true;
  }
  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      document.body.classList.add("dark");
      localStorage.setItem("bnapp-theme", "dark");
    } else {
      document.body.classList.remove("dark");
      localStorage.setItem("bnapp-theme", "light");
    }
  });
}

// ---- Service worker ----

function initServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch((err) => console.error("SW failed", err));
  }
}

// ---- Close modals ----

function initModalClosers() {
  document.querySelectorAll(".close-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-close");
      if (target) {
        document.getElementById(target).classList.add("hidden");
      } else {
        btn.closest(".modal").classList.add("hidden");
      }
    });
  });
}

// ---- Init ----

function initCityFromStorage() {
  const saved = localStorage.getItem("bnapp-city");
  if (saved) {
    try {
      const obj = JSON.parse(saved);
      if (obj && obj.lat && obj.lon) {
        BNAPP.city = obj;
      }
    } catch {}
  }
}

function initUI() {
  initCityFromStorage();
  initThemeToggle();
  initModalClosers();
  initServiceWorker();

  document
    .getElementById("todayBtn")
    .addEventListener("click", () => {
      BNAPP.today = new Date();
      BNAPP.viewYear = BNAPP.today.getFullYear();
      BNAPP.viewMonth = BNAPP.today.getMonth();
      renderCalendar();
    });

  document
    .getElementById("prevMonthBtn")
    .addEventListener("click", () => {
      BNAPP.viewMonth--;
      if (BNAPP.viewMonth < 0) {
        BNAPP.viewMonth = 11;
        BNAPP.viewYear--;
      }
      refreshExternalData();
    });

  document
    .getElementById("nextMonthBtn")
    .addEventListener("click", () => {
      BNAPP.viewMonth++;
      if (BNAPP.viewMonth > 11) {
        BNAPP.viewMonth = 0;
        BNAPP.viewYear++;
      }
      refreshExternalData();
    });

  document
    .getElementById("freeTimeBtn")
    .addEventListener("click", openFreeTimeModal);
  document
    .getElementById("tasksBtn")
    .addEventListener("click", openTasksModal);
  document
    .getElementById("weatherDayBtn")
    .addEventListener("click", openWeatherModal);
  document.getElementById("cityBtn").addEventListener("click", () => {
    document.getElementById("cityModal").classList.remove("hidden");
  });
  document.getElementById("citySearchBtn").addEventListener("click", () => {
    const q = document.getElementById("citySearchInput").value.trim();
    if (q) searchCities(q);
  });

  document
    .getElementById("searchBtn")
    .addEventListener("click", openSearchModal);
  document
    .getElementById("searchRunBtn")
    .addEventListener("click", runSearch);

  document
    .getElementById("eventForm")
    .addEventListener("submit", handleEventFormSubmit);

  // click outside modal to close
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initViewMonth();
  initUI();
  loadEventsFromFirebase();
  refreshExternalData();
  renderCalendar();
});
