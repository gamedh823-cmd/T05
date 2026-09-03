const REGION_DATA_URLS = [
  "https://raw.githubusercontent.com/DevMinGeonPark/mapcn-kr/main/data/emd.json",
  "https://cdn.jsdelivr.net/gh/DevMinGeonPark/mapcn-kr@main/data/emd.json",
  "https://raw.githubusercontent.com/DevMinGeonPark/mapcn-kr/refs/heads/main/data/emd.json"
];

const CACHE_PREFIX = "koreaDetailedWeatherCacheV5:";
const SELECT_KEY = "koreaDetailedWeatherSelectionV5";
const STALE_MINUTES = 90;

const T04_STATE_KEY = "alephT04StateV1";
const T04_REPLAY_STATE_KEY = "alephT04ReplayStateV1";
const FETCH_DEADLINE_MS = 8000;

const T04_ERROR_MESSAGES = {
  timeout: { label: "실패 · stale/timeout", message: "외부 날씨 서버 응답이 시간 제한(8초)을 넘겨 늦었습니다. 마지막 정상값을 그대로 유지합니다." },
  auth: { label: "실패 · stale/auth", message: "외부 날씨 서버가 401/403으로 거절했습니다. 마지막 정상값을 그대로 유지합니다." },
  rate_limit: { label: "실패 · stale/rate_limit", message: "외부 날씨 서버 호출 제한(429)에 걸렸습니다. 마지막 정상값을 그대로 유지합니다." },
  offline: { label: "실패 · stale/offline", message: "네트워크에 연결할 수 없습니다. 마지막 정상값을 그대로 유지합니다." },
  schema_error: { label: "실패 · stale/schema_error", message: "외부 응답 형식이 예상과 달라 해석할 수 없습니다. 마지막 정상값을 그대로 유지합니다." }
};

const REPLAY_SCENARIOS = [
  { key: "normal-sequence", label: "정상 저장 순서 (D1-A → D1-B → D2)", fixtures: ["normal-d1-a", "normal-d1-b", "normal-d2"] },
  { key: "timeout", label: "실패: 느린 응답 (TIMEOUT)", fixtures: ["normal-d1-a", "normal-d1-b", "timeout"] },
  { key: "auth-401", label: "실패: 인증 거절 (401/403)", fixtures: ["normal-d1-a", "normal-d1-b", "auth-401"] },
  { key: "rate-429", label: "실패: 호출 제한 (429)", fixtures: ["normal-d1-a", "normal-d1-b", "rate-429"] },
  { key: "offline", label: "실패: 오프라인", fixtures: ["normal-d1-a", "normal-d1-b", "offline"] },
  { key: "schema-break", label: "실패: 응답 형식 변경", fixtures: ["normal-d1-a", "normal-d1-b", "schema-break"] },
  { key: "recover", label: "오류 뒤 회복 (TIMEOUT → RECOVER-D2)", fixtures: ["normal-d1-a", "normal-d1-b", "timeout", "recover-d2"] }
];

const weatherCodeMap = {
  0: ["☀️", "맑음"],
  1: ["🌤️", "대체로 맑음"],
  2: ["⛅", "부분적으로 흐림"],
  3: ["☁️", "흐림"],
  45: ["🌫️", "안개"],
  48: ["🌫️", "서리 안개"],
  51: ["🌦️", "약한 이슬비"],
  53: ["🌦️", "이슬비"],
  55: ["🌧️", "강한 이슬비"],
  56: ["🌧️", "약한 어는 이슬비"],
  57: ["🌧️", "강한 어는 이슬비"],
  61: ["🌧️", "약한 비"],
  63: ["🌧️", "비"],
  65: ["🌧️", "강한 비"],
  66: ["🌧️", "약한 어는 비"],
  67: ["🌧️", "강한 어는 비"],
  71: ["🌨️", "약한 눈"],
  73: ["🌨️", "눈"],
  75: ["❄️", "강한 눈"],
  77: ["🌨️", "싸락눈"],
  80: ["🌦️", "약한 소나기"],
  81: ["🌧️", "소나기"],
  82: ["⛈️", "강한 소나기"],
  85: ["🌨️", "약한 눈 소나기"],
  86: ["❄️", "강한 눈 소나기"],
  95: ["⛈️", "뇌우"],
  96: ["⛈️", "우박을 동반한 뇌우"],
  99: ["⛈️", "강한 우박을 동반한 뇌우"]
};

const $ = (id) => document.getElementById(id);

const sidoSelect = $("sido-select");
const sigunguSelect = $("sigungu-select");
const dongSelect = $("dong-select");
const regionLoadStatus = $("region-load-status");
const retryRegionBtn = $("retry-region-btn");
const localWarningEl = $("local-warning");
const weatherBtn = $("weather-btn");
const refreshBtn = $("refresh-btn");
const selectedCoordinateEl = $("selected-coordinate");
const selectedRegionTitleEl = $("selected-region-title");

const statusBadgeEl = $("status-badge");
const statusMessageEl = $("status-message");

const sourceLinkEl = $("source-link");
const sourceBtn = $("source-btn");
const saveMessageEl = $("save-message");
const historyBodyEl = $("history-body");
const recordCountEl = $("record-count");
const comparisonEl = $("comparison");

const hourlyBodyEl = $("hourly-body");
const rainCardsEl = $("rain-cards");
const weeklyCardsEl = $("weekly-cards");
const homeHourlyPreviewEl = $("home-hourly-preview");

