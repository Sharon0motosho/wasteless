// F1.1 Multi-Variable Time-Series Demand Forecaster
//
// Model: per dining hall, a log-linear regression of daily portion volume on
//   day-of-week + academic phase + temperature + precipitation,
// with campus events applied as a known multiplicative offset. Coefficients
// are fit by ridge regression shrunk toward calendar priors, so phases that
// have not yet been observed (e.g. the first finals week) still get sensible
// adjustments. Dish-level demand = hall volume x recency-weighted dish share.

import { HALLS, DISHES } from '../data/catalog.js';
import { phaseFor, eventMultiplier, precipCap } from './context.js';
import { dayOfWeek, addDays, std, mean, mape, groupBy, round } from './util.js';

export const FEATURES = ['intercept', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'midterms', 'finals', 'break', 'summer', 'temp', 'precip'];

// Calendar priors (log multipliers) the ridge shrinks toward.
const PRIOR = { midterms: Math.log(1.05), finals: Math.log(1.1), break: Math.log(0.3), summer: Math.log(0.4) };
const LAMBDA = 3;

export function featureVector(iso, weather, calendar) {
  const dow = dayOfWeek(iso);
  const { phase } = phaseFor(iso, calendar);
  return [
    1,
    dow === 1 ? 1 : 0, dow === 2 ? 1 : 0, dow === 3 ? 1 : 0, dow === 4 ? 1 : 0, dow === 5 ? 1 : 0, dow === 6 ? 1 : 0,
    phase === 'midterms' ? 1 : 0, phase === 'finals' ? 1 : 0, phase === 'break' ? 1 : 0, phase === 'summer' ? 1 : 0,
    weather.tempC - 18,
    precipCap(weather.precipMm),
  ];
}

// Solve (X'X + L)b = X'y + L b0 with Gaussian elimination.
function ridgeSolve(X, y, prior, lambdas) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let r = 0; r < X.length; r++) {
    const x = X[r];
    for (let i = 0; i < k; i++) {
      b[i] += x[i] * y[r];
      for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j];
    }
  }
  for (let i = 0; i < k; i++) {
    A[i][i] += lambdas[i];
    b[i] += lambdas[i] * prior[i];
  }
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < k; r++) {
      const f = A[r][c] / A[c][c];
      for (let j = c; j < k; j++) A[r][j] -= f * A[c][j];
      b[r] -= f * b[c];
    }
  }
  const beta = new Array(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < k; j++) s -= A[i][j] * beta[j];
    beta[i] = s / A[i][i];
  }
  return beta;
}

// Demand signal used for training. When a dish sold out, consumption
// understates demand (censoring), so we add the typical unmet-demand uplift
// observed from sold-out timestamps (~10%) to avoid a downward feedback loop.
export const STOCKOUT_UPLIFT = 1.1;
export function demandOf(r) {
  return r.stockout ? r.consumed * STOCKOUT_UPLIFT : r.consumed;
}

// Aggregate dish records into hall-level daily demand.
export function hallSeries(records) {
  const out = {};
  for (const r of records) {
    const key = `${r.hall}|${r.date}`;
    out[key] = (out[key] || 0) + demandOf(r);
  }
  return out;
}

/**
 * Train a model on all records with date <= through.
 * ctx: { calendar, weatherOf(iso) }
 */
