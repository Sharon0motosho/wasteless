import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, useCallback } from 'react';
import { DEFAULT_CALENDAR, DEFAULT_LOCATION, INGREDIENTS, DISHES } from './data/catalog.js';
import { generateHistory } from './data/seed.js';
import { syntheticWeather, weatherFor, fetchLiveWeather } from './engine/context.js';
import { forecastDay } from './engine/pipeline.js';
import { prepPlan } from './engine/prep.js';
import { purchasingPlan, inventoryAlerts } from './engine/inventory.js';
import { mergeLogs } from './engine/analytics.js';
import { monitor, retrain, DEFAULT_POLICY } from './engine/retrain.js';
import { buildUserTable, SESSION_TIMEOUT_MS } from './engine/auth.js';
import { todayISO, addDays, uid } from './engine/util.js';

const STORAGE_KEY = 'wasteless:v1';
const TODAY = todayISO();

// Deterministic synthetic history (computed once per page load).
const HISTORY = generateHistory({ calendar: DEFAULT_CALENDAR, weatherOf: syntheticWeather, today: TODAY });

const initialState = () => ({
  historyDate: TODAY,
  calendar: DEFAULT_CALENDAR,
  location: DEFAULT_LOCATION,
  liveWeather: {},
  weatherStatus: { state: 'idle' },
  whatIf: {},
  overrides: [],
  surveys: seedSurveys(),
  favorites: seedFavorites(),
  studentPrefs: { diets: [], allergens: [] },
  ratings: seedRatings(),
  wasteLogs: [],
  stock: Object.fromEntries(INGREDIENTS.map((i) => [i.id, { onHand: i.onHand, onOrder: i.onOrder }])),
  purchaseOrders: [],
  imports: { batches: [], sales: [], inventory: [] },
  model: null,
  retrainLog: HISTORY.retrainLog,
  monitorSeries: HISTORY.monitorSeries,
  policy: DEFAULT_POLICY,
  settings: { serviceLevel: 0.9, purchaseServiceLevel: 0.95, horizonDays: 7, implementationCost: 18000, monthlyCost: 650, esgTargetPct: 30, esgTargetYear: 2027 },
  session: null,
  attempts: {},
  audit: [],
  ackAlerts: [],
  notifyMe: [],
  notifications: [],
  liveManual: {},
  studentId: uid('stu'),
  prepDone: {},
});

// Community responses already submitted by other (anonymous) students.
function seedSurveys() {
  const out = [];
  const meals = ['Breakfast', 'Lunch', 'Dinner'];
  // Roughly the typical 1.5% panel response rate, with a few days running above it.
  const perHall = { north: 18, south: 10, market: 5 };
  const bump = [1, 1.25, 0.9, 1, 1.15, 0.85, 1];
  for (let i = 0; i < 7; i++) {
    const date = addDays(TODAY, i);
    for (const [hall, n] of Object.entries(perHall)) {
      const k = Math.round(n * bump[i]);
      for (let j = 0; j < k; j++) out.push({ id: `seed_s${i}_${hall}_${j}`, student: `seed${j}`, date, hall, meal: meals[j % 3], seed: true });
    }
  }
  return out;
}

function seedFavorites() {
  const weights = { D03: 9, D01: 7, D07: 6, D13: 6, D09: 5, D08: 4, D11: 3, D14: 3, D15: 4 };
  return Object.entries(weights).flatMap(([dish, n]) => Array.from({ length: n }, (_, j) => ({ dish, student: `seed${j}`, seed: true })));
}