const readingStatusBadgeEl = $("reading-status-badge");
const readingStatusMessageEl = $("reading-status-message");
const readingValueEl = $("reading-value");
const readingUnitEl = $("reading-unit");
const readingSourceEl = $("reading-source");
const readingSourceTimeEl = $("reading-source-time");
const readingFetchedAtEl = $("reading-fetched-at");
const readingTimezoneEl = $("reading-timezone");
const readingSourceUrlEl = $("reading-source-url");
const retryFetchBtn = $("retry-fetch-btn");

const replayScenarioSelect = $("replay-scenario-select");
const replayRunBtn = $("replay-run-btn");
const replayResetBtn = $("replay-reset-btn");
const replayResultEl = $("replay-result");
const replayRowsBodyEl = $("replay-rows-body");

let regionRows = [];
let selectedRegion = null;
let currentWeather = null;
let currentApiUrl = "";

function weatherInfo(code) {
  return weatherCodeMap[Number(code)] || ["🌡️", `날씨 코드 ${code ?? "-"}`];
}

function setStatus(type, label, message) {
  statusBadgeEl.className = `status ${type}`;
  statusBadgeEl.textContent = label;
  statusMessageEl.textContent = message;
}

function setRegionStatus(type, label) {
  regionLoadStatus.className = `status ${type}`;
  regionLoadStatus.textContent = label;
}

