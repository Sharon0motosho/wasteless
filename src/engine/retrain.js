// F1.3 Automated ML Retraining & Variance Engine
// Continuously compares prior predictions with actual consumption; when the
// prediction error drifts past policy thresholds the model is retrained.

import { trainModel, evaluate, predictDish, demandOf } from './forecast.js';
import { DISHES } from '../data/catalog.js';
import { addDays, round, std } from './util.js';

export const DEFAULT_POLICY = {
  windowDays: 14, // rolling evaluation window
  maxMape: 10, // retrain if rolling MAPE exceeds this (%)
  maxDelta: 3, // ...or if it worsens by this many points vs. validation MAPE
  maxAgeDays: 28, // ...or on schedule when the model is this old
  cooldownDays: 5, // minimum days between automatic retrains
};

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Rolling variance check of `model` against actuals up to and including `asOf`. */
export function monitor(model, records, asOf, ctx, policy = DEFAULT_POLICY) {
  const from = addDays(asOf, -policy.windowDays + 1);
  const window = records.filter((r) => r.date >= from && r.date <= asOf && r.date > model.trainedThrough);
  const { mape } = evaluate(model, window, ctx);
  const rolling = round(mape, 2);
  const baseline = model.validationMape ?? model.trainMape;
  const delta = round(rolling - baseline, 2);
  const age = daysBetween(model.trainedThrough, asOf);
  const newDays = new Set(window.map((r) => r.date)).size;
  const reasons = [];
  if (newDays >= 3) {
    if (rolling > policy.maxMape) reasons.push(`Rolling MAPE ${rolling}% > ${policy.maxMape}% limit`);
    if (delta > policy.maxDelta) reasons.push(`Error delta +${delta} pts vs. validation (${baseline}%)`);
  }
  if (age >= policy.maxAgeDays) reasons.push(`Scheduled refresh: model is ${age} days old`);
  const cooling = age < policy.cooldownDays;
  return { asOf, rollingMape: rolling, baseline, delta, age, newDays, reasons, shouldRetrain: reasons.length > 0 && !cooling };
}

/**
 * Retrain: fit on data through `through - holdout` to measure validation MAPE
 * on a time-based holdout, then refit on everything through `through`.
 */
export function retrain(records, through, ctx, prevVersion = 0, holdoutDays = 14) {
  const cut = addDays(through, -holdoutDays);
  const probe = trainModel(records, cut, ctx, prevVersion + 1);
  const holdout = records.filter((r) => r.date > cut && r.date <= through);
  const validationMape = round(evaluate(probe, holdout, ctx).mape, 2);
  const model = trainModel(records, through, ctx, prevVersion + 1);
  model.validationMape = validationMape;
  // Prep buffers should reflect out-of-sample error, which is wider than the
  // in-sample residuals; use the larger of the two per dish.
  for (const d of DISHES) {
    const rel = holdout.filter((r) => r.dish === d.id && r.consumed > 0).map((r) => {
      const p = predictDish(probe, r.date, d.id, ctx).value;
      return (demandOf(r) - p) / Math.max(p, 1);
    });
    if (rel.length > 5) model.sigmaRel[d.id] = round(Math.max(model.sigmaRel[d.id], std(rel)), 4);
  }
  return model;
}
