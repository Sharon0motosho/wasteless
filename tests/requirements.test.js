// Automated verification of the RTM "Verification & Test Target" column.
// Each describe block is named after the requirement / user story it verifies.

import { describe, it, expect, beforeAll } from 'vitest';
import { DEFAULT_CALENDAR, DISHES, INGREDIENTS, HALLS, GO_LIVE_DAYS_AGO } from '../src/data/catalog.js';
import { generateHistory } from '../src/data/seed.js';
import { syntheticWeather, fetchLiveWeather, weatherFor, phaseFor } from '../src/engine/context.js';
import { trainModel, evaluate, predictDish } from '../src/engine/forecast.js';
import { monitor, retrain, DEFAULT_POLICY } from '../src/engine/retrain.js';
import { forecastDay } from '../src/engine/pipeline.js';
import { prepPlan, prepFor } from '../src/engine/prep.js';
import { purchasingPlan, inventoryAlerts, ingredientNeeds } from '../src/engine/inventory.js';
import { aggregate, kpis, filterRecords, menuAnalysis, savingsAnalysis, carbonEquivalents, mergeLogs, DISPOSAL_CO2_PER_KG } from '../src/engine/analytics.js';
import { validateCSV, toDomain, toCSV, parseCSV, templateCSV } from '../src/engine/csv.js';
import { filterMenu, supplyStatus, crowdProfile, dinersByHall, liveSupply, servedFraction } from '../src/engine/student.js';
import { authenticate, buildUserTable, canAccess } from '../src/engine/auth.js';
import { REQUIREMENTS, FEATURES } from '../src/data/rtm.js';
import { addDays, sum } from '../src/engine/util.js';

const TODAY = '2026-11-10';
const ctx = { calendar: DEFAULT_CALENDAR, weatherOf: syntheticWeather };
let H;
beforeAll(() => {
  H = generateHistory({ calendar: DEFAULT_CALENDAR, weatherOf: syntheticWeather, today: TODAY });
});

describe('RTM completeness', () => {
  it('maps all 23 requirements to the 19 features F1.1–F5.6', () => {
    expect(REQUIREMENTS).toHaveLength(23);
    expect(FEATURES).toHaveLength(19);
    for (const r of REQUIREMENTS) for (const f of r.features) expect(FEATURES.map((x) => x.id)).toContain(f);
    for (const f of FEATURES) expect(REQUIREMENTS.some((r) => r.features.includes(f.id))).toBe(true);
  });
});

describe('R1/US1 · F1.1 Food demand forecasting', () => {
  it('outputs meal unit demand with < 15% MAPE on a time-based holdout', () => {
    const cut = addDays(TODAY, -15);
    const m = trainModel(H.records, cut, ctx);
    const holdout = H.records.filter((r) => r.date > cut);
    const { mape } = evaluate(m, holdout, ctx);
    expect(mape).toBeLessThan(15);
  });
  it('live (online) predictions since go-live stay under 15% MAPE', () => {
    const post = H.records.filter((r) => r.mode === 'wasteless');
    const mape = (100 * sum(post.map((r) => Math.abs(r.consumed - r.predicted) / Math.max(1, r.consumed)))) / post.length;
    expect(mape).toBeLessThan(15);
  });
  it('produces a forecast for every dish', () => {
    const day = forecastDay(TODAY, H.model, ctx);
    expect(day).toHaveLength(DISHES.length);
    day.forEach((r) => expect(r.final).toBeGreaterThan(0));
  });
});