function activateTab(name) {
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${name}`);
  });

  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.tabTarget === name);
  });

  $("main-nav").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-tab-target]").forEach((element) => {
  element.addEventListener("click", (event) => {
    const target = event.currentTarget.dataset.tabTarget;
    if (target) activateTab(target);
  });
});

$("mobile-menu-btn").addEventListener("click", () => {
  $("main-nav").classList.toggle("open");
});

function getKoreanDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year").value;
  const month = parts.find((p) => p.type === "month").value;
  const day = parts.find((p) => p.type === "day").value;
  return `${year}-${month}-${day}`;
}

function getKoreanDateTimeString(date = new Date()) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatApiTime(value) {
  if (!value) return "-";
  return String(value).replace("T", " ");
}

function formatShortTime(value) {
  if (!value) return "-";
  const text = String(value);
  return text.includes("T") ? text.split("T")[1].slice(0, 5) : text;
}

function formatDateCard(value) {
  if (!value) return { date: "-", day: "-" };
  const d = new Date(`${value}T00:00:00+09:00`);
  return {
    date: `${d.getMonth() + 1}/${d.getDate()}`,
    day: new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "Asia/Seoul" }).format(d)
  };
}

function parseApiTimeAsKST(apiTime) {
  if (!apiTime) return null;
  const iso = apiTime.length > 16 ? `${apiTime}+09:00` : `${apiTime}:00+09:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoWithKstOffset(apiTime) {
  if (!apiTime) return null;
  return apiTime.length > 16 ? apiTime : `${apiTime}:00+09:00`;
}

function signalIdForRegion(region) {
  const code = String(region.code || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^-+/, "");
  const safeCode = code || "unknown";
  return `weather-temp-${safeCode}`.slice(0, 100);
}

function getT04State() {
  try {
    const raw = localStorage.getItem(T04_STATE_KEY);
    return raw ? JSON.parse(raw) : T04Adapter.resetEvaluationState();
  } catch {
    return T04Adapter.resetEvaluationState();
  }
}

function saveT04State(state) {
  localStorage.setItem(T04_STATE_KEY, JSON.stringify(state));
}

function formatIsoAsKst(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return getKoreanDateTimeString(date);
}

function renderReadingStatus(state, region) {
  if (!region) {
    readingStatusBadgeEl.className = "status idle";
    readingStatusBadgeEl.textContent = "대기";
    readingStatusMessageEl.textContent = "지역을 선택하고 조회하면 상태가 표시됩니다.";
    retryFetchBtn.hidden = true;
    readingValueEl.textContent = "--";
    readingUnitEl.textContent = "--";
    readingSourceEl.textContent = "--";
    readingSourceTimeEl.textContent = "--";
    readingFetchedAtEl.textContent = "--";
    readingTimezoneEl.textContent = "--";
    readingSourceUrlEl.removeAttribute("href");
    readingSourceUrlEl.textContent = "조회 후 표시됩니다.";
    statusBadgeEl.className = "status idle";
    statusBadgeEl.textContent = "대기";
    statusMessageEl.textContent = "지역을 선택한 뒤 날씨를 조회해 주세요.";
    return;
  }

  const reading = state.current_reading;

  if (reading) {
    readingValueEl.textContent = `${Number(reading.normalized_value).toFixed(1)}`;
    readingUnitEl.textContent = reading.unit;
    readingSourceEl.textContent = reading.source_name;
    readingSourceTimeEl.textContent = formatIsoAsKst(reading.source_time);
    readingFetchedAtEl.textContent = formatIsoAsKst(reading.fetched_at);
    readingTimezoneEl.textContent = reading.record_timezone;
    readingSourceUrlEl.href = reading.source_url;
    readingSourceUrlEl.textContent = reading.source_url;
  }

  if (!state.status) {
    readingStatusBadgeEl.className = "status idle";
    readingStatusBadgeEl.textContent = "대기";
    readingStatusMessageEl.textContent = "지역을 선택하고 조회하면 상태가 표시됩니다.";
    retryFetchBtn.hidden = true;
    statusBadgeEl.className = "status idle";
    statusBadgeEl.textContent = "대기";
    statusMessageEl.textContent = "지역을 선택한 뒤 날씨를 조회해 주세요.";
    return;
  }

  if (state.status.freshness === "fresh") {
    readingStatusBadgeEl.className = "status normal";
    readingStatusBadgeEl.textContent = "정상 · fresh/none";
    readingStatusMessageEl.textContent = "방금 조회한 값이 최신 정상값입니다.";
    retryFetchBtn.hidden = true;

    statusBadgeEl.className = "status normal";
    statusBadgeEl.textContent = "정상";
    statusMessageEl.textContent = `${region.emdnm}의 최신 날씨를 정상적으로 불러왔습니다.`;
  } else {
    const info = T04_ERROR_MESSAGES[state.status.error_code] || {
      label: `실패 · stale/${state.status.error_code}`,
      message: "알 수 없는 오류입니다."
    };
    readingStatusBadgeEl.className = "status error";
    readingStatusBadgeEl.textContent = info.label;
    readingStatusMessageEl.textContent = info.message;
    retryFetchBtn.hidden = false;

    statusBadgeEl.className = "status stale";
    statusBadgeEl.textContent = "오래된 데이터";
    statusMessageEl.textContent = info.message;
  }
}

function renderRecords(state, region) {
  if (!region) {
    recordCountEl.textContent = "0건";
    historyBodyEl.innerHTML = `<tr><td colspan="8" class="empty">지역을 선택해 주세요.</td></tr>`;
    comparisonEl.className = "comparison empty-comparison";
    comparisonEl.textContent = "같은 지역에서 서로 다른 날짜의 기록이 2건 이상 쌓이면 변화량이 표시됩니다.";
    return;
  }

  const signalId = signalIdForRegion(region);
  const regionName = `${region.sidonm} ${region.sggnm} ${region.emdnm}`;

  const rows = state.daily_readings
    .filter((row) => row.signal_id === signalId)
    .slice()
    .sort((a, b) => b.record_date.localeCompare(a.record_date));

  recordCountEl.textContent = `${rows.length}건`;

  if (!rows.length) {
    historyBodyEl.innerHTML = `<tr><td colspan="8" class="empty">현재 선택 지역의 저장 기록이 없습니다.</td></tr>`;
  } else {
    historyBodyEl.innerHTML = rows
      .map(
        (row) => `
          <tr>
            <td>${row.record_date}</td>
            <td>${regionName}</td>
            <td>${Number(row.normalized_value).toFixed(1)}</td>
            <td>${row.unit}</td>
            <td>${row.reading.source_name}</td>
            <td>${formatIsoAsKst(row.reading.source_time)}</td>
            <td>${formatIsoAsKst(row.last_fetched_at)}</td>
            <td>${row.reading.record_timezone}</td>
          </tr>
        `
      )
      .join("");
  }

  const ascending = rows.slice().sort((a, b) => a.record_date.localeCompare(b.record_date));
  if (ascending.length < 2) {
    comparisonEl.className = "comparison empty-comparison";
    comparisonEl.textContent =
      "같은 지역에서 서로 다른 날짜의 기록이 2건 이상 쌓이면 값 차이가 표시됩니다.";
    return;
  }

  const previous = ascending[ascending.length - 2];
  const current = ascending[ascending.length - 1];
  const diff = Number(current.normalized_value) - Number(previous.normalized_value);
  const symbol = diff > 0 ? "▲" : diff < 0 ? "▼" : "→";

  comparisonEl.className = "comparison";
  comparisonEl.innerHTML = `
    <div class="compare-grid">
      <div class="compare-item">
        <span>이전 기록 · ${previous.record_date}</span>
        <strong>${Number(previous.normalized_value).toFixed(1)} ${previous.unit}</strong>
      </div>
      <div class="compare-item">
        <span>현재 기록 · ${current.record_date}</span>
        <strong>${Number(current.normalized_value).toFixed(1)} ${current.unit}</strong>
      </div>
      <div class="compare-item">
        <span>값 차이</span>
        <strong>${diff > 0 ? "+" : ""}${diff.toFixed(1)} ${current.unit}</strong>
      </div>
      <div class="compare-item">
        <span>날짜순 재계산</span>
        <strong>${previous.record_date} → ${current.record_date}</strong>
      </div>
    </div>
    <p class="change">${symbol} ${Math.abs(diff).toFixed(1)} ${current.unit}</p>
  `;
}

function compassDirection(degrees) {
  if (degrees === null || degrees === undefined || Number.isNaN(Number(degrees))) return "-";
  const names = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  return `${names[Math.round(Number(degrees) / 45) % 8]} (${Math.round(Number(degrees))}°)`;
}

function valueUnit(value, unit, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Number(value).toFixed(digits)} ${unit}`;
}

function getFeaturePath(feature) {
  const p = feature.properties || {};
  const full = p.adm_nm || p.full_name || p.fullpath || p._fullpath || p.name || "";

  const sidonm =
    p.sidonm || p.sido_nm || p.sidoName || p.CTP_KOR_NM ||
    (full ? full.trim().split(/\s+/)[0] : "");

  let sggnm =
    p.sggnm || p.sgg_nm || p.sigungu || p.sggName || p.SIG_KOR_NM || "";

  const emdnm =
    p.dong || p.emdnm || p.emd_nm || p.dongnm || p.EMD_KOR_NM || p.name ||
    (full ? full.trim().split(/\s+/).slice(-1)[0] : "");

  if (!sggnm && full) {
    const parts = full.trim().split(/\s+/);
    if (parts.length >= 3) sggnm = parts.slice(1, -1).join(" ");
  }

  const code = String(
    p.adm_cd2 || p.emdcd || p.EMD_CD || p.code || p.adm_cd ||
    `${sidonm}|${sggnm}|${emdnm}`
  );

  return { sidonm, sggnm, emdnm, code, full };
}

function collectCoordinates(geometry) {
  if (!geometry || !geometry.coordinates) return [];
  const points = [];

  function walk(node) {
    if (!Array.isArray(node)) return;

    if (
      node.length >= 2 &&
      typeof node[0] === "number" &&
      typeof node[1] === "number"
    ) {
      points.push([node[0], node[1]]);
      return;
    }

    node.forEach(walk);
  }

  walk(geometry.coordinates);
  return points;
}

function getGeometryCenter(geometry) {
  const points = collectCoordinates(geometry);
  if (!points.length) return null;

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2
  };
}

async function fetchJsonWithFallback(urls) {
  let lastError;

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn("지역 데이터 주소 실패:", url, error);
    }
  }

  throw lastError || new Error("행정구역 데이터를 불러오지 못했습니다.");
}

async function loadRegions() {
  setRegionStatus("loading", "행정구역 불러오는 중");
  retryRegionBtn.disabled = true;
  localWarningEl.classList.add("hidden");

  try {
    const geojson = await fetchJsonWithFallback(REGION_DATA_URLS);
    const features = Array.isArray(geojson.features) ? geojson.features : [];

    const parsed = features
      .map((feature) => {
        const path = getFeaturePath(feature);
        const center = getGeometryCenter(feature.geometry);

        if (!path.sidonm || !path.sggnm || !path.emdnm || !center) return null;

        return {
          ...path,
          ...center,
          regionKey: `${path.sidonm}|${path.sggnm}|${path.emdnm}|${path.code}`
        };
      })
      .filter(Boolean);

    const unique = new Map();
    parsed.forEach((row) => {
      if (!unique.has(row.regionKey)) unique.set(row.regionKey, row);
    });

    regionRows = [...unique.values()].sort((a, b) =>
      `${a.sidonm} ${a.sggnm} ${a.emdnm}`.localeCompare(
        `${b.sidonm} ${b.sggnm} ${b.emdnm}`,
        "ko"
      )
    );

    if (!regionRows.length) throw new Error("행정동 데이터를 해석하지 못했습니다.");

    populateSido();
    restoreSelection();
    setRegionStatus("normal", `${regionRows.length.toLocaleString()}개 읍·면·동 준비`);
  } catch (error) {
    console.error(error);
    setRegionStatus("error", "행정구역 불러오기 실패");
    localWarningEl.classList.remove("hidden");

    sidoSelect.innerHTML = `<option>데이터를 불러오지 못했습니다</option>`;
    sigunguSelect.innerHTML = `<option>먼저 시·도를 선택하세요</option>`;
    dongSelect.innerHTML = `<option>먼저 시·군·구를 선택하세요</option>`;
    sidoSelect.disabled = true;
    sigunguSelect.disabled = true;
    dongSelect.disabled = true;
    weatherBtn.disabled = true;
  } finally {
    retryRegionBtn.disabled = false;
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "ko"));
}

function fillSelect(select, values, placeholder) {
  select.innerHTML = "";

  if (!values.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  select.disabled = false;
}

function populateSido() {
  const sidos = uniqueSorted(regionRows.map((r) => r.sidonm));
  fillSelect(sidoSelect, sidos, "시·도 없음");
  populateSigungu();
}

function populateSigungu() {
  const sido = sidoSelect.value;
  const sigungus = uniqueSorted(
    regionRows.filter((r) => r.sidonm === sido).map((r) => r.sggnm)
  );

  fillSelect(sigunguSelect, sigungus, "시·군·구 없음");
  populateDong();
}

function populateDong() {
  const sido = sidoSelect.value;
  const sigungu = sigunguSelect.value;

  const dongs = uniqueSorted(
    regionRows
      .filter((r) => r.sidonm === sido && r.sggnm === sigungu)
      .map((r) => r.emdnm)
  );

  fillSelect(dongSelect, dongs, "읍·면·동 없음");
  updateSelectedRegion();
}

function updateSelectedRegion() {
  selectedRegion =
    regionRows.find(
      (r) =>
        r.sidonm === sidoSelect.value &&
        r.sggnm === sigunguSelect.value &&
        r.emdnm === dongSelect.value
    ) || null;

  if (!selectedRegion) {
    weatherBtn.disabled = true;
    selectedCoordinateEl.textContent = "-";
    return;
  }

  weatherBtn.disabled = false;

  const regionName = `${selectedRegion.sidonm} ${selectedRegion.sggnm} ${selectedRegion.emdnm}`;
  selectedRegionTitleEl.textContent = regionName;
  selectedCoordinateEl.textContent =
    `기준 좌표 ${selectedRegion.latitude.toFixed(4)}, ${selectedRegion.longitude.toFixed(4)}`;

  $("info-region").textContent = regionName;
  $("info-coordinate").textContent =
    `${selectedRegion.latitude.toFixed(5)}, ${selectedRegion.longitude.toFixed(5)}`;

  const state = getT04State();
  renderReadingStatus(state, selectedRegion);
  renderRecords(state, selectedRegion);
}

function saveSelection() {
  if (!selectedRegion) return;
  localStorage.setItem(
    SELECT_KEY,
    JSON.stringify({
      sido: selectedRegion.sidonm,
      sigungu: selectedRegion.sggnm,
      dong: selectedRegion.emdnm
    })
  );
}

function restoreSelection() {
  let saved = null;

  try {
    saved = JSON.parse(localStorage.getItem(SELECT_KEY));
  } catch {}

  if (!saved) {
    saved = {
      sido: "부산광역시",
      sigungu: "해운대구",
      dong: "우1동"
    };
  }

  const sidos = [...sidoSelect.options].map((o) => o.value);

  if (sidos.includes(saved.sido)) {
    sidoSelect.value = saved.sido;
  } else if (sidos.includes("부산광역시")) {
    sidoSelect.value = "부산광역시";
  }

  populateSigungu();

  const sigungus = [...sigunguSelect.options].map((o) => o.value);
  if (sigungus.includes(saved.sigungu)) sigunguSelect.value = saved.sigungu;

  populateDong();

  const dongs = [...dongSelect.options].map((o) => o.value);
  if (dongs.includes(saved.dong)) dongSelect.value = saved.dong;

  updateSelectedRegion();
}

function buildWeatherUrl(region) {
  const current = [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "is_day",
    "precipitation",
    "rain",
    "showers",
    "snowfall",
    "weather_code",
    "cloud_cover",
    "pressure_msl",
    "surface_pressure",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m"
  ].join(",");

  const hourly = [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "precipitation_probability",
    "precipitation",
    "weather_code",
    "wind_speed_10m"
  ].join(",");

  const daily = [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "sunrise",
    "sunset",
    "uv_index_max",
    "precipitation_sum",
    "precipitation_hours",
    "precipitation_probability_max",
    "wind_speed_10m_max"
  ].join(",");

  const params = new URLSearchParams({
    latitude: region.latitude.toFixed(5),
    longitude: region.longitude.toFixed(5),
    current,
    hourly,
    daily,
    timezone: "Asia/Seoul",
    forecast_days: "7"
  });

  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

function getCacheKey(region) {
  return `${CACHE_PREFIX}${region.regionKey}`;
}

function saveCache(region, payload) {
  localStorage.setItem(getCacheKey(region), JSON.stringify(payload));
}

function getCache(region) {
  try {
    const raw = localStorage.getItem(getCacheKey(region));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function displayWeather(payload, { cached = false } = {}) {
  const { data, region, checkedAt, apiUrl } = payload;

  currentWeather = payload;
  currentApiUrl = apiUrl;

  const c = data.current || {};
  const cu = data.current_units || {};
  const d = data.daily || {};
  const du = data.daily_units || {};
  const h = data.hourly || {};
  const hu = data.hourly_units || {};

  const [emoji, description] = weatherInfo(c.weather_code);
  const regionName = `${region.sidonm} ${region.sggnm} ${region.emdnm}`;

  // Home
  $("home-location").textContent = regionName;
  $("home-weather-emoji").textContent = emoji;
  $("home-temperature").textContent =
    c.temperature_2m === undefined ? "--" : Number(c.temperature_2m).toFixed(1);
  $("home-temp-unit").textContent = cu.temperature_2m || "°C";
  $("home-weather-text").textContent = description;
  $("home-apparent").textContent = valueUnit(c.apparent_temperature, cu.apparent_temperature || "°C");
  $("home-humidity").textContent = valueUnit(c.relative_humidity_2m, cu.relative_humidity_2m || "%", 0);
  $("home-precipitation").textContent = valueUnit(c.precipitation, cu.precipitation || "mm");
  $("home-max").textContent = valueUnit(d.temperature_2m_max?.[0], du.temperature_2m_max || "°C");
  $("home-min").textContent = valueUnit(d.temperature_2m_min?.[0], du.temperature_2m_min || "°C");

  const currentTime = c.time || "";
  let hIndex = Array.isArray(h.time) ? h.time.findIndex((time) => time >= currentTime) : -1;
  if (hIndex < 0) hIndex = 0;

  $("home-rain-probability").textContent =
    Array.isArray(h.precipitation_probability)
      ? valueUnit(h.precipitation_probability[hIndex], hu.precipitation_probability || "%", 0)
      : "--";

  // Current
  $("current-location-title").textContent = regionName;
  $("weather-emoji").textContent = emoji;
  $("weather-description").textContent = description;
  $("temperature").textContent =
    c.temperature_2m === undefined ? "--" : Number(c.temperature_2m).toFixed(1);
  $("temperature-unit").textContent = cu.temperature_2m || "°C";

  $("apparent-temperature").textContent = valueUnit(c.apparent_temperature, cu.apparent_temperature || "°C");
  $("humidity").textContent = valueUnit(c.relative_humidity_2m, cu.relative_humidity_2m || "%", 0);
  $("precipitation").textContent = valueUnit(c.precipitation, cu.precipitation || "mm");
  $("rain").textContent = valueUnit(c.rain, cu.rain || "mm");
  $("showers").textContent = valueUnit(c.showers, cu.showers || "mm");
  $("snowfall").textContent = valueUnit(c.snowfall, cu.snowfall || "cm");
  $("cloud-cover").textContent = valueUnit(c.cloud_cover, cu.cloud_cover || "%", 0);
  $("wind-speed").textContent = valueUnit(c.wind_speed_10m, cu.wind_speed_10m || "km/h");
  $("wind-direction").textContent = compassDirection(c.wind_direction_10m);
  $("wind-gusts").textContent = valueUnit(c.wind_gusts_10m, cu.wind_gusts_10m || "km/h");
  $("pressure").textContent = valueUnit(c.pressure_msl, cu.pressure_msl || "hPa", 0);
  $("day-night").textContent = c.is_day === 1 ? "낮 ☀️" : c.is_day === 0 ? "밤 🌙" : "--";

  if (Array.isArray(d.time) && d.time.length) {
    const [dayEmoji, dayText] = weatherInfo(d.weather_code?.[0]);

    $("daily-weather").textContent = `${dayEmoji} ${dayText}`;
    $("temp-max").textContent = valueUnit(d.temperature_2m_max?.[0], du.temperature_2m_max || "°C");
    $("temp-min").textContent = valueUnit(d.temperature_2m_min?.[0], du.temperature_2m_min || "°C");
    $("precipitation-sum").textContent = valueUnit(d.precipitation_sum?.[0], du.precipitation_sum || "mm");
    $("precipitation-probability").textContent =
      valueUnit(d.precipitation_probability_max?.[0], du.precipitation_probability_max || "%", 0);
    $("precipitation-hours").textContent =
      valueUnit(d.precipitation_hours?.[0], du.precipitation_hours || "h");
    $("uv-index").textContent =
      d.uv_index_max?.[0] === undefined ? "--" : Number(d.uv_index_max[0]).toFixed(1);
    $("wind-max").textContent =
      valueUnit(d.wind_speed_10m_max?.[0], du.wind_speed_10m_max || "km/h");
    $("sunrise").textContent = formatShortTime(d.sunrise?.[0]);
    $("sunset").textContent = formatShortTime(d.sunset?.[0]);
  }

  $("data-time").textContent = formatApiTime(c.time);
  $("check-time").textContent = checkedAt || "-";
  $("info-region").textContent = regionName;
  $("info-coordinate").textContent =
    `${region.latitude.toFixed(5)}, ${region.longitude.toFixed(5)}`;

  sourceLinkEl.href = apiUrl;
  sourceLinkEl.textContent = apiUrl;
  sourceBtn.disabled = false;
  refreshBtn.disabled = false;

  renderHourly(data);
  renderWeekly(data);
}

function renderHourly(data) {
  const h = data.hourly || {};
  const hu = data.hourly_units || {};

  if (!Array.isArray(h.time) || !h.time.length) {
    hourlyBodyEl.innerHTML = `<tr><td colspan="8" class="empty">시간대별 데이터가 없습니다.</td></tr>`;
    rainCardsEl.innerHTML = `<div class="rain-card-placeholder">시간대별 강수확률 데이터가 없습니다.</div>`;
    homeHourlyPreviewEl.innerHTML = `<div class="empty-inline">시간대별 데이터가 없습니다.</div>`;
    return;
  }

  const currentTime = data.current?.time || "";
  let startIndex = h.time.findIndex((time) => time >= currentTime);
  if (startIndex < 0) startIndex = 0;

  const rows = [];
  const cards = [];
  const previews = [];

  for (let i = startIndex; i < Math.min(startIndex + 24, h.time.length); i++) {
    const [emoji, text] = weatherInfo(h.weather_code?.[i]);

    const probabilityRaw = h.precipitation_probability?.[i];
    const probability =
      probabilityRaw === null || probabilityRaw === undefined
        ? 0
        : Math.max(0, Math.min(100, Number(probabilityRaw)));

    const amount = h.precipitation?.[i];
    const timeText = formatShortTime(h.time[i]);

    cards.push(`
      <article class="rain-card">
        <div class="rain-time">${i === startIndex ? "지금 · " : ""}${timeText}</div>
        <div class="rain-icon">${emoji}</div>
        <div class="rain-weather">${text}</div>
        <div class="rain-probability">${Math.round(probability)}%</div>
        <div class="rain-label">비 올 확률</div>
        <div class="rain-bar"><i style="width:${probability}%"></i></div>
        <div class="rain-amount">강수 ${valueUnit(amount, hu.precipitation || "mm")}</div>
      </article>
    `);

    rows.push(`
      <tr>
        <td>${timeText}</td>
        <td>${emoji} ${text}</td>
        <td>${valueUnit(h.temperature_2m?.[i], hu.temperature_2m || "°C")}</td>
        <td>${valueUnit(h.apparent_temperature?.[i], hu.apparent_temperature || "°C")}</td>
        <td><strong>${valueUnit(probabilityRaw, hu.precipitation_probability || "%", 0)}</strong></td>
        <td>${valueUnit(amount, hu.precipitation || "mm")}</td>
        <td>${valueUnit(h.relative_humidity_2m?.[i], hu.relative_humidity_2m || "%", 0)}</td>
        <td>${valueUnit(h.wind_speed_10m?.[i], hu.wind_speed_10m || "km/h")}</td>
      </tr>
    `);

    if (i < startIndex + 6) {
      previews.push(`
        <article class="home-hour-card">
          <div class="time">${i === startIndex ? "지금" : timeText}</div>
          <div class="icon">${emoji}</div>
          <div>${Number(h.temperature_2m?.[i]).toFixed(1)}°</div>
          <div class="rain">☔ ${Math.round(probability)}%</div>
        </article>
      `);
    }
  }

  rainCardsEl.innerHTML = cards.join("");
  hourlyBodyEl.innerHTML = rows.join("");
  homeHourlyPreviewEl.innerHTML = previews.join("");
}

function renderWeekly(data) {
  const d = data.daily || {};
  const du = data.daily_units || {};

  if (!Array.isArray(d.time) || !d.time.length) {
    weeklyCardsEl.innerHTML = `<div class="empty-inline">7일 예보 데이터가 없습니다.</div>`;
    return;
  }

  weeklyCardsEl.innerHTML = d.time.slice(0, 7).map((date, i) => {
    const { date: shortDate, day } = formatDateCard(date);
    const [emoji, text] = weatherInfo(d.weather_code?.[i]);

    return `
      <article class="weekly-card">
        <div class="weekly-date">${i === 0 ? "오늘" : shortDate}</div>
        <div class="weekly-day">${day}</div>
        <div class="weekly-icon">${emoji}</div>
        <div class="weekly-desc">${text}</div>
        <div class="weekly-temp">
          ${Number(d.temperature_2m_max?.[i]).toFixed(1)}° /
          ${Number(d.temperature_2m_min?.[i]).toFixed(1)}°
        </div>
        <div class="weekly-rain">
          ☔ ${Number(d.precipitation_probability_max?.[i] ?? 0).toFixed(0)}%
          · ${Number(d.precipitation_sum?.[i] ?? 0).toFixed(1)} ${du.precipitation_sum || "mm"}
        </div>
      </article>
    `;
  }).join("");
}

async function fetchWeather() {
  if (!selectedRegion) return;

  weatherBtn.disabled = true;
  refreshBtn.disabled = true;
  retryFetchBtn.hidden = true;

  setStatus("loading", "불러오는 중", `${selectedRegion.emdnm}의 상세 날씨를 조회하고 있습니다.`);
  readingStatusBadgeEl.className = "status loading";
  readingStatusBadgeEl.textContent = "조회 중";
  readingStatusMessageEl.textContent = `${selectedRegion.emdnm}의 실제 공개 원천 값을 조회하고 있습니다.`;

  const apiUrl = buildWeatherUrl(selectedRegion);
  const signalId = signalIdForRegion(selectedRegion);
  const region = selectedRegion;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);

  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw Object.assign(new Error("오프라인 상태입니다."), { t04Code: "offline" });
    }

    const response = await fetch(apiUrl, { cache: "no-store", signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { t04Code: "auth" });
      }
      if (response.status === 429) {
        throw Object.assign(new Error("HTTP 429"), { t04Code: "rate_limit" });
      }
      throw Object.assign(new Error(`HTTP ${response.status}`), { t04Code: "schema_error" });
    }

    const data = await response.json();

    if (typeof data.current?.temperature_2m !== "number" || !data.current?.time) {
      throw Object.assign(new Error("필요한 현재 날씨 데이터가 없습니다."), { t04Code: "schema_error" });
    }

    const fetchedAt = new Date();
    const reading = {
      signal_id: signalId,
      normalized_value: Number(data.current.temperature_2m),
      unit: data.current_units?.temperature_2m || "°C",
      source_name: "Open-Meteo",
      source_url: apiUrl,
      source_time: toIsoWithKstOffset(data.current.time),
      fetched_at: fetchedAt.toISOString(),
      record_timezone: "Asia/Seoul",
      record_date: T04Adapter.kstDate(fetchedAt.toISOString())
    };

    const payload = {
      data,
      region: { ...region },
      checkedAt: getKoreanDateTimeString(fetchedAt),
      apiUrl
    };

    saveSelection();
    saveCache(region, payload);
    displayWeather(payload);

    let state = getT04State();
    state = T04Adapter.applySuccessfulReading(state, reading, { virtual_now: reading.fetched_at });
    saveT04State(state);

    if (region.regionKey === selectedRegion.regionKey) {
      renderReadingStatus(state, selectedRegion);
      renderRecords(state, selectedRegion);
    }
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("날씨 조회 실패:", error);

    const errorCode =
      error.t04Code ||
      (error.name === "AbortError"
        ? "timeout"
        : typeof navigator !== "undefined" && navigator.onLine === false
        ? "offline"
        : error instanceof TypeError
        ? "offline"
        : "schema_error");

    let state = getT04State();
    state = T04Adapter.applyError(state, errorCode, { virtual_now: new Date().toISOString() });
    saveT04State(state);

    const cached = getCache(region);

    if (cached) {
      displayWeather(cached, { cached: true });
    } else {
      currentWeather = null;
      currentApiUrl = "";
      sourceLinkEl.removeAttribute("href");
      sourceLinkEl.textContent = "조회 실패";
      sourceBtn.disabled = true;
    }

    if (region.regionKey === selectedRegion.regionKey) {
      renderReadingStatus(state, selectedRegion);
      renderRecords(state, selectedRegion);
    }
  } finally {
    weatherBtn.disabled = false;
    refreshBtn.disabled = false;
  }
}

function fixtureFileFor(base) {
  return `fixtures/${base}.json`;
}

async function loadFixture(base) {
  const response = await fetch(fixtureFileFor(base), { cache: "no-store" });
  if (!response.ok) throw new Error(`fixture 로딩 실패: ${base}`);
  return response.json();
}

function getReplayState() {
  try {
    const raw = localStorage.getItem(T04_REPLAY_STATE_KEY);
    return raw ? JSON.parse(raw) : T04Adapter.resetEvaluationState();
  } catch {
    return T04Adapter.resetEvaluationState();
  }
}

function saveReplayState(state) {
  localStorage.setItem(T04_REPLAY_STATE_KEY, JSON.stringify(state));
}

function populateReplayScenarios() {
  replayScenarioSelect.innerHTML = REPLAY_SCENARIOS.map(
    (scenario) => `<option value="${scenario.key}">${scenario.label}</option>`
  ).join("");
}

function compareField(label, actual, expected, formatter = (v) => v) {
  if (expected === undefined) return "";
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  return `
    <div class="replay-field ${pass ? "pass" : "fail"}">
      <span>${label}</span>
      <strong>${formatter(actual)} <em>(기대값: ${formatter(expected)})</em> ${pass ? "✅" : "❌"}</strong>
    </div>
  `;
}

function renderReplayRows(state, signalId) {
  const rows = state.daily_readings.filter((row) => !signalId || row.signal_id === signalId);

  if (!rows.length) {
    replayRowsBodyEl.innerHTML = `<tr><td colspan="5" class="empty">재생 결과가 없습니다.</td></tr>`;
    return;
  }

  replayRowsBodyEl.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${row.record_date}</td>
          <td>${row.normalized_value}</td>
          <td>${row.unit}</td>
          <td>${formatIsoAsKst(row.first_fetched_at)}</td>
          <td>${formatIsoAsKst(row.last_fetched_at)}</td>
        </tr>
      `
    )
    .join("");
}

