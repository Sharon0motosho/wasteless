// F5.1 Live Menu Display & Dietary Filters
// F5.2 Real-Time Low Supply Indicators
// F5.3 Crowd Density & Peak Hour Meter

import { HALLS, DISHES, hallById } from '../data/catalog.js';
import { rng, clamp } from './util.js';

export const LOW_SUPPLY_THRESHOLD = 0.2; // badge when <= 20% of prepared portions remain

/** Dish passes if it carries every selected diet tag and none of the excluded allergens. */
export function filterMenu(dishes, { diets = [], excludeAllergens = [], search = '', hall = 'all' } = {}) {
  const q = search.trim().toLowerCase();
  return dishes.filter(
    (d) =>
      (hall === 'all' || d.hall === hall) &&
      diets.every((t) => d.diet.includes(t)) &&
      !excludeAllergens.some((a) => d.allergens.includes(a)) &&
      (!q || d.name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q)),
  );
}

export function supplyStatus(remaining, prepared) {
  if (prepared <= 0 || remaining <= 0) return 'sold-out';
  if (remaining / prepared <= LOW_SUPPLY_THRESHOLD) return 'low';
  return 'available';
}

// Diner arrival profile: mixture of meal peaks (hour of day, weight, spread).
const PEAKS = {
  north: [[8, 0.2, 0.8], [12.5, 0.42, 0.9], [18, 0.38, 1.0]],
  south: [[8.5, 0.15, 0.8], [12.5, 0.45, 0.8], [18, 0.4, 0.9]],
  market: [[8.5, 0.3, 0.9], [12, 0.35, 1.1], [16.5, 0.15, 1.0], [20, 0.2, 1.2]],
};
const DWELL_HOURS = { north: 0.75, south: 0.7, market: 0.3 };

const normPdf = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
const normCdf = (x, m, s) => 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)));
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** Share of the day's diners that have arrived by `hour` (fractional). */
export function servedFraction(hallId, hour) {
  const h = hallById[hallId];
  const peaks = PEAKS[hallId];
  const total = peaks.reduce((s, [m, w, sd]) => s + w * (normCdf(h.close, m, sd) - normCdf(h.open, m, sd)), 0);
  const upTo = peaks.reduce((s, [m, w, sd]) => s + w * (normCdf(clamp(hour, h.open, h.close), m, sd) - normCdf(h.open, m, sd)), 0);
  return clamp(upTo / total, 0, 1);
}

export function crowdLevel(pct) {
  if (pct < 40) return { label: 'Quiet', tone: 'good' };
  if (pct < 70) return { label: 'Moderate', tone: 'ok' };
  if (pct < 90) return { label: 'Busy', tone: 'warn' };
  return { label: 'Packed', tone: 'bad' };
}

/** Hourly predicted occupancy (% of seating capacity) for one hall. */
export function crowdProfile(hallId, diners) {
  const h = hallById[hallId];
  const out = [];
  for (let hour = h.open; hour < h.close; hour++) {
    const arrivals = PEAKS[hallId].reduce((s, [m, w, sd]) => s + w * normPdf(hour + 0.5, m, sd), 0);
    const pct = clamp(Math.round(((diners * arrivals * DWELL_HOURS[hallId]) / h.capacity) * 100), 0, 100);
    const lvl = crowdLevel(pct);
    out.push({ hour, hourLabel: `${hour % 12 || 12}${hour < 12 ? 'a' : 'p'}`, pct, label: lvl.label, tone: lvl.tone });
  }
  return out;
}

export function bestTimes(profile, now) {
  return profile.filter((p) => p.hour >= Math.floor(now)).sort((a, b) => a.pct - b.pct).slice(0, 2);
}

/** Diner estimate per hall from dish forecasts (portions / portions-per-diner). */
export function dinersByHall(forecastRows) {
  return Object.fromEntries(
    HALLS.map((h) => {
      const ppd = DISHES.filter((d) => d.hall === h.id).reduce((s, d) => s + d.share, 0);
      const portions = forecastRows.filter((r) => r.hall === h.id).reduce((s, r) => s + r.final, 0);
      return [h.id, Math.round(portions / ppd)];
    }),
  );
}

/**
 * Live service simulation for today: portions served so far follow the hall's
 * arrival curve scaled by each dish's realized demand (seeded per date so some
 * dishes genuinely run short), minus any manual counts entered by staff.
 */
export function liveSupply(prepRows, iso, hourNow, manual = {}) {
  const r = rng(Number(iso.replace(/-/g, '')));
  return prepRows.map((p) => {
    const demandFactor = 0.82 + r() * 0.36; // realized demand vs. forecast
    const demand = p.final * demandFactor;
    const prepared = p.recommended;
    const served = Math.min(prepared, Math.round(demand * servedFraction(p.hall, hourNow)));
    const m = manual[p.dish];
    const remaining = m != null && m.at >= 0 ? Math.max(0, m.remaining) : prepared - served;
    return { dish: p.dish, hall: p.hall, prepared, served: prepared - remaining, remaining, status: supplyStatus(remaining, prepared) };
  });
}
