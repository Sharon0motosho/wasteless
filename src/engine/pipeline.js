// Final demand pipeline: model forecast (F1.1/F1.2) -> student signals (F5.4)
// -> manager overrides (F1.4). Every stage is reported so the UI can explain
// exactly how the number was produced.

import { DISHES, HALLS } from '../data/catalog.js';
import { predictDish } from './forecast.js';
import { clamp, round } from './util.js';

// Student signals (F5.4):
//  - Attendance: survey responses are compared with the number expected at the
//    typical panel response rate. More responses than usual means more diners
//    than the model expects (and vice versa), scaled by an elasticity and capped
//    at +/-10%. Fewer than MIN_RESPONSES responses = not enough signal.
//  - Preferences: favorite votes shift demand share *between* dishes in a hall
//    (1% per vote above the hall average, capped at +/-5%), so the hall total is
//    not inflated by enthusiasm alone.
export const PANEL_RATE = 0.015;
export const ELASTICITY = 0.25;
export const MIN_RESPONSES = 5;

export function studentSignal(iso, dish, surveys, favorites, hallDiners) {
  const responses = surveys.filter((s) => s.date === iso && s.hall === dish.hall).length;
  const expected = hallDiners * PANEL_RATE;
  const hallLift = responses >= MIN_RESPONSES && expected > 0 ? clamp(ELASTICITY * (responses / expected - 1), -0.1, 0.1) : 0;
  const hallDishes = DISHES.filter((d) => d.hall === dish.hall);
  const favCount = favorites.filter((f) => f.dish === dish.id).length;
  const hallAvgFav = hallDishes.reduce((s, d) => s + favorites.filter((f) => f.dish === d.id).length, 0) / hallDishes.length;
  const favLift = clamp((favCount - hallAvgFav) * 0.01, -0.05, 0.05);
  return { responses, expected, favCount, hallLift, favLift, factor: (1 + hallLift) * (1 + favLift) };
}

export function findOverride(overrides, iso, dishId, hall) {
  // Dish-level overrides take precedence over hall-level ones; newest wins.
  const active = overrides.filter((o) => o.active !== false && o.date === iso);
  const dishO = active.filter((o) => o.dish === dishId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (dishO) return dishO;
  return active.filter((o) => !o.dish && o.hall === hall).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function applyOverride(value, o) {
  if (!o) return value;
  if (o.mode === 'absolute') return Math.max(0, Number(o.value));
  return Math.max(0, value * (1 + Number(o.value) / 100));
}

/** Forecast every dish for a date. */
export function forecastDay(iso, model, ctx, signals = {}) {
  const { surveys = [], favorites = [], overrides = [] } = signals;
  const raw = DISHES.map((d) => predictDish(model, iso, d.id, ctx));
  const hallVolume = Object.fromEntries(HALLS.map((h) => [h.id, 0]));
  raw.forEach((p, i) => (hallVolume[DISHES[i].hall] += p.value));

  return DISHES.map((d, i) => {
    const p = raw[i];
    // Portions per diner differ by hall, so convert portion volume to diners.
    const portionsPerDiner = DISHES.filter((x) => x.hall === d.hall).reduce((s, x) => s + x.share, 0);
    const sig = studentSignal(iso, d, surveys, favorites, hallVolume[d.hall] / portionsPerDiner);
    const modelValue = p.value;
    const withSignals = modelValue * sig.factor;
    const o = findOverride(overrides, iso, d.id, d.hall);
    const final = applyOverride(withSignals, o);
    return {
      date: iso,
      dish: d.id,
      hall: d.hall,
      base: round(p.base, 1),
      weatherFactor: p.weatherFactor,
      calendarFactor: p.calendarFactor,
      model: round(modelValue, 1),
      studentFactor: sig.factor,
      responses: sig.responses,
      expected: sig.expected,
      favCount: sig.favCount,
      override: o || null,
      final: Math.round(final),
      sigmaRel: p.sigmaRel,
    };
  });
}
