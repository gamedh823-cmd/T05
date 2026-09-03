"use strict";

// ALEPH T04 정규화·저장 어댑터.
// spec/README.md의 adapter-reset.example.js를 브라우저 전역 스크립트로 옮긴 것.
// 실제(live) 조회와 fixture 재생(replay)이 이 함수들을 공유해야
// "오류 처리만 따로 꾸미는" 실수를 막을 수 있다.

const T04_NORMALIZED_KEYS = Object.freeze([
  "signal_id",
  "normalized_value",
  "unit",
  "source_name",
  "source_url",
  "source_time",
  "fetched_at",
  "record_timezone",
  "record_date"
]);

const T04_ERROR_CODES = Object.freeze([
  "timeout",
  "auth",
  "rate_limit",
  "offline",
  "schema_error"
]);

function t04Clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function t04KstDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("fetched_at must be a valid ISO-8601 date-time");
  }
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function t04ValidateNormalizedReading(reading) {
  if (!reading || typeof reading !== "object" || Array.isArray(reading)) {
    throw new TypeError("normalized reading must be an object");
  }

  const actualKeys = Object.keys(reading).sort();
  const expectedKeys = [...T04_NORMALIZED_KEYS].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError(`normalized reading keys must be exactly: ${T04_NORMALIZED_KEYS.join(", ")}`);
  }

  if (!/^[a-z0-9][a-z0-9._-]*$/.test(reading.signal_id) || reading.signal_id.length > 100) {
    throw new TypeError("signal_id is invalid");
  }
  if (typeof reading.normalized_value !== "number" || !Number.isFinite(reading.normalized_value)) {
    throw new TypeError("normalized_value must be a finite number");
  }
  for (const field of ["unit", "source_name"]) {
    if (typeof reading[field] !== "string" || reading[field].trim() === "") {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }

  let sourceUrl;
  try {
    sourceUrl = new URL(reading.source_url);
  } catch {
    throw new TypeError("source_url must be an absolute URL");
  }
  if (sourceUrl.protocol !== "https:") {
    throw new TypeError("source_url must use HTTPS");
  }

  if (reading.source_time !== null && Number.isNaN(new Date(reading.source_time).getTime())) {
    throw new TypeError("source_time must be a valid date-time or null");
  }
  if (Number.isNaN(new Date(reading.fetched_at).getTime())) {
    throw new TypeError("fetched_at must be a valid date-time");
  }
  if (reading.record_timezone !== "Asia/Seoul") {
    throw new TypeError("record_timezone must be Asia/Seoul");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reading.record_date) || reading.record_date !== t04KstDate(reading.fetched_at)) {
    throw new TypeError("record_date must be the Asia/Seoul date derived from fetched_at");
  }

  return true;
}

function t04ValidateStatus(status) {
  if (!status || typeof status !== "object" || Array.isArray(status)) return false;
  if (status.freshness === "fresh") return status.error_code === "none";
  if (status.freshness === "stale") return T04_ERROR_CODES.includes(status.error_code);
  return false;
}

function t04ResetEvaluationState() {
  return {
    schema_version: "aleph-t04-evaluation-state-v1",
    daily_readings: [],
    current_reading: null,
    status: null,
    last_delta: null,
    last_comparison: {
      state: "insufficient",
      direction: null,
      magnitude: null,
      unit: null
    },
    last_run: null,
    sequence: 0
  };
}

function t04RecordIdFor(reading) {
  return `demo-${reading.signal_id}-${reading.record_date}`;
}

function t04ComparisonFor(rows, current) {
  const previous = rows
    .filter((row) => row.signal_id === current.signal_id && row.record_date < current.record_date)
    .sort((left, right) => right.record_date.localeCompare(left.record_date))[0];
  if (!previous) {
    return { state: "insufficient", direction: null, magnitude: null, unit: null };
  }
  if (previous.unit !== current.unit) {
    return { state: "unit_mismatch", direction: null, magnitude: null, unit: null };
  }
  const signed = current.normalized_value - previous.normalized_value;
  return {
    state: "comparable",
    direction: signed > 0 ? "increase" : signed < 0 ? "decrease" : "unchanged",
    magnitude: Math.abs(signed),
    unit: current.unit
  };
}