function seedRatings() {
  const comments = ['Great flavor!', 'A bit too salty today.', 'Portion was perfect.', 'Was lukewarm when served.', 'Would love this more often.', ''];
  const tags = [['Tasty'], ['Too salty'], ['Good portion'], ['Served cold'], ['Tasty', 'Good portion'], []];
  const out = [];
  let k = 0;
  for (const d of DISHES) {
    const base = { D02: 2.6, D10: 2.4, D03: 4.6, D13: 4.4, D07: 4.3 }[d.id] ?? 3.8;
    for (let i = 0; i < 4; i++) {
      const stars = Math.max(1, Math.min(5, Math.round(base + ((k * 7) % 5 - 2) * 0.4)));
      out.push({ id: `seed_r${k}`, dish: d.id, stars, tags: tags[k % 6], comment: comments[k % 6], date: addDays(TODAY, -1 - (k % 9)), createdAt: new Date().toISOString(), seed: true });
      k++;
    }
  }
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const saved = JSON.parse(raw);
    // History is regenerated relative to today; drop model state built on an older day.
    if (saved.historyDate !== TODAY) {
      delete saved.model;
      delete saved.retrainLog;
      delete saved.monitorSeries;
      delete saved.liveManual;
    }
    return { ...initialState(), ...saved, historyDate: TODAY, weatherStatus: { state: 'idle' } };
  } catch {
    return initialState();
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'set':
      return { ...state, ...action.patch };
    case 'update':
      return { ...state, [action.key]: action.fn(state[action.key]) };
    case 'audit':
      return { ...state, audit: [{ id: uid('a'), at: new Date().toISOString(), user: state.session?.user?.username || 'student', ...action.entry }, ...state.audit].slice(0, 300) };
    case 'reset':
      return { ...initialState(), session: state.session };
    default:
      return state;
  }
}