function renderReplayResult(state, lastFixture) {
  const expected = lastFixture.expected || {};
  const rows = state.daily_readings.filter(
    (row) => !expected.signal_id || row.signal_id === expected.signal_id
  );
  const relevantRows = rows.length ? rows : state.daily_readings;
  const latestRow = relevantRows[relevantRows.length - 1] || null;

  const actual = {
    freshness: state.status?.freshness ?? null,
    error_code: state.status?.error_code ?? null,
    row_count: relevantRows.length,
    stored_value: latestRow ? latestRow.normalized_value : null,
    delta:
      state.last_comparison && state.last_comparison.state === "comparable"
        ? state.last_comparison.magnitude
        : null
  };

  replayResultEl.className = "replay-result";
  replayResultEl.innerHTML = `
    <p class="helper-text">마지막 실행 fixture: <strong>${lastFixture.fixture_id}</strong> — ${lastFixture.description_ko}</p>
    ${compareField("freshness", actual.freshness, expected.freshness)}
    ${compareField("error_code", actual.error_code, expected.error_code)}
    ${compareField("row_count", actual.row_count, expected.row_count)}
    ${compareField("stored_value", actual.stored_value, expected.stored_value)}
    ${compareField("delta", actual.delta, expected.delta)}
  `;

  renderReplayRows(state, expected.signal_id || latestRow?.signal_id);
}