describe('R5/US2 · F1.2 Weather demand adjustments', () => {
  it('rain and cold inputs change the attendance forecast automatically', () => {
    const date = addDays(TODAY, 1);
    const dry = { calendar: DEFAULT_CALENDAR, weatherOf: () => ({ tempC: 18, precipMm: 0 }) };
    const wet = { calendar: DEFAULT_CALENDAR, weatherOf: () => ({ tempC: 2, precipMm: 20 }) };
    const a = predictDish(H.model, date, 'D01', dry);
    const b = predictDish(H.model, date, 'D01', wet);
    expect(a.weatherFactor).toBeCloseTo(1, 5);
    expect(b.weatherFactor).not.toBeCloseTo(1, 2);
    expect(Math.abs(b.value - a.value)).toBeGreaterThan(1);
  });
  it('parses the live Open-Meteo feed and lets what-if scenarios override it', async () => {
    const fake = async () => ({ ok: true, json: async () => ({ daily: { time: ['2026-11-11'], temperature_2m_max: [10], temperature_2m_min: [4], precipitation_sum: [12.3], weathercode: [63] } }) });
    const live = await fetchLiveWeather({ lat: 0, lon: 0 }, 1, fake);
    expect(live['2026-11-11']).toMatchObject({ tempC: 7, precipMm: 12.3, condition: 'Rain', source: 'live' });
    expect(weatherFor('2026-11-11', live, { '2026-11-11': { tempC: -5, precipMm: 30 } }).source).toBe('what-if');
  });
});

describe('R6/US3 · F1.1/F1.2 Academic calendar & events', () => {
  it('resolves phases from the calendar', () => {
    expect(phaseFor('2026-12-08', DEFAULT_CALENDAR).phase).toBe('finals');
    expect(phaseFor('2026-11-26', DEFAULT_CALENDAR).phase).toBe('break');
    expect(phaseFor('2026-11-10', DEFAULT_CALENDAR).phase).toBe('regular');
  });
  it('break lowers and finals/events raise forecast demand', () => {
    const w = { calendar: DEFAULT_CALENDAR, weatherOf: () => ({ tempC: 18, precipMm: 0 }) };
    const regular = predictDish(H.model, '2026-11-18', 'D01', w).calendarFactor; // Wednesday
    const brk = predictDish(H.model, '2026-11-25', 'D01', w).calendarFactor; // Wednesday, Thanksgiving break
    const finals = predictDish(H.model, '2026-12-09', 'D01', w).calendarFactor; // Wednesday, finals
    expect(brk).toBeLessThan(regular * 0.6);
    expect(finals).toBeGreaterThan(regular);
    const withEvent = { ...w, calendar: [...DEFAULT_CALENDAR, { id: 'x', type: 'event', label: 'Game', start: '2026-11-18', end: '2026-11-18', multiplier: 1.2 }] };
    expect(predictDish(H.model, '2026-11-18', 'D01', withEvent).calendarFactor).toBeCloseTo(regular * 1.2, 5);
  });
});

describe('R9/US4 · F1.3 ML model retraining', () => {
  it('prediction error delta automatically triggers retraining', () => {
    // A model trained on summer-only data drifts once the fall term starts.
    const stale = retrain(H.records, addDays(TODAY, -GO_LIVE_DAYS_AGO), ctx, 0);
    const m = monitor(stale, H.records, addDays(TODAY, -GO_LIVE_DAYS_AGO + 30), ctx, { ...DEFAULT_POLICY, maxAgeDays: 999 });
    expect(m.shouldRetrain).toBe(true);
    expect(m.reasons.join(' ')).toMatch(/MAPE|delta/);
  });
  it('the simulated history logged automatic retrains, including an error-triggered one', () => {
    expect(H.retrainLog.length).toBeGreaterThan(1);
    expect(H.retrainLog.some((l) => l.reasons.some((r) => /MAPE|delta/.test(r)))).toBe(true);
  });
  it('a fresh model is within tolerance and does not retrain in a loop', () => {
    const m = monitor(H.model, H.records, addDays(TODAY, -1), ctx);
    const fresh = retrain(H.records, addDays(TODAY, -1), ctx, H.model.version);
    expect(monitor(fresh, H.records, addDays(TODAY, -1), ctx).shouldRetrain).toBe(false);
    expect(typeof m.rollingMape).toBe('number');
  });
});

