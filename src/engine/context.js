// F1.2 Dynamic Environmental & Calendar Pipeline
// Resolves the academic phase / campus events for a date and supplies weather
// (live from Open-Meteo, with a deterministic seasonal fallback).

import { parseISO, rng, gaussian, clamp, round } from './util.js';

export function phaseFor(iso, calendar) {
  // Later, narrower entries win (e.g. a break inside summer).
  let found = 'regular';
  let label = 'Regular instruction';
  for (const c of calendar) {
    if (c.type === 'phase' && iso >= c.start && iso <= c.end) {
      found = c.phase;
      label = c.label;
    }
  }
  return { phase: found, label };
}

export function eventsFor(iso, calendar) {
  return calendar.filter((c) => c.type === 'event' && iso >= c.start && iso <= c.end);
}

export function eventMultiplier(iso, calendar) {
  return eventsFor(iso, calendar).reduce((m, e) => m * (Number(e.multiplier) || 1), 1);
}

// Weather codes (WMO) → short condition label.
export function conditionFor(code, precip, temp) {
  if (code != null) {
    if (code >= 71 && code <= 77) return 'Snow';
    if (code >= 95) return 'Thunderstorm';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain';
    if (code >= 45 && code <= 48) return 'Fog';
    if (code >= 1 && code <= 3) return 'Cloudy';
    return 'Clear';
  }
  if (precip > 0.5) return temp <= 1 ? 'Snow' : 'Rain';
  return precip > 0.1 ? 'Cloudy' : 'Clear';
}

// Deterministic seasonal weather used for history and as an offline fallback.
export function syntheticWeather(iso) {
  const d = parseISO(iso);
  const seed = d.getFullYear() * 1000 + Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const r = rng(seed * 7919);
  const doy = (d - new Date(d.getFullYear(), 0, 0)) / 86400000;
  const temp = 14 + 12 * Math.cos((2 * Math.PI * (doy - 200)) / 365) + gaussian(r) * 3;
  const wet = r() < 0.3;
  const precip = wet ? round(-Math.log(Math.max(r(), 1e-6)) * 6, 1) : 0;
  return {
    date: iso,
    tempC: round(temp, 1),
    precipMm: precip,
    condition: conditionFor(null, precip, temp),
    source: 'simulated',
  };
}

// Live feed (R5): Open-Meteo daily forecast, no API key needed.
export async function fetchLiveWeather(location, days = 7, fetchImpl = globalThis.fetch) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&forecast_days=${days}&timezone=auto`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Weather API ${res.status}`);
  const j = await res.json();
  const out = {};
  j.daily.time.forEach((date, i) => {
    const tempC = (j.daily.temperature_2m_max[i] + j.daily.temperature_2m_min[i]) / 2;
    const precipMm = j.daily.precipitation_sum[i] ?? 0;
    out[date] = {
      date,
      tempC: round(tempC, 1),
      precipMm: round(precipMm, 1),
      condition: conditionFor(j.daily.weathercode[i], precipMm, tempC),
      source: 'live',
    };
  });
  return out;
}

export function weatherFor(iso, liveMap = {}, overrides = {}) {
  if (overrides[iso]) return { ...overrides[iso], date: iso, source: 'what-if' };
  if (liveMap[iso]) return liveMap[iso];
  return syntheticWeather(iso);
}

export const PHASE_LABEL = {
  regular: 'Regular',
  midterms: 'Midterms',
  finals: 'Finals',
  break: 'Break',
  summer: 'Summer',
};

export function precipCap(p) {
  return clamp(p, 0, 25);
}