const Ctx = createContext(null);

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  const [users, setUsers] = useState([]);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    buildUserTable().then(setUsers);
  }, []);

  useEffect(() => {
    const { weatherStatus, ...persist } = state;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
    } catch {
      /* storage full or unavailable: keep running in memory */
    }
  }, [state]);

  const set = useCallback((patch) => dispatch({ type: 'set', patch }), []);
  const update = useCallback((key, fn) => dispatch({ type: 'update', key, fn }), []);
  const audit = useCallback((action, detail) => dispatch({ type: 'audit', entry: { action, detail } }), []);
  const toast = useCallback((msg, tone = 'info') => {
    const id = uid('t');
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  // Session inactivity timeout.
  useEffect(() => {
    if (!state.session) return;
    const t = setInterval(() => {
      if (Date.now() - state.session.lastActive > SESSION_TIMEOUT_MS) {
        set({ session: null });
        toast('Session expired after 30 minutes of inactivity.', 'warn');
      }
    }, 15000);
    const bump = () => {
      if (state.session && Date.now() - state.session.lastActive > 60000) set({ session: { ...state.session, lastActive: Date.now() } });
    };
    window.addEventListener('click', bump);
    return () => {
      clearInterval(t);
      window.removeEventListener('click', bump);
    };
  }, [state.session, set, toast]);

  // Live weather feed (R5).
  const refreshWeather = useCallback(async () => {
    set({ weatherStatus: { state: 'loading' } });
    try {
      const live = await fetchLiveWeather(state.location, 7);
      set({ liveWeather: live, weatherStatus: { state: 'live', at: new Date().toISOString() } });
    } catch (e) {
      set({ weatherStatus: { state: 'offline', error: String(e.message || e), at: new Date().toISOString() } });
    }
  }, [state.location, set]);

  const didFetch = useRef(false);
  useEffect(() => {
    if (didFetch.current) return;
    didFetch.current = true;
    refreshWeather();
  }, [refreshWeather]);

  const ctx = useMemo(
    () => ({ calendar: state.calendar, weatherOf: (iso) => weatherFor(iso, state.liveWeather, state.whatIf) }),
    [state.calendar, state.liveWeather, state.whatIf],
  );

  const model = state.model || HISTORY.model;

  // Operating records = seed history, replaced by imported sales, merged with staff waste logs.
  const baseRecords = useMemo(() => {
    const imported = new Map(state.imports.sales.map((r) => [`${r.date}|${r.dish}`, r]));
    const seedKeys = new Set();
    const out = HISTORY.records.map((r) => {
      const k = `${r.date}|${r.dish}`;
      seedKeys.add(k);
      return imported.get(k) || r;
    });
    for (const [k, r] of imported) if (!seedKeys.has(k)) out.push(r);
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [state.imports.sales]);

  const signals = useMemo(
    () => ({ surveys: state.surveys, favorites: state.favorites, overrides: state.overrides }),
    [state.surveys, state.favorites, state.overrides],
  );

  const horizon = useMemo(
    () => Array.from({ length: state.settings.horizonDays }, (_, i) => addDays(TODAY, i)),
    [state.settings.horizonDays],
  );

  const forecasts = useMemo(() => Object.fromEntries(horizon.map((d) => [d, forecastDay(d, model, ctx, signals)])), [horizon, model, ctx, signals]);

  const todayPrep = useMemo(() => prepPlan(forecasts[TODAY], baseRecords, state.settings.serviceLevel), [forecasts, baseRecords, state.settings.serviceLevel]);

  const records = useMemo(() => {
    const provisional = Object.fromEntries(todayPrep.map((p) => [`${TODAY}|${p.dish}`, { prepared: p.recommended, predicted: p.final }]));
    return mergeLogs(baseRecords, state.wasteLogs, provisional);
  }, [baseRecords, state.wasteLogs, todayPrep]);

  const purchasing = useMemo(
    () =>
      purchasingPlan({
        dailyForecasts: horizon.map((d) => Object.fromEntries(forecasts[d].map((r) => [r.dish, r.final]))),
        sigmaRel: model.sigmaRel,
        stock: state.stock,
        serviceLevel: state.settings.purchaseServiceLevel,
      }),
    [horizon, forecasts, model, state.stock, state.settings.purchaseServiceLevel],
  );

  const alerts = useMemo(() => {
    const ss = Object.fromEntries(purchasing.map((p) => [p.id, p.safetyStock]));
    return inventoryAlerts(Object.fromEntries(todayPrep.map((p) => [p.dish, p.recommended])), state.stock, ss);
  }, [todayPrep, state.stock, purchasing]);

  // Retraining: evaluate the live model against all actuals through yesterday.
  const runMonitor = useCallback(() => monitor(model, records, addDays(TODAY, -1), ctx, state.policy), [model, records, ctx, state.policy]);

  const doRetrain = useCallback(
    (reasons) => {
      const m = retrain(records.filter((r) => r.date < TODAY), addDays(TODAY, -1), ctx, model.version);
      const entry = { version: m.version, date: TODAY, reasons, validationMape: m.validationMape, trainMape: m.trainMape, nTrain: m.nTrain, before: runMonitor().rollingMape };
      set({ model: m, retrainLog: [...state.retrainLog, entry] });
      audit('Model retrained', `v${m.version}: ${reasons.join('; ')}`);
      return m;
    },
    [records, ctx, model, state.retrainLog, set, audit, runMonitor],
  );

  const value = {
    state, dispatch, set, update, audit, toast, toasts, users,
    TODAY, HISTORY, ctx, model, records, baseRecords, forecasts, horizon, todayPrep, purchasing, alerts,
    refreshWeather, runMonitor, doRetrain,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  return useContext(Ctx);
}

// Simulated service clock (hours, fractional). Staff can fast-forward for demos.
const clockListeners = new Set();
let clockOffsetMin = 0;
let clockSpeed = 0;
setInterval(() => {
  if (clockSpeed) clockOffsetMin += clockSpeed;
  clockListeners.forEach((f) => f());
}, 1000);

export function useClock() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    clockListeners.add(f);
    return () => clockListeners.delete(f);
  }, []);
  const now = new Date();
  const hour = Math.max(0, Math.min(23.99, now.getHours() + now.getMinutes() / 60 + clockOffsetMin / 60));
  return {
    hour,
    speed: clockSpeed,
    offset: clockOffsetMin,
    setSpeed: (s) => {
      clockSpeed = s;
      clockListeners.forEach((f) => f());
    },
    jumpTo: (h) => {
      clockOffsetMin = (h - (now.getHours() + now.getMinutes() / 60)) * 60;
      clockListeners.forEach((f) => f());
    },
    reset: () => {
      clockOffsetMin = 0;
      clockSpeed = 0;
      clockListeners.forEach((f) => f());
    },
  };
}

export function fmtHour(h) {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}