describe('R13/US5 · F1.4 Manual forecast overrides', () => {
  const base = { createdAt: '2026-11-10T10:00:00Z', active: true };
  it('percent and absolute overrides replace the model forecast; dish beats hall', () => {
    const date = addDays(TODAY, 1);
    const plain = forecastDay(date, H.model, ctx).find((r) => r.dish === 'D01');
    const overrides = [
      { ...base, id: 'a', date, hall: 'north', dish: null, mode: 'percent', value: 50 },
      { ...base, id: 'b', date, hall: 'north', dish: 'D01', mode: 'absolute', value: 400 },
    ];
    const day = forecastDay(date, H.model, ctx, { overrides });
    expect(day.find((r) => r.dish === 'D01').final).toBe(400);
    const d02plain = forecastDay(date, H.model, ctx).find((r) => r.dish === 'D02').final;
    expect(day.find((r) => r.dish === 'D02').final).toBeCloseTo(d02plain * 1.5, -1);
    expect(plain.final).not.toBe(400);
  });
  it('inactive overrides are ignored', () => {
    const date = addDays(TODAY, 1);
    const day = forecastDay(date, H.model, ctx, { overrides: [{ ...base, id: 'c', date, hall: 'north', dish: 'D01', mode: 'absolute', value: 1, active: false }] });
    expect(day.find((r) => r.dish === 'D01').final).toBeGreaterThan(1);
  });
});

describe('R3/US6 · F2.1 Daily prep recommendations', () => {
  it('prep covers expected demand with bounded buffer and beats par over a week', () => {
    // Par levels ignore weekday patterns (under-prep busy days, over-prep weekends),
    // so the comparison that matters is across a full week.
    let prep = 0;
    let par = 0;
    for (let i = 0; i < 7; i++) {
      const plan = prepPlan(forecastDay(addDays(TODAY, i), H.model, ctx), H.records, 0.9);
      for (const p of plan) {
        expect(p.recommended).toBeGreaterThanOrEqual(p.final);
        expect(p.recommended).toBeLessThanOrEqual(Math.ceil(p.final * 1.35) + 2);
      }
      prep += sum(plan.map((p) => p.recommended));
      par += sum(plan.map((p) => p.par));
    }
    expect(prep).toBeLessThan(par);
  });
  it('batches sum to the recommended quantity and higher service level means more prep', () => {
    const row = forecastDay(TODAY, H.model, ctx)[0];
    const p = prepFor(row, 0.85);
    expect(sum(p.batches.map((b) => b.qty))).toBe(p.recommended);
    expect(prepFor(row, 0.97).recommended).toBeGreaterThan(prepFor(row, 0.7).recommended);
  });
  it('cut leftover prep vs. the traditional period in the simulated history', () => {
    const rate = (mode) => {
      const rs = H.records.filter((r) => r.mode === mode);
      return sum(rs.map((r) => r.leftover)) / sum(rs.map((r) => r.prepared));
    };
    expect(rate('wasteless')).toBeLessThan(rate('traditional') * 0.7);
  });
});

describe('R2/US7 · F2.2 Purchasing recommendations', () => {
  const days = Array.from({ length: 7 }, () => Object.fromEntries(DISHES.map((d) => [d.id, 100])));
  const stock = Object.fromEntries(INGREDIENTS.map((i) => [i.id, { onHand: 0, onOrder: 0 }]));
  it('order quantities incorporate lead time and safety stock, rounded to pack size', () => {
    const plan = purchasingPlan({ dailyForecasts: days, stock, serviceLevel: 0.95 });
    for (const p of plan) {
      if (p.coverDemand === 0) continue;
      expect(p.safetyStock).toBeGreaterThan(0);
      expect(p.leadDemand).toBeCloseTo(p.avgDaily * p.leadTime, 0);
      expect(p.orderQty).toBeGreaterThanOrEqual(p.coverDemand + p.safetyStock - 1e-9);
      expect(p.orderQty % p.pack).toBe(0);
    }
  });
  it('nets out stock on hand / on order and higher service level raises safety stock', () => {
    const full = Object.fromEntries(INGREDIENTS.map((i) => [i.id, { onHand: 1e6, onOrder: 0 }]));
    expect(purchasingPlan({ dailyForecasts: days, stock: full }).every((p) => p.orderQty === 0)).toBe(true);
    const a = purchasingPlan({ dailyForecasts: days, stock, serviceLevel: 0.9 });
    const b = purchasingPlan({ dailyForecasts: days, stock, serviceLevel: 0.99 });
    expect(b[0].safetyStock).toBeGreaterThan(a[0].safetyStock);
  });
});