async function runReplayScenario(scenarioKey) {
  const scenario = REPLAY_SCENARIOS.find((item) => item.key === scenarioKey);
  if (!scenario) return;

  replayResultEl.className = "replay-result empty-comparison";
  replayResultEl.textContent = "재생 중...";

  try {
    let state = T04Adapter.resetEvaluationState();
    let lastFixture = null;

    for (const base of scenario.fixtures) {
      const fixture = await loadFixture(base);
      state = T04Adapter.runFixture(state, fixture);
      lastFixture = fixture;
    }

    saveReplayState(state);
    renderReplayResult(state, lastFixture);
  } catch (error) {
    console.error("합성 재생 실패:", error);
    replayResultEl.className = "replay-result empty-comparison";
    replayResultEl.textContent = `재생 중 오류가 발생했습니다: ${error.message}`;
  }
}

retryRegionBtn.addEventListener("click", loadRegions);
sidoSelect.addEventListener("change", populateSigungu);
sigunguSelect.addEventListener("change", populateDong);
dongSelect.addEventListener("change", updateSelectedRegion);

weatherBtn.addEventListener("click", fetchWeather);
refreshBtn.addEventListener("click", fetchWeather);
retryFetchBtn.addEventListener("click", fetchWeather);

sourceBtn.addEventListener("click", () => {
  if (currentApiUrl) window.open(currentApiUrl, "_blank", "noopener,noreferrer");
});

populateReplayScenarios();

replayRunBtn.addEventListener("click", () => {
  runReplayScenario(replayScenarioSelect.value);
});

replayResetBtn.addEventListener("click", () => {
  const state = T04Adapter.resetEvaluationState();
  saveReplayState(state);
  replayResultEl.className = "replay-result empty-comparison";
  replayResultEl.textContent = "재생 상태를 초기화했습니다. 시나리오를 선택하고 다시 재생해 보세요.";
  renderReplayRows(state, null);
});

renderReplayRows(getReplayState(), null);
renderReadingStatus(getT04State(), null);
loadRegions();
