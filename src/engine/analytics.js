// F2.4 Menu Item Popularity & Waste Ratio Analyzer
// F3.2 Interactive Operations & Trend Dashboard (aggregations)
// F3.3 Financial Cost Savings & ROI Calculator
// F3.4 Sustainability & Carbon Offset Generator (calculations)

import { DISHES, dishById } from '../data/catalog.js';
import { weekKey, monthKey, mean, round, groupBy, sum, mape } from './util.js';

export const DISPOSAL_CO2_PER_KG = 0.58; // landfill methane, kg CO2e per kg food waste
export const MT_PER_CAR_YEAR = 4.6; // typical passenger vehicle, MT CO2e per year
export const MT_PER_TREE_10YR = 0.06; // urban tree seedling grown 10 years

/** Merge staff waste logs into the record set (logs replace modeled waste). */
export function mergeLogs(records, logs, provisional = {}) {
  const byKey = groupBy(logs, (l) => `${l.date}|${l.dish}`);
  const out = records.map((r) => {
    const ls = byKey.get(`${r.date}|${r.dish}`);
    if (!ls) return r;
    byKey.delete(`${r.date}|${r.dish}`);
    const dish = dishById[r.dish];
    const leftover = sum(ls.map((l) => Number(l.leftoverPortions) || 0));
    const wasteKg = sum(ls.map((l) => (Number(l.leftoverPortions) || 0) * dish.kg + (Number(l.discardedKg) || 0)));
    return { ...r, leftover, wasteKg: round(wasteKg, 2), consumed: Math.max(0, r.prepared - leftover), logged: true };
  });
  // Logs for days with no operating record yet (e.g. today) become provisional records.
  for (const [key, ls] of byKey) {
    const [date, dishId] = key.split('|');
    const dish = dishById[dishId];
    if (!dish) continue;
    const p = provisional[`${date}|${dishId}`] || {};
    const leftover = sum(ls.map((l) => Number(l.leftoverPortions) || 0));
    const prepared = p.prepared ?? leftover;
    out.push({
      date, hall: dish.hall, dish: dishId, category: dish.category,
      predicted: p.predicted ?? 0, prepared, consumed: Math.max(0, prepared - leftover), leftover,
      wasteKg: round(sum(ls.map((l) => (Number(l.leftoverPortions) || 0) * dish.kg + (Number(l.discardedKg) || 0))), 2),
      source: 'log', mode: 'wasteless', logged: true,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function filterRecords(records, { from, to, hall, dish, category } = {}) {
  return records.filter(
    (r) =>
      (!from || r.date >= from) && (!to || r.date <= to) && (!hall || hall === 'all' || r.hall === hall) &&
      (!dish || dish === 'all' || r.dish === dish) && (!category || category === 'all' || r.category === category),
  );
}

/** Time series grouped daily / weekly / monthly. */
export function aggregate(records, granularity = 'daily') {
  const keyFn = granularity === 'weekly' ? (r) => weekKey(r.date) : granularity === 'monthly' ? (r) => monthKey(r.date) : (r) => r.date;
  const groups = groupBy(records, keyFn);
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, rs]) => ({
      key,
      predicted: sum(rs.map((r) => r.predicted)),
      consumed: sum(rs.map((r) => r.consumed)),
      prepared: sum(rs.map((r) => r.prepared)),
      leftover: sum(rs.map((r) => r.leftover)),
      wasteKg: round(sum(rs.map((r) => r.wasteKg)), 1),
      mape: round(mape(rs.map((r) => r.consumed), rs.map((r) => r.predicted)), 1),
    }));
}

export function kpis(records) {
  const prepared = sum(records.map((r) => r.prepared));
  const consumed = sum(records.map((r) => r.consumed));
  const leftover = sum(records.map((r) => r.leftover));
  return {
    prepared,
    consumed,
    wasteKg: round(sum(records.map((r) => r.wasteKg)), 1),
    leftoverRate: prepared ? round((leftover / prepared) * 100, 1) : 0,
    mape: round(mape(records.map((r) => r.consumed), records.map((r) => r.predicted)), 1),
    accuracy: round(100 - mape(records.map((r) => r.consumed), records.map((r) => r.predicted)), 1),
  };
}

export function wasteByCategory(records) {
  const g = groupBy(records, (r) => r.category);
  return [...g.entries()].map(([category, rs]) => ({ category, wasteKg: round(sum(rs.map((r) => r.wasteKg)), 1) })).sort((a, b) => b.wasteKg - a.wasteKg);
}

/** Menu engineering matrix: popularity vs. waste rate, plus student ratings. */
export function menuAnalysis(records, ratings = []) {
  const g = groupBy(records, (r) => r.dish);
  const rows = DISHES.map((d) => {
    const rs = g.get(d.id) || [];
    const days = new Set(rs.map((r) => r.date)).size || 1;
    const prepared = sum(rs.map((r) => r.prepared));
    const consumed = sum(rs.map((r) => r.consumed));
    const leftover = sum(rs.map((r) => r.leftover));
    const rt = ratings.filter((x) => x.dish === d.id);
    return {
      id: d.id, name: d.name, hall: d.hall, category: d.category,
      avgDaily: round(consumed / days, 1),
      wasteRate: prepared ? round((leftover / prepared) * 100, 1) : 0,
      wasteKg: round(sum(rs.map((r) => r.wasteKg)), 1),
      wasteCost: round(leftover * d.cost, 0),
      rating: rt.length ? round(mean(rt.map((x) => x.stars)), 2) : null,
      reviews: rt.length,
    };
  });
  // Popularity index: dish's average daily servings vs. average of its hall's dishes.
  const hallAvg = Object.fromEntries([...groupBy(rows, (r) => r.hall)].map(([h, rs]) => [h, mean(rs.map((r) => r.avgDaily))]));
  const medianWaste = [...rows.map((r) => r.wasteRate)].sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  return rows.map((r) => {
    const popularity = round((r.avgDaily / (hallAvg[r.hall] || 1)) * 100, 0);
    const popular = popularity >= 100;
    const lowWaste = r.wasteRate <= medianWaste;
    let quadrant, action;
    if (popular && lowWaste) [quadrant, action] = ['Star', 'Keep as is; protect prep levels and promote.'];
    else if (popular && !lowWaste) [quadrant, action] = ['Over-prepped favorite', 'Popular but over-produced: tighten prep batches and use cook-to-order for late service.'];
    else if (!popular && lowWaste) [quadrant, action] = ['Niche', 'Low demand but efficient: keep in smaller batches, consider featuring.'];
    else [quadrant, action] = ['Problem item', 'Low demand and high waste: reduce portions, rework recipe, or rotate off the menu.'];
    if (r.rating != null && r.rating < 3) action += ' Student ratings are low; review recipe quality.';
    return { ...r, popularity, quadrant, action };
  });
}

/**
 * Savings vs. the pre-WasteLess baseline.
 * Baseline = kg of waste per portion served during traditional (par-level) operation.
 */
export function savingsAnalysis(records, settings) {
  const pre = records.filter((r) => r.mode === 'traditional');
  const post = records.filter((r) => r.mode !== 'traditional');
  const baselinePerDish = {};
  for (const d of DISHES) {
    const rs = pre.filter((r) => r.dish === d.id);
    const c = sum(rs.map((r) => r.consumed));
    baselinePerDish[d.id] = c ? sum(rs.map((r) => r.wasteKg)) / c : 0;
  }
  const preRate = sum(pre.map((r) => r.wasteKg)) / Math.max(1, sum(pre.map((r) => r.consumed)));
  const postRate = sum(post.map((r) => r.wasteKg)) / Math.max(1, sum(post.map((r) => r.consumed)));

  const daily = groupBy(post, (r) => r.date);
  let cumKg = 0;
  let cumUsd = 0;
  let cumCo2 = 0;
  const series = [];
  for (const [date, rs] of [...daily.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let kg = 0;
    let usd = 0;
    let co2 = 0;
    for (const r of rs) {
      const d = dishById[r.dish];
      const avoided = baselinePerDish[r.dish] * r.consumed - r.wasteKg;
      kg += avoided;
      usd += (avoided / d.kg) * d.cost;
      co2 += avoided * (d.co2 + DISPOSAL_CO2_PER_KG);
    }
    cumKg += kg;
    cumUsd += usd;
    cumCo2 += co2;
    series.push({ date, kg: round(kg, 1), usd: round(usd, 2), cumKg: round(cumKg, 1), cumUsd: round(cumUsd, 0), cumCo2Mt: round(cumCo2 / 1000, 3) });
  }
  const days = series.length || 1;
  const months = days / 30.4;
  const programCost = Number(settings.implementationCost) + Number(settings.monthlyCost) * months;
  const roi = programCost > 0 ? ((cumUsd - programCost) / programCost) * 100 : 0;
  const dailySavings = cumUsd / days;
  const monthlyNet = dailySavings * 30.4 - Number(settings.monthlyCost);
  const paybackMonths = monthlyNet > 0 ? Number(settings.implementationCost) / monthlyNet : Infinity;
  return {
    baselineKgPerPortion: round(preRate, 4),
    currentKgPerPortion: round(postRate, 4),
    reductionPct: preRate ? round(((preRate - postRate) / preRate) * 100, 1) : 0,
    kgAvoided: round(cumKg, 0),
    usdSaved: round(cumUsd, 0),
    co2AvoidedMt: round(cumCo2 / 1000, 2),
    mealsSaved: round(cumKg / 0.4, 0), // ~0.4 kg per meal (EPA/ReFED convention)
    programCost: round(programCost, 0),
    roi: round(roi, 0),
    paybackMonths: Number.isFinite(paybackMonths) ? round(paybackMonths, 1) : null,
    annualizedSavings: round(dailySavings * 365, 0),
    days,
    series,
  };
}

export function carbonEquivalents(mt) {
  return {
    cars: round(mt / MT_PER_CAR_YEAR, 1),
    trees: Math.round(mt / MT_PER_TREE_10YR),
    miles: Math.round(mt / 0.000393),
  };
}

export function carbonByCategory(records, baselinePerDish) {
  const g = groupBy(records.filter((r) => r.mode !== 'traditional'), (r) => r.category);
  return [...g.entries()].map(([category, rs]) => {
    let co2 = 0;
    for (const r of rs) {
      const d = dishById[r.dish];
      co2 += (baselinePerDish(r.dish) * r.consumed - r.wasteKg) * (d.co2 + DISPOSAL_CO2_PER_KG);
    }
    return { category, mt: round(co2 / 1000, 3) };
  });
}