describe('R11/US8 · F2.3 Low inventory alerts', () => {
  it('alerts critical when on hand < requirement and warning when inside safety stock', () => {
    const prep = { D01: 100 }; // needs 18 kg chicken (I01)
    const need = ingredientNeeds(prep).I01;
    const crit = inventoryAlerts(prep, { I01: { onHand: need - 1 } });
    expect(crit.find((a) => a.ingredient === 'I01').level).toBe('critical');
    const warn = inventoryAlerts(prep, { I01: { onHand: need + 1 } }, { I01: 5 });
    expect(warn.find((a) => a.ingredient === 'I01').level).toBe('warning');
    const ok = inventoryAlerts(prep, { I01: { onHand: need + 10 }, I10: { onHand: 99 }, I12: { onHand: 99 } }, { I01: 5 });
    expect(ok.find((a) => a.ingredient === 'I01')).toBeUndefined();
  });
});

describe('R12/US9 · F2.4 Meal popularity analysis', () => {
  it('classifies top and underperforming items from consumption vs. waste', () => {
    const rows = menuAnalysis(H.records.filter((r) => r.date > addDays(TODAY, -30)), []);
    expect(rows).toHaveLength(DISHES.length);
    const quadrants = new Set(rows.map((r) => r.quadrant));
    expect(quadrants.size).toBeGreaterThanOrEqual(3);
    const star = rows.find((r) => r.quadrant === 'Star');
    const prob = rows.find((r) => r.quadrant === 'Problem item');
    if (star && prob) {
      expect(star.popularity).toBeGreaterThanOrEqual(100);
      expect(prob.popularity).toBeLessThan(100);
      expect(prob.wasteRate).toBeGreaterThan(star.wasteRate);
    }
  });
  it('incorporates student ratings (R23)', () => {
    const rows = menuAnalysis(H.records.slice(-300), [{ dish: 'D02', stars: 2 }, { dish: 'D02', stars: 2 }]);
    const d2 = rows.find((r) => r.id === 'D02');
    expect(d2.rating).toBe(2);
    expect(d2.action).toMatch(/ratings are low/);
  });
});

describe('R7/US10 · F3.1 Daily food waste logging', () => {
  it('logged leftover portions and discarded kg replace modeled waste and categorize by dish', () => {
    const r = H.records.find((x) => x.dish === 'D01');
    const merged = mergeLogs([r], [{ date: r.date, dish: 'D01', leftoverPortions: 10, discardedKg: 1.5 }]);
    expect(merged[0].leftover).toBe(10);
    expect(merged[0].wasteKg).toBeCloseTo(10 * 0.32 + 1.5, 2);
    expect(merged[0].category).toBe('Entrée');
  });
  it('creates a provisional record for a day without history (shift end today)', () => {
    const merged = mergeLogs([], [{ date: TODAY, dish: 'D03', leftoverPortions: 4, discardedKg: 0 }], { [`${TODAY}|D03`]: { prepared: 120, predicted: 110 } });
    expect(merged[0]).toMatchObject({ date: TODAY, prepared: 120, consumed: 116, category: 'Vegetarian' });
  });
});