function t04ApplySuccessfulReading(inputState, reading, runMeta = {}) {
  t04ValidateNormalizedReading(reading);
  const state = t04Clone(inputState);
  const existingIndex = state.daily_readings.findIndex(
    (row) => row.signal_id === reading.signal_id && row.record_date === reading.record_date
  );
  const existing = existingIndex >= 0 ? state.daily_readings[existingIndex] : null;
  const row = {
    record_id: existing ? existing.record_id : t04RecordIdFor(reading),
    signal_id: reading.signal_id,
    record_date: reading.record_date,
    normalized_value: reading.normalized_value,
    unit: reading.unit,
    first_fetched_at: existing ? existing.first_fetched_at : reading.fetched_at,
    last_fetched_at: reading.fetched_at,
    reading: t04Clone(reading)
  };

  if (existingIndex >= 0) state.daily_readings[existingIndex] = row;
  else state.daily_readings.push(row);
  state.daily_readings.sort((left, right) => left.record_date.localeCompare(right.record_date));

  state.current_reading = t04Clone(reading);
  state.status = { freshness: "fresh", error_code: "none" };
  state.last_comparison = t04ComparisonFor(state.daily_readings, row);
  state.last_delta = state.last_comparison.magnitude;
  state.sequence += 1;
  state.last_run = {
    fixture_id: runMeta.fixture_id || null,
    virtual_now: runMeta.virtual_now || reading.fetched_at,
    outcome: "success",
    error_code: "none",
    retry_after_seconds: null
  };
  return state;
}

function t04ApplyError(inputState, errorCode, runMeta = {}) {
  if (!T04_ERROR_CODES.includes(errorCode)) {
    throw new TypeError(`unsupported error code: ${errorCode}`);
  }
  const state = t04Clone(inputState);
  state.status = { freshness: "stale", error_code: errorCode };
  state.sequence += 1;
  state.last_run = {
    fixture_id: runMeta.fixture_id || null,
    virtual_now: runMeta.virtual_now || null,
    outcome: "error",
    error_code: errorCode,
    retry_after_seconds: runMeta.retry_after_seconds ?? null
  };
  return state;
}

function t04RunFixture(inputState, fixture) {
  const meta = {
    fixture_id: fixture.fixture_id,
    virtual_now: fixture.virtual_now,
    retry_after_seconds: fixture.transport.headers["retry-after"]
      ? Number(fixture.transport.headers["retry-after"])
      : null
  };

  if (fixture.transport.mode === "timeout") return t04ApplyError(inputState, "timeout", meta);
  if (fixture.transport.mode === "offline") return t04ApplyError(inputState, "offline", meta);
  if (fixture.transport.status === 401 || fixture.transport.status === 403) {
    return t04ApplyError(inputState, "auth", meta);
  }
  if (fixture.transport.status === 429) return t04ApplyError(inputState, "rate_limit", meta);
  if (fixture.transport.status >= 200 && fixture.transport.status < 300) {
    try {
      return t04ApplySuccessfulReading(inputState, fixture.payload, meta);
    } catch {
      return t04ApplyError(inputState, "schema_error", meta);
    }
  }
  return t04ApplyError(inputState, "schema_error", meta);
}

window.T04Adapter = {
  ERROR_CODES: T04_ERROR_CODES,
  NORMALIZED_KEYS: T04_NORMALIZED_KEYS,
  applyError: t04ApplyError,
  applySuccessfulReading: t04ApplySuccessfulReading,
  comparisonFor: t04ComparisonFor,
  kstDate: t04KstDate,
  resetEvaluationState: t04ResetEvaluationState,
  runFixture: t04RunFixture,
  validateNormalizedReading: t04ValidateNormalizedReading,
  validateStatus: t04ValidateStatus
};
