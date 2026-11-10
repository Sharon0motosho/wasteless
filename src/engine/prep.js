// F2.1 Daily Portion Preparation Guide & Scheduler
// Recommended prep = forecast + z * sigma, where z comes from the chosen
// service level (probability of not running out). Expected leftovers and
// expected shortfall are computed analytically (normal demand) so staff can see
// the overproduction vs. stock-out tradeoff.

import { dishById } from '../data/catalog.js';
import { zScore } from './util.js';

const phi = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
export function Phi(z) {
  // Abramowitz-Stegun erf approximation
  const t = 1 / (1 + 0.3275911 * Math.abs(z / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export const BATCH_PLANS = {
  Breakfast: [['07:00', 0.5], ['08:30', 0.3], ['10:00', 0.2]],
  default: [['10:30', 0.35], ['12:00', 0.25], ['16:30', 0.25], ['18:00', 0.15]],
};

export function prepFor(row, serviceLevel = 0.85) {
  const mu = Math.max(row.final, 0);
  const sigma = Math.max(1, mu * row.sigmaRel);
  const z = zScore(serviceLevel);
  const recommended = Math.ceil(mu + z * sigma);
  const expLeftover = sigma * (z * Phi(z) + phi(z));
  const expShort = sigma * (phi(z) - z * (1 - Phi(z)));
  const dish = dishById[row.dish];
  const plan = BATCH_PLANS[dish.category] || BATCH_PLANS.default;
  let assigned = 0;
  const batches = plan.map(([time, frac], i) => {
    const qty = i === plan.length - 1 ? recommended - assigned : Math.round(recommended * frac);
    assigned += qty;
    return { time, qty, onDemand: i >= plan.length - 2 && i > 0 };
  });
  return {
    ...row,
    sigma,
    recommended,
    expLeftover,
    expShort,
    expLeftoverKg: expLeftover * dish.kg,
    batches,
  };
}

/** Traditional par-level baseline: trailing 14-day average of same dish x 1.25. */
export function traditionalPar(records, dishId, iso) {
  const rows = records.filter((r) => r.dish === dishId && r.date < iso).slice(-14);
  if (!rows.length) return 0;
  return Math.ceil((rows.reduce((s, r) => s + r.consumed, 0) / rows.length) * 1.25);
}

export function prepPlan(forecastRows, records, serviceLevel = 0.85) {
  return forecastRows.map((row) => {
    const p = prepFor(row, serviceLevel);
    const par = traditionalPar(records, row.dish, row.date);
    return { ...p, par, avoided: Math.max(0, par - p.recommended) };
  });
}