describe('R4/US12 + R8/US11 · F3.2 Historical access & analytics dashboard', () => {
  it('aggregates predicted, consumed and waste side-by-side daily/weekly/monthly', () => {
    const recs = filterRecords(H.records, { from: addDays(TODAY, -60), hall: 'north' });
    expect(recs.every((r) => r.hall === 'north')).toBe(true);
    const d = aggregate(recs, 'daily');
    const w = aggregate(recs, 'weekly');
    const m = aggregate(recs, 'monthly');
    expect(d.length).toBeGreaterThan(w.length);
    expect(w.length).toBeGreaterThan(m.length);
    for (const s of [d, w, m]) {
      expect(sum(s.map((x) => x.consumed))).toBe(sum(recs.map((r) => r.consumed)));
      expect(s[0]).toHaveProperty('predicted');
      expect(s[0]).toHaveProperty('wasteKg');
    }
    expect(kpis(recs).mape).toBeLessThan(15);
  });
});

describe('R10/US13 · F3.3 Financial cost savings', () => {
  it('computes cumulative savings and $ saved per kg avoided from the baseline', () => {
    const s = savingsAnalysis(H.records, { implementationCost: 10000, monthlyCost: 500 });
    expect(s.kgAvoided).toBeGreaterThan(0);
    expect(s.usdSaved).toBeGreaterThan(0);
    expect(s.series[s.series.length - 1].cumUsd).toBeCloseTo(s.usdSaved, -1);
    expect(s.currentKgPerPortion).toBeLessThan(s.baselineKgPerPortion);
    const perKg = s.usdSaved / s.kgAvoided;
    expect(perKg).toBeGreaterThan(3);
    expect(perKg).toBeLessThan(20);
    expect(s.roi).toBeCloseTo(((s.usdSaved - s.programCost) / s.programCost) * 100, -1);
  });
  it('a hand-built baseline gives the exact expected savings', () => {
    const d = DISHES[0];
    const recs = [
      { date: '2026-01-01', dish: d.id, hall: d.hall, category: d.category, consumed: 100, wasteKg: 20, mode: 'traditional' },
      { date: '2026-02-01', dish: d.id, hall: d.hall, category: d.category, consumed: 100, wasteKg: 5, mode: 'wasteless' },
    ];
    const s = savingsAnalysis(recs, { implementationCost: 0, monthlyCost: 0 });
    expect(s.kgAvoided).toBe(15);
    expect(s.usdSaved).toBeCloseTo((15 / d.kg) * d.cost, 0);
    expect(s.co2AvoidedMt).toBeCloseTo((15 * (d.co2 + DISPOSAL_CO2_PER_KG)) / 1000, 2);
  });
});

describe('R14/US14 · F3.4 Sustainability impact reporting', () => {
  it('reports MT CO2e avoided with equivalents and exports CSV', () => {
    const s = savingsAnalysis(H.records, { implementationCost: 0, monthlyCost: 0 });
    expect(s.co2AvoidedMt).toBeGreaterThan(0);
    const eq = carbonEquivalents(s.co2AvoidedMt);
    expect(eq.cars).toBeCloseTo(s.co2AvoidedMt / 4.6, 0);
    const csv = toCSV([{ month: '2026-10', co2e_avoided_mt: 1.234 }]);
    expect(csv).toBe('month,co2e_avoided_mt\n2026-10,1.234');
  });
  it('CSV export neutralizes spreadsheet formula injection', () => {
    expect(toCSV([{ a: '=HYPERLINK("x")' }])).toContain(`"'=HYPERLINK(""x"")"`);
    expect(toCSV([{ a: -5 }])).toBe('a\n-5');
  });
});

