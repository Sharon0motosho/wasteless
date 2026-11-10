// Synthetic 180-day operating history.
//  - Ground-truth demand depends on weekday, academic phase, campus events,
//    weather and slow per-dish popularity drift (hidden from the model).
//  - Before go-live the kitchen preps with traditional par levels.
//  - After go-live prep follows the WasteLess forecast, and the variance
//    engine monitors error daily and retrains automatically.

import { DISHES, HALLS, GO_LIVE_DAYS_AGO } from './catalog.js';
import { addDays, rng, gaussian, round, todayISO, dayOfWeek } from '../engine/util.js';
import { phaseFor, eventMultiplier } from '../engine/context.js';
import { trainModel } from '../engine/forecast.js';
import { monitor, retrain, DEFAULT_POLICY } from '../engine/retrain.js';
import { forecastDay } from '../engine/pipeline.js';
import { prepFor, traditionalPar } from '../engine/prep.js';

const HISTORY_DAYS = 180;
const BASE_DINERS = 1900;
const DOW = [0.7, 1.0, 1.03, 1.0, 0.97, 0.85, 0.62];
const PHASE_TRUE = { regular: 1, midterms: 1.07, finals: 1.12, break: 0.27, summer: 0.32 };
const DISCARD_FRACTION = 0.9; // share of leftover prep that ends up discarded
const PLATE_WASTE = 0.05; // share of served food left on plates

export function trueDemand(iso, dish, weather, calendar, r, t) {
  const hall = HALLS.find((h) => h.id === dish.hall);
  const { phase } = phaseFor(iso, calendar);
  const precipEffect = hall.id === 'market' ? -0.008 : 0.01; // rain keeps diners in halls, hurts grab&go
  const weatherF = Math.exp(precipEffect * Math.min(weather.precipMm, 25) - 0.007 * (weather.tempC - 18));
  const diners = BASE_DINERS * DOW[dayOfWeek(iso)] * PHASE_TRUE[phase] * eventMultiplier(iso, calendar) * weatherF * (1 + gaussian(r) * 0.04);
  const drift = 1 + dish.trend * (t - 0.5);
  return Math.max(0, Math.round(diners * hall.share * dish.share * drift * (1 + gaussian(r) * 0.06)));
}

function wasteFor(dish, prepared, consumed) {
  const leftover = Math.max(0, prepared - consumed);
  const wasteKg = leftover * dish.kg * DISCARD_FRACTION + consumed * dish.kg * PLATE_WASTE;
  return { leftover, wasteKg: round(wasteKg, 2) };
}

export function generateHistory({ calendar, weatherOf, today = todayISO(), policy = DEFAULT_POLICY, seed = 42 }) {
  const r = rng(seed);
  const start = addDays(today, -HISTORY_DAYS);
  const goLive = addDays(today, -GO_LIVE_DAYS_AGO);
  const ctx = { calendar, weatherOf };
  const records = [];
  const retrainLog = [];
  const monitorSeries = [];
  let model = null;

  for (let i = 0; i < HISTORY_DAYS; i++) {
    const iso = addDays(start, i);
    const weather = weatherOf(iso);
    const t = i / HISTORY_DAYS;
    const demand = Object.fromEntries(DISHES.map((d) => [d.id, trueDemand(iso, d, weather, calendar, r, t)]));

    if (iso >= goLive && !model) {
      model = retrain(records, addDays(iso, -1), ctx, 0);
      retrainLog.push({ version: model.version, date: iso, reasons: ['Initial deployment (go-live)'], validationMape: model.validationMape, trainMape: model.trainMape, nTrain: model.nTrain });
    }

    const day = model ? forecastDay(iso, model, ctx) : null;
    DISHES.forEach((dish, k) => {
      let predicted;
      let prepared;
      if (!model) {
        const par = traditionalPar(records, dish.id, iso);
        predicted = par ? Math.round(par / 1.25) : Math.round(demand[dish.id] * 1.1);
        prepared = par || Math.ceil(demand[dish.id] * 1.3);
      } else {
        const p = prepFor(day[k], 0.9);
        predicted = Math.round(day[k].final);
        prepared = p.recommended;
      }
      const consumed = Math.min(demand[dish.id], prepared);
      const stockout = consumed >= prepared;
      records.push({
        date: iso, hall: dish.hall, dish: dish.id, category: dish.category,
        predicted, prepared, consumed, stockout, ...wasteFor(dish, prepared, consumed),
        source: 'seed', mode: model ? 'wasteless' : 'traditional',
      });
    });

    if (model) {
      const m = monitor(model, records, iso, ctx, policy);
      monitorSeries.push({ date: iso, rollingMape: m.rollingMape, version: model.version });
      if (m.shouldRetrain) {
        model = retrain(records, iso, ctx, model.version);
        retrainLog.push({ version: model.version, date: addDays(iso, 1), reasons: m.reasons, validationMape: model.validationMape, trainMape: model.trainMape, nTrain: model.nTrain, before: m.rollingMape });
        monitorSeries[monitorSeries.length - 1].retrained = model.version;
      }
    }
  }
  return { records, model, retrainLog, monitorSeries, goLive, start };
}

export { trainModel };