export function trainModel(records, through, ctx, version = 1) {
  const train = records.filter((r) => r.date <= through);
  const hs = hallSeries(train);
  const halls = {};
  for (const h of HALLS) {
    const X = [];
    const y = [];
    const dates = [...new Set(train.filter((r) => r.hall === h.id).map((r) => r.date))].sort();
    for (const d of dates) {
      const v = hs[`${h.id}|${d}`];
      if (!v || v <= 0) continue;
      X.push(featureVector(d, ctx.weatherOf(d), ctx.calendar));
      y.push(Math.log(v) - Math.log(eventMultiplier(d, ctx.calendar)));
    }
    const prior = FEATURES.map((f) => PRIOR[f] ?? 0);
    prior[0] = y.length ? mean(y) : Math.log(500);
    const lambdas = FEATURES.map((f) => (f === 'intercept' ? 1e-6 : f === 'temp' || f === 'precip' ? 0.5 : LAMBDA));
    const beta = X.length ? ridgeSolve(X, y, prior, lambdas) : prior;
    const resid = X.map((x, i) => y[i] - x.reduce((s, xi, j) => s + xi * beta[j], 0));
    halls[h.id] = { beta, residStd: std(resid), n: X.length };
  }

  // Recency-weighted dish shares (half-life 10 days over the last 35 days).
  const shares = {};
  const recent = train.filter((r) => r.date > addDays(through, -35));
  for (const d of DISHES) {
    let num = 0;
    let den = 0;
    for (const r of recent) {
      if (r.hall !== d.hall) continue;
      const age = (Date.parse(through) - Date.parse(r.date)) / 86400000;
      const w = Math.pow(0.5, age / 10);
      den += w * demandOf(r);
      if (r.dish === d.id) num += w * demandOf(r);
    }
    shares[d.id] = den > 0 ? num / den : d.share / 2;
  }

  const model = { version, trainedThrough: through, trainedAt: new Date().toISOString(), halls, shares, nTrain: train.length };

  // Calibration: log-linear models predict the median, not the mean, and lag
  // after regime shifts. Rescale each hall so recent predictions match demand.
  const calWindow = train.filter((r) => r.date > addDays(through, -14));
  for (const h of HALLS) {
    model.halls[h.id].calib = 1;
    const rows = calWindow.filter((r) => r.hall === h.id);
    const act = rows.reduce((s, r) => s + demandOf(r), 0);
    const pred = rows.reduce((s, r) => s + predictDish(model, r.date, r.dish, ctx).value, 0);
    if (act > 0 && pred > 0) model.halls[h.id].calib = Math.min(1.25, Math.max(0.8, act / pred));
  }

  // Per-dish relative error spread over the last 28 training days (drives prep buffers).
  const window = train.filter((r) => r.date > addDays(through, -28));
  const errs = groupBy(window, (r) => r.dish);
  model.sigmaRel = {};
  for (const d of DISHES) {
    const rows = errs.get(d.id) || [];
    const rel = rows.filter((r) => r.consumed > 0).map((r) => {
      const p = predictDish(model, r.date, d.id, ctx).value;
      return (demandOf(r) - p) / Math.max(p, 1);
    });
    model.sigmaRel[d.id] = rel.length > 3 ? Math.max(0.04, std(rel)) : 0.12;
  }
  model.trainMape = round(evaluate(model, window, ctx).mape, 2);
  return model;
}

/** Explainable dish forecast for a date. */
export function predictDish(model, iso, dishId, ctx) {
  const dish = DISHES.find((d) => d.id === dishId);
  const h = model.halls[dish.hall];
  const w = ctx.weatherOf(iso);
  const x = featureVector(iso, w, ctx.calendar);
  const b = h.beta;
  const dowPart = b[0] + x.slice(1, 7).reduce((s, xi, j) => s + xi * b[j + 1], 0);
  const phasePart = x.slice(7, 11).reduce((s, xi, j) => s + xi * b[j + 7], 0);
  const weatherPart = x[11] * b[11] + x[12] * b[12];
  const evMult = eventMultiplier(iso, ctx.calendar);
  const share = model.shares[dishId] ?? dish.share;
  const base = Math.exp(dowPart) * share * (h.calib ?? 1);
  const weatherFactor = Math.exp(weatherPart);
  const calendarFactor = Math.exp(phasePart) * evMult;
  return {
    dish: dishId,
    base,
    weatherFactor,
    calendarFactor,
    value: base * weatherFactor * calendarFactor,
    sigmaRel: model.sigmaRel?.[dishId] ?? 0.12,
  };
}

export function evaluate(model, records, ctx) {
  const actual = [];
  const pred = [];
  for (const r of records) {
    actual.push(r.consumed);
    pred.push(predictDish(model, r.date, r.dish, ctx).value);
  }
  return { mape: mape(actual, pred), n: records.length };
}

export function coefficientTable(model) {
  return HALLS.map((h) => ({
    hall: h.name,
    ...Object.fromEntries(FEATURES.map((f, i) => [f, model.halls[h.id].beta[i]])),
  }));
}