describe('R15/US15 · F4.1 Data ingestion & uploads', () => {
  it('accepts a valid template and converts rows to records', () => {
    const v = validateCSV(templateCSV('sales'), 'sales', { today: TODAY });
    expect(v.fileErrors).toEqual([]);
    expect(v.validRows).toHaveLength(1);
    const [rec] = toDomain('sales', v.validRows, 'b1');
    expect(rec).toMatchObject({ dish: 'D01', prepared: 260, consumed: 241, leftover: 19, batchId: 'b1' });
  });
  it('rejects missing columns, bad types, unknown ids, future dates and duplicates', () => {
    expect(validateCSV('date,hall\n2026-01-01,north', 'sales', { today: TODAY }).fileErrors[0]).toMatch(/Missing required column/);
    const csv = [
      'date,hall,dish_id,prepared,consumed',
      '2026-11-01,north,D01,100,90',
      '2026-11-01,north,D01,100,90', // duplicate
      '2026-11-01,north,D99,100,90', // unknown dish
      '2026-11-01,north,D07,100,90', // dish/hall mismatch (D07 is served at south)
      '2026-11-01,north,D02,100,120', // consumed > prepared
      '11/01/2026,north,D03,100,90', // bad date
      '2030-01-01,north,D04,100,90', // future
      '2026-11-01,north,D05,ten,9', // not a number
    ].join('\n');
    const v = validateCSV(csv, 'sales', { today: TODAY });
    expect(v.validRows).toHaveLength(1);
    expect(v.invalidCount).toBe(7);
    expect(v.duplicates).toBe(1);
  });
  it('validates inventory units and waste enums', () => {
    const inv = validateCSV('date,ingredient_id,on_hand,unit\n2026-11-01,I01,10,L', 'inventory', { today: TODAY });
    expect(inv.rows[0].errors.join()).toMatch(/unit must be kg/);
    const w = validateCSV('date,shift,hall,dish_id,leftover_portions,discarded_kg,reason\n2026-11-01,Brunch,north,D01,1,1,Overproduction', 'waste', { today: TODAY });
    expect(w.rows[0].errors.join()).toMatch(/shift/);
  });
  it('parses quoted CSV fields', () => {
    expect(parseCSV('a,b\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });
  it('restricts uploads to authenticated administrators', async () => {
    const users = await buildUserTable();
    expect((await authenticate(users, 'admin', 'wrong')).ok).toBe(false);
    const ok = await authenticate(users, 'admin', 'admin123');
    expect(ok.ok).toBe(true);
    expect(canAccess(ok.user.role, 'admin')).toBe(true);
    expect(canAccess('manager', 'admin')).toBe(false);
    expect(canAccess('student', 'staff')).toBe(false);
    expect(users.every((u) => !('password' in u) && u.hash.length === 64)).toBe(true);
  });
  it('locks the account after repeated failed sign-ins', async () => {
    const users = await buildUserTable();
    let attempts = {};
    for (let i = 0; i < 5; i++) attempts = (await authenticate(users, 'admin', 'nope', attempts)).attempts;
    const res = await authenticate(users, 'admin', 'admin123', attempts);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/locked/i);
  });
});

describe('R16/US18 · F5.1 Real-time meal availability', () => {
  it('remaining portions per dining facility decrease as service progresses', () => {
    const plan = prepPlan(forecastDay(TODAY, H.model, ctx), H.records, 0.9);
    const morning = liveSupply(plan, TODAY, 9);
    const evening = liveSupply(plan, TODAY, 20);
    for (let i = 0; i < plan.length; i++) expect(evening[i].remaining).toBeLessThanOrEqual(morning[i].remaining);
    expect(servedFraction('north', 6)).toBe(0);
    expect(servedFraction('north', 22)).toBeCloseTo(1, 5);
  });
  it('staff counts entered on the line override the simulation', () => {
    const plan = prepPlan(forecastDay(TODAY, H.model, ctx), H.records, 0.9);
    const s = liveSupply(plan, TODAY, 12, { D01: { remaining: 3, at: 12 } });
    expect(s.find((x) => x.dish === 'D01').remaining).toBe(3);
  });
});

describe('R20/US18 · F5.1 Dietary & allergy filtering', () => {
  it('returns only dishes with every selected diet tag and none of the excluded allergens', () => {
    const vegan = filterMenu(DISHES, { diets: ['vegan'] });
    expect(vegan.length).toBeGreaterThan(0);
    expect(vegan.every((d) => d.diet.includes('vegan'))).toBe(true);
    const gfNoDairy = filterMenu(DISHES, { diets: ['gluten-free'], excludeAllergens: ['dairy'] });
    expect(gfNoDairy.every((d) => d.diet.includes('gluten-free') && !d.allergens.includes('dairy'))).toBe(true);
    expect(gfNoDairy.find((d) => d.id === 'D06')).toBeUndefined(); // tomato soup contains dairy
    expect(filterMenu(DISHES, { excludeAllergens: ['nuts'] }).some((d) => d.allergens.includes('nuts'))).toBe(false);
    expect(filterMenu(DISHES, { hall: 'market' }).every((d) => d.hall === 'market')).toBe(true);
  });
});

describe('R19/US20 · F5.2 Low supply notifications', () => {
  it('flags low at ≤20% remaining and sold out at zero', () => {
    expect(supplyStatus(50, 100)).toBe('available');
    expect(supplyStatus(20, 100)).toBe('low');
    expect(supplyStatus(5, 100)).toBe('low');
    expect(supplyStatus(0, 100)).toBe('sold-out');
  });
});

describe('R18/US19 · F5.3 Dining hall crowd predictions', () => {
  it('produces hourly occupancy for each hall with lunch/dinner peaks', () => {
    const diners = dinersByHall(forecastDay(TODAY, H.model, ctx));
    for (const h of HALLS) {
      const prof = crowdProfile(h.id, diners[h.id]);
      expect(prof).toHaveLength(h.close - h.open);
      prof.forEach((p) => { expect(p.pct).toBeGreaterThanOrEqual(0); expect(p.pct).toBeLessThanOrEqual(100); });
      // Peaks fall inside a meal window (grab & go can peak at breakfast).
      const peak = [...prof].sort((a, b) => b.pct - a.pct)[0];
      expect([7, 8, 9, 11, 12, 13, 17, 18, 19, 20]).toContain(peak.hour);
    }
    const busy = crowdProfile('north', 2000);
    const quiet = crowdProfile('north', 500);
    expect(busy[5].pct).toBeGreaterThan(quiet[5].pct);
  });
});

describe('R17/US21 + R21/US21 · F5.4 Student preferences & attendance surveys', () => {
  it('planned attendance and favorites raise the short-term demand signal', () => {
    const date = addDays(TODAY, 1);
    const base = forecastDay(date, H.model, ctx).find((r) => r.dish === 'D03');
    const surveys = Array.from({ length: 30 }, (_, i) => ({ date, hall: 'north', meal: 'Lunch', student: `s${i}` }));
    const favorites = Array.from({ length: 5 }, (_, i) => ({ dish: 'D03', student: `s${i}` }));
    const sig = forecastDay(date, H.model, ctx, { surveys, favorites }).find((r) => r.dish === 'D03');
    expect(sig.responses).toBe(30);
    expect(sig.favCount).toBe(5);
    expect(sig.final).toBeGreaterThan(base.final);
    const other = forecastDay(date, H.model, ctx, { surveys, favorites }).find((r) => r.dish === 'D07');
    expect(other.responses).toBe(0); // south hall unaffected by north responses
  });
});

describe('R22/US23 · F5.6 Campus waste awareness metrics', () => {
  it('publishes campus-wide totals usable for milestones', () => {
    const s = savingsAnalysis(H.records, { implementationCost: 0, monthlyCost: 0 });
    expect(Math.abs(s.mealsSaved - s.kgAvoided / 0.4)).toBeLessThanOrEqual(2);
    expect(s.reductionPct).toBeGreaterThan(0);
  });
});

describe('R23/US22 · F5.5 Student ratings & feedback', () => {
  it('ratings feed the kitchen-facing analyzer with averages and counts', () => {
    const rows = menuAnalysis(H.records.slice(-300), [{ dish: 'D03', stars: 5 }, { dish: 'D03', stars: 4 }]);
    const d = rows.find((r) => r.id === 'D03');
    expect(d.rating).toBe(4.5);
    expect(d.reviews).toBe(2);
  });
});
