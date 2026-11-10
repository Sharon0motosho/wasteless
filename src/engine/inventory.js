// F2.2 Purchasing & Safety Stock Calculator
// F2.3 Low Stock & Shortage Alert System

import { DISHES, INGREDIENTS } from '../data/catalog.js';
import { zScore, round } from './util.js';

/** Ingredient usage implied by a list of per-dish portion quantities. */
export function ingredientNeeds(portionsByDish) {
  const need = Object.fromEntries(INGREDIENTS.map((i) => [i.id, 0]));
  for (const d of DISHES) {
    const q = portionsByDish[d.id] || 0;
    for (const [ing, per] of Object.entries(d.recipe)) need[ing] += q * per;
  }
  return need;
}

/**
 * Purchasing recommendation per ingredient.
 * dailyForecasts: array (one entry per upcoming day) of { [dishId]: portions }
 * sigmaRel: per-dish relative forecast error, used for ingredient-level demand spread
 * stock: { [ingId]: { onHand, onOrder } }
 */
export function purchasingPlan({ dailyForecasts, sigmaRel = {}, stock, serviceLevel = 0.95, reviewDays = 1 }) {
  const z = zScore(serviceLevel);
  const daily = dailyForecasts.map(ingredientNeeds);
  // Daily standard deviation of ingredient usage from dish-level forecast error.
  const sdDaily = Object.fromEntries(INGREDIENTS.map((i) => [i.id, 0]));
  for (const day of dailyForecasts) {
    const varByIng = Object.fromEntries(INGREDIENTS.map((i) => [i.id, 0]));
    for (const d of DISHES) {
      const sd = (day[d.id] || 0) * (sigmaRel[d.id] ?? 0.12);
      for (const [ing, per] of Object.entries(d.recipe)) varByIng[ing] += (sd * per) ** 2;
    }
    for (const id in varByIng) sdDaily[id] += Math.sqrt(varByIng[id]) / dailyForecasts.length;
  }

  return INGREDIENTS.map((ing) => {
    const s = stock[ing.id] || { onHand: ing.onHand, onOrder: 0 };
    const cover = Math.min(ing.leadTime + reviewDays, daily.length);
    const leadDemand = daily.slice(0, ing.leadTime).reduce((a, d) => a + d[ing.id], 0);
    const coverDemand = daily.slice(0, cover).reduce((a, d) => a + d[ing.id], 0);
    const horizonDemand = daily.reduce((a, d) => a + d[ing.id], 0);
    const safetyStock = z * sdDaily[ing.id] * Math.sqrt(ing.leadTime);
    const reorderPoint = leadDemand + safetyStock;
    const position = s.onHand + s.onOrder;
    const rawQty = Math.max(0, coverDemand + safetyStock - position);
    const orderQty = rawQty > 0 ? Math.ceil(rawQty / ing.pack) * ing.pack : 0;
    // Naive baseline: order the whole horizon's demand +30% with no netting.
    const naiveQty = Math.ceil((horizonDemand * 1.3) / ing.pack) * ing.pack;
    return {
      ...ing,
      onHand: s.onHand,
      onOrder: s.onOrder,
      avgDaily: round(horizonDemand / Math.max(daily.length, 1), 2),
      leadDemand: round(leadDemand, 2),
      coverDemand: round(coverDemand, 2),
      safetyStock: round(safetyStock, 2),
      reorderPoint: round(reorderPoint, 2),
      belowReorder: position < reorderPoint,
      orderQty,
      orderCost: round(orderQty * ing.cost, 2),
      naiveQty,
      naiveCost: round(naiveQty * ing.cost, 2),
      daysOfCover: round(s.onHand / Math.max(horizonDemand / Math.max(daily.length, 1), 1e-6), 1),
    };
  });
}

/**
 * Alerts when current inventory cannot cover today's predicted prep.
 * critical: on hand < today's requirement
 * warning:  on hand < today's requirement + safety stock
 */
export function inventoryAlerts(prepPortions, stock, safetyStockById = {}) {
  const need = ingredientNeeds(prepPortions);
  const alerts = [];
  for (const ing of INGREDIENTS) {
    const required = need[ing.id];
    if (required <= 0) continue;
    const onHand = stock[ing.id]?.onHand ?? ing.onHand;
    const ss = safetyStockById[ing.id] || 0;
    let level = null;
    if (onHand < required) level = 'critical';
    else if (onHand < required + ss) level = 'warning';
    if (!level) continue;
    const affected = DISHES.filter((d) => d.recipe[ing.id] && (prepPortions[d.id] || 0) > 0).map((d) => d.name);
    alerts.push({
      id: `${ing.id}-${level}`,
      ingredient: ing.id,
      name: ing.name,
      unit: ing.unit,
      level,
      onHand: round(onHand, 2),
      required: round(required, 2),
      shortfall: round(Math.max(0, required - onHand), 2),
      safetyStock: round(ss, 2),
      coverage: round((onHand / required) * 100, 0),
      affected,
    });
  }
  return alerts.sort((a, b) => (a.level === b.level ? a.coverage - b.coverage : a.level === 'critical' ? -1 : 1));
}
