import { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts';
import { useStore, useClock, fmtHour } from '../store.jsx';
import { HALLS, DISHES, DIET_TAGS, ALLERGENS, SHIFTS, dishById, hallById } from '../data/catalog.js';
import { filterMenu, liveSupply, crowdProfile, dinersByHall, bestTimes, crowdLevel } from '../engine/student.js';
import { savingsAnalysis, carbonEquivalents } from '../engine/analytics.js';
import { fmtDate, uid, sum, round, groupBy, weekKey } from '../engine/util.js';
import { PageHeader, Card, Kpi, Badge, Field, Segmented, Empty, Meter, Stars, fmt, CHART } from '../components/ui.jsx';
import { reqLabels } from '../data/rtm.js';

const DIET_LABEL = { vegan: '🌱 Vegan', vegetarian: '🥕 Vegetarian', 'gluten-free': '🌾 Gluten-free', halal: '☪ Halal' };
const STATUS = { available: ['good', 'Available'], low: ['warn', 'Running low'], 'sold-out': ['bad', 'Sold out'] };

function mealPeriod(hour) {
  if (hour < 10.5) return 'Breakfast';
  if (hour < 15) return 'Lunch';
  return 'Dinner';
}

export function useLiveSupply() {
  const { todayPrep, TODAY, state } = useStore();
  const clock = useClock();
  const supply = liveSupply(todayPrep, TODAY, clock.hour, state.liveManual);
  return { supply: Object.fromEntries(supply.map((s) => [s.dish, s])), clock };
}

/** Watches live supply and notifies students who opted in (R19). Mounted once in App. */
export function SupplyWatcher() {
  const { state, update, toast } = useStore();
  const { supply } = useLiveSupply();
  const prev = useRef({});
  useEffect(() => {
    for (const id of state.notifyMe) {
      const s = supply[id];
      if (!s) continue;
      const before = prev.current[id];
      if (before && before !== s.status && s.status !== 'available') {
        const msg = s.status === 'low' ? `⚠️ ${dishById[id].name} is running low at ${hallById[s.hall].name} (${s.remaining} left).` : `⛔ ${dishById[id].name} just sold out at ${hallById[s.hall].name}.`;
        update('notifications', (n) => [{ id: uid('n'), msg, at: new Date().toISOString(), read: false }, ...n].slice(0, 50));
        toast(msg, s.status === 'low' ? 'warn' : 'bad');
      }
    }
    prev.current = Object.fromEntries(Object.entries(supply).map(([k, v]) => [k, v.status]));
  });
  return null;
}

export function MenuPage() {
  const { state, set, update, audit } = useStore();
  const prefs = state.studentPrefs || { diets: [], allergens: [] };
  const [hall, setHall] = useState('all');
  const [diets, setDiets] = useState(prefs.diets);
  const [allergens, setAllergens] = useState(prefs.allergens);
  const [search, setSearch] = useState('');
  const { supply, clock } = useLiveSupply();
  const isStaff = !!state.session;
  const dishes = filterMenu(DISHES, { diets, excludeAllergens: allergens, search, hall });
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const lowCount = Object.values(supply).filter((s) => s.status !== 'available').length;

  return (
    <div className="stack">
      <PageHeader
        title="Today's Menu"
        subtitle={`${mealPeriod(clock.hour)} service · live availability updates every second · ${fmtHour(clock.hour)}`}
        features={['F5.1', 'F5.2']}
        reqs={reqLabels(['F5.1', 'F5.2'])}
        actions={lowCount > 0 && <Badge tone="warn">{lowCount} item(s) running low or sold out</Badge>}
      />
      <Card>
        <div className="stack">
          <div className="row">
            <Segmented value={hall} onChange={setHall} options={[['all', 'All halls'], ...HALLS.map((h) => [h.id, h.name])]} label="Dining hall" />
            <input type="search" placeholder="Search dishes…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: '1 1 180px' }} />
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 92 }}>Dietary needs</span>
            {DIET_TAGS.map((t) => <button key={t} className={`filter-chip ${diets.includes(t) ? 'on' : ''}`} onClick={() => setDiets(toggle(diets, t))} aria-pressed={diets.includes(t)}>{DIET_LABEL[t]}</button>)}
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 92 }}>Exclude allergens</span>
            {ALLERGENS.map((a) => <button key={a} className={`filter-chip off-allergen ${allergens.includes(a) ? 'on' : ''}`} onClick={() => setAllergens(toggle(allergens, a))} aria-pressed={allergens.includes(a)}>{allergens.includes(a) ? '✕ ' : ''}{a}</button>)}
          </div>
          <div className="row small">
            <span className="muted">{dishes.length} of {DISHES.length} dishes match</span>
            {(diets.length > 0 || allergens.length > 0) && (
              <>
                <button className="btn-sm btn-ghost" onClick={() => { setDiets([]); setAllergens([]); }}>Clear filters</button>
                <button className="btn-sm btn-ghost" onClick={() => set({ studentPrefs: { diets, allergens } })}>Save as my default</button>
              </>
            )}
          </div>
        </div>
      </Card>
      {dishes.length === 0 ? <Empty>No dishes match these filters. Try removing a filter.</Empty> : (
        <div className="dish-grid">
          {dishes.map((d) => {
            const s = supply[d.id];
            const h = hallById[d.hall];
            const open = clock.hour >= h.open && clock.hour < h.close;
            const [tone, label] = STATUS[s.status];
            const pct = s.prepared ? (s.remaining / s.prepared) * 100 : 0;
            const watching = state.notifyMe.includes(d.id);
            return (
              <div key={d.id} className={`dish ${s.status}`}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div className="dish-title">{d.name}</div>
                    <div className="small muted">{d.category} · {h.name}</div>
                  </div>
                  {open ? <Badge tone={tone}>{s.status === 'low' ? '🔥 ' : ''}{label}</Badge> : <Badge>Closed now</Badge>}
                </div>
                <div className="tags">{d.diet.map((t) => <Badge key={t} tone="good">{DIET_LABEL[t]}</Badge>)}</div>
                <div className="small">{d.allergens.length ? <span><strong>Contains:</strong> {d.allergens.join(', ')}</span> : <span className="muted">No major allergens</span>}</div>
                <div>
                  <Meter pct={pct} tone={tone} />
                  <div className="small muted" style={{ marginTop: 3 }}>{s.status === 'sold-out' ? 'All portions served' : `About ${s.remaining} of ${s.prepared} portions left`}</div>
                </div>
                <div className="row">
                  <button className={`btn-sm ${watching ? 'btn-primary' : ''}`} onClick={() => update('notifyMe', (x) => toggle(x, d.id))} aria-pressed={watching}>
                    {watching ? '🔔 Notifying' : '🔕 Notify me if low'}
                  </button>
                  {isStaff && (
                    <label className="row small" style={{ gap: 4 }} title="Staff: enter the actual count on the line">
                      Count
                      <input type="number" min={0} style={{ width: 70 }} placeholder={String(s.remaining)} onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value !== '') {
                          update('liveManual', (m) => ({ ...m, [d.id]: { remaining: Number(e.currentTarget.value), at: clock.hour } }));
                          audit('Live count updated', `${d.name}: ${e.currentTarget.value}`);
                          e.currentTarget.value = '';
                        }
                      }} />
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CrowdPage() {
  const { forecasts, horizon, TODAY } = useStore();
  const clock = useClock();
  const [day, setDay] = useState(TODAY);
  const diners = dinersByHall(forecasts[day]);
  const isToday = day === TODAY;

  return (
    <div className="stack">
      <PageHeader
        title="Crowd Meter"
        subtitle="Predicted occupancy for each dining hall, hour by hour, from the demand forecast. Plan around the rush."
        features={['F5.3']}
        reqs={reqLabels(['F5.3'])}
        actions={<Segmented value={day} onChange={setDay} options={horizon.slice(0, 4).map((d, i) => [d, i === 0 ? 'Today' : fmtDate(d, { weekday: 'short' })])} />}
      />
      <div className="grid g3">
        {HALLS.map((h) => {
          const prof = crowdProfile(h.id, diners[h.id]);
          const cur = prof.find((p) => p.hour === Math.floor(clock.hour));
          const peak = [...prof].sort((a, b) => b.pct - a.pct)[0];
          const best = bestTimes(prof, isToday ? clock.hour : 0);
          return (
            <Card key={h.id} title={h.name} subtitle={`Open ${fmtHour(h.open)}–${fmtHour(h.close)} · ${h.capacity} seats · ~${fmt.n(diners[h.id])} diners expected`}>
              {isToday && (
                <div className="row" style={{ marginBottom: 12 }}>
                  <Gauge pct={cur ? cur.pct : 0} tone={cur ? cur.tone : 'good'} />
                  <div>
                    <div className="small muted">Right now</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{cur ? cur.label : 'Closed'}</div>
                    <div className="small">{cur ? `${cur.pct}% full` : ''}</div>
                  </div>
                </div>
              )}
              <div className="crowd-bars" aria-label={`Hourly occupancy for ${h.name}`}>
                {prof.map((p) => (
                  <div key={p.hour} className={`crowd-bar tone-${p.tone} ${isToday && p.hour === Math.floor(clock.hour) ? 'now' : ''}`} style={{ height: `${Math.max(3, p.pct)}%` }} title={`${p.hourLabel}: ${p.pct}% (${p.label})`} />
                ))}
              </div>
              <div className="crowd-labels">{prof.map((p) => <span key={p.hour}>{p.hour % 3 === 0 ? p.hourLabel : ''}</span>)}</div>
              <div className="small" style={{ marginTop: 10 }}>
                <div>⏰ Peak: <strong>{fmtHour(peak.hour)}</strong> ({peak.pct}%, {peak.label})</div>
                {best.length > 0 && <div>✅ Quietest {isToday ? 'remaining ' : ''}times: <strong>{best.map((b) => fmtHour(b.hour)).join(', ')}</strong></div>}
              </div>
            </Card>
          );
        })}
      </div>
      <div className="row small muted">
        {['Quiet', 'Moderate', 'Busy', 'Packed'].map((l, i) => <span key={l} className="row" style={{ gap: 4 }}><span className={`tone-${['good', 'ok', 'warn', 'bad'][i]}`} style={{ width: 10, height: 10, borderRadius: 3, display: 'inline-block' }} />{l} {['<40%', '40–70%', '70–90%', '90%+'][i]}</span>)}
      </div>
    </div>
  );
}

function Gauge({ pct, tone }) {
  const a = Math.PI * (1 - pct / 100);
  const x = 50 + 40 * Math.cos(a);
  const y = 50 - 40 * Math.sin(a);
  const colors = { good: 'var(--good)', ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' };
  return (
    <svg viewBox="0 0 100 56" className="gauge" style={{ width: 110 }} role="img" aria-label={`${pct}% full`}>
      <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="var(--line)" strokeWidth="9" strokeLinecap="round" />
      {pct > 0 && <path d={`M10 50 A40 40 0 0 1 ${x} ${y}`} fill="none" stroke={colors[tone]} strokeWidth="9" strokeLinecap="round" />}
      <text x="50" y="50" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--ink)">{pct}%</text>
    </svg>
  );
}

export function PlanPage() {
  const { state, update, horizon, toast } = useStore();
  const me = state.studentId;
  const mine = state.surveys.filter((s) => s.student === me);
  const [plan, setPlan] = useState(() => Object.fromEntries(mine.map((s) => [`${s.date}|${s.meal}`, s.hall])));
  const myFavs = new Set(state.favorites.filter((f) => f.student === me).map((f) => f.dish));
  const counts = useMemo(() => {
    const g = groupBy(state.surveys, (s) => `${s.date}|${s.hall}`);
    return Object.fromEntries([...g].map(([k, v]) => [k, v.length]));
  }, [state.surveys]);
  const favCounts = useMemo(() => Object.fromEntries([...groupBy(state.favorites, (f) => f.dish)].map(([k, v]) => [k, v.length])), [state.favorites]);

  function save() {
    const entries = Object.entries(plan).filter(([, h]) => h).map(([k, hall]) => {
      const [date, meal] = k.split('|');
      return { id: uid('sv'), student: me, date, meal, hall, at: new Date().toISOString() };
    });
    update('surveys', (x) => [...x.filter((s) => s.student !== me), ...entries]);
    toast(`Thanks! ${entries.length} planned meal(s) shared with the kitchen.`);
  }

  function toggleFav(id) {
    update('favorites', (x) => (myFavs.has(id) ? x.filter((f) => !(f.student === me && f.dish === id)) : [...x, { dish: id, student: me, at: new Date().toISOString() }]));
  }

  return (
    <div className="stack">
      <PageHeader
        title="Plan & Preferences"
        subtitle="Tell the kitchen where you'll eat and what you love. Your plans and favorites feed straight into tomorrow's demand forecast, so less food goes to waste."
        features={['F5.4']}
        reqs={reqLabels(['F5.4'])}
      />
      <Card title="Planned attendance · next 7 days" subtitle="Pick a hall for each meal you plan to eat on campus. Responses are anonymous." actions={<button className="btn-primary" onClick={save}>Save my plan</button>}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Day</th>{SHIFTS.map((m) => <th key={m}>{m}</th>)}<th className="num">Students planning (all halls)</th></tr></thead>
            <tbody>
              {horizon.map((d) => (
                <tr key={d}>
                  <td>{fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' })}</td>
                  {SHIFTS.map((m) => (
                    <td key={m}>
                      <select value={plan[`${d}|${m}`] || ''} onChange={(e) => setPlan({ ...plan, [`${d}|${m}`]: e.target.value })} aria-label={`${m} on ${d}`}>
                        <option value="">Not attending</option>
                        {HALLS.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                      </select>
                    </td>
                  ))}
                  <td className="num">{fmt.n(sum(HALLS.map((h) => counts[`${d}|${h.id}`] || 0)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Favorite dishes" subtitle="Star the dishes you'd pick. Popular favorites get a bigger share of the prep plan.">
        <div className="dish-grid">
          {DISHES.map((d) => (
            <button key={d.id} className="dish" style={{ textAlign: 'left', borderColor: myFavs.has(d.id) ? '#e3a72f' : undefined }} onClick={() => toggleFav(d.id)} aria-pressed={myFavs.has(d.id)}>
              <div className="row" style={{ width: '100%' }}>
                <span style={{ fontSize: 20, color: myFavs.has(d.id) ? '#e3a72f' : 'var(--line)' }}>★</span>
                <div style={{ flex: 1 }}>
                  <div className="dish-title" style={{ fontSize: 14 }}>{d.name}</div>
                  <div className="small muted">{hallById[d.hall].name}</div>
                </div>
                <span className="small muted">{favCounts[d.id] || 0} ♥</span>
              </div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

const QUICK_TAGS = ['Tasty', 'Good portion', 'Too salty', 'Bland', 'Served cold', 'Portion too big', 'Portion too small', 'Would order again'];

export function RatePage() {
  const { state, update, toast, TODAY } = useStore();
  const me = state.studentId;
  const [dish, setDish] = useState('');
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState([]);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  const mine = state.ratings.filter((r) => r.student === me).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const avg = Object.fromEntries([...groupBy(state.ratings, (r) => r.dish)].map(([k, v]) => [k, { avg: round(sum(v.map((x) => x.stars)) / v.length, 1), n: v.length }]));

  function submit(e) {
    e.preventDefault();
    if (!dish) return setErr('Choose the dish you ate.');
    if (!stars) return setErr('Give a star rating.');
    if (comment.length > 500) return setErr('Comments are limited to 500 characters.');
    setErr('');
    const existing = state.ratings.find((r) => r.student === me && r.dish === dish && r.date === TODAY);
    const entry = { id: existing?.id || uid('r'), student: me, dish, stars, tags, comment: comment.trim(), date: TODAY, createdAt: new Date().toISOString() };
    update('ratings', (x) => [entry, ...x.filter((r) => r.id !== entry.id)]);
    toast(existing ? 'Review updated. Thanks!' : 'Thanks! Your feedback goes straight to the kitchen team.');
    setDish(''); setStars(0); setTags([]); setComment('');
  }

  return (
    <div className="stack">
      <PageHeader title="Rate a Meal" subtitle="How was it? Kitchen staff review ratings and comments to tune recipes and portions." features={['F5.5']} reqs={reqLabels(['F5.5'])} />
      <div className="grid g2">
        <Card title="Your review">
          <form onSubmit={submit} className="stack">
            <Field label="What did you eat?">
              <select value={dish} onChange={(e) => setDish(e.target.value)}>
                <option value="">Select a dish…</option>
                {HALLS.map((h) => <optgroup key={h.id} label={h.name}>{DISHES.filter((d) => d.hall === h.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>)}
              </select>
            </Field>
            <Field label="Rating"><Stars value={stars} onChange={setStars} size={30} /></Field>
            <Field label="Quick tags">
              <div className="tags">{QUICK_TAGS.map((t) => <button type="button" key={t} className={`filter-chip ${tags.includes(t) ? 'on' : ''}`} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</button>)}</div>
            </Field>
            <Field label={`Comment (optional) · ${comment.length}/500`} error={err}>
              <textarea rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What should the kitchen keep or change?" />
            </Field>
            <div><button className="btn-primary">Submit review</button></div>
          </form>
        </Card>
        <Card title="Community ratings">
          <div className="table-wrap">
            <table>
              <tbody>
                {DISHES.filter((d) => avg[d.id]).sort((a, b) => avg[b.id].avg - avg[a.id].avg).map((d) => (
                  <tr key={d.id}><td>{d.name}</td><td><Stars value={Math.round(avg[d.id].avg)} size={13} /></td><td className="num">{avg[d.id].avg} <span className="muted small">({avg[d.id].n})</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      {mine.length > 0 && (
        <Card title="Your past reviews">
          <table>
            <tbody>{mine.map((r) => <tr key={r.id}><td>{fmtDate(r.date)}</td><td>{dishById[r.dish].name}</td><td><Stars value={r.stars} size={13} /></td><td className="small">{r.comment}</td></tr>)}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export function ImpactPage() {
  const { records, state, HISTORY } = useStore();
  const s = useMemo(() => savingsAnalysis(records, state.settings), [records, state.settings]);
  const eq = carbonEquivalents(s.co2AvoidedMt);
  const weekly = useMemo(() => {
    const g = groupBy(records, (r) => weekKey(r.date));
    return [...g].sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, -1).map(([w, rs]) => ({ label: fmtDate(w), g: round((sum(rs.map((r) => r.wasteKg)) / Math.max(1, sum(rs.map((r) => r.consumed)))) * 1000, 0) }));
  }, [records]);
  const byHall = HALLS.map((h) => {
    const pre = records.filter((r) => r.hall === h.id && r.mode === 'traditional');
    const post = records.filter((r) => r.hall === h.id && r.mode !== 'traditional');
    const a = sum(pre.map((r) => r.wasteKg)) / Math.max(1, sum(pre.map((r) => r.consumed)));
    const b = sum(post.map((r) => r.wasteKg)) / Math.max(1, sum(post.map((r) => r.consumed)));
    return { hall: h.name, reduction: round(((a - b) / a) * 100, 1) };
  }).sort((a, b) => b.reduction - a.reduction);
  const milestones = [
    { label: 'First 500 kg of food saved', target: 500, value: s.kgAvoided, unit: 'kg' },
    { label: '1 tonne of food saved', target: 1000, value: s.kgAvoided, unit: 'kg' },
    { label: '5,000 meals rescued', target: 5000, value: s.mealsSaved, unit: 'meals' },
    { label: '10 MT CO2e avoided', target: 10, value: s.co2AvoidedMt, unit: 'MT' },
    { label: '10,000 meals rescued', target: 10000, value: s.mealsSaved, unit: 'meals' },
    { label: '25 MT CO2e avoided', target: 25, value: s.co2AvoidedMt, unit: 'MT' },
  ];

  return (
    <div className="stack">
      <PageHeader title="Campus Impact" subtitle="What our dining community has achieved together since WasteLess launched." features={['F5.6']} reqs={reqLabels(['F5.6'])} />
      <div className="hero">
        <div className="small muted">Since {fmtDate(HISTORY.goLive, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        <div style={{ fontSize: 30, fontWeight: 800, margin: '4px 0 14px' }}>Together we've kept {fmt.n(s.kgAvoided)} kg of food out of the trash 🌍</div>
        <div className="grid g4">
          <div><div className="kpi-value">{fmt.n(s.mealsSaved)}</div><div className="muted small">meals' worth saved</div></div>
          <div><div className="kpi-value">{s.co2AvoidedMt} MT</div><div className="muted small">CO2e avoided</div></div>
          <div><div className="kpi-value">−{s.reductionPct}%</div><div className="muted small">waste per plate</div></div>
          <div><div className="kpi-value">{eq.cars}</div><div className="muted small">cars off the road for a year</div></div>
        </div>
      </div>
      <div className="grid g2">
        <Card title="Milestones">
          <div className="stack" style={{ '--x': 0 }}>
            {milestones.map((m) => {
              const done = m.value >= m.target;
              return (
                <div key={m.label} className={`milestone ${done ? 'done' : ''}`}>
                  <div className="icon">{done ? '✓' : '○'}</div>
                  <div style={{ flex: 1 }}>
                    <div>{m.label}</div>
                    {!done && <Meter pct={(m.value / m.target) * 100} />}
                  </div>
                  <span className="small muted">{done ? 'Achieved' : `${fmt.n(m.value, m.unit === 'MT' ? 1 : 0)} / ${fmt.n(m.target)} ${m.unit}`}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Food waste per portion served (grams, weekly)" subtitle="Lower is better.">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={weekly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} width={40} unit="g" domain={[0, 'auto']} />
              <Tooltip formatter={(v) => `${v} g`} />
              <Line dataKey="g" name="Waste per portion" stroke={CHART.actual} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <div className="grid g2">
        <Card title="Hall leaderboard · waste reduction">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byHall} layout="vertical" margin={{ left: 30 }}>
              <XAxis type="number" unit="%" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="hall" tick={{ fontSize: 11 }} width={110} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Bar dataKey="reduction" fill={CHART.actual} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="How you can help">
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>Take what you'll eat. You can always go back for seconds.</li>
            <li>Share your meal plans on <a href="#plan">Plan & Preferences</a> so the kitchen cooks the right amount.</li>
            <li>Check the <a href="#crowd">Crowd Meter</a> and dine off-peak.</li>
            <li>Rate your meal on <a href="#rate">Rate a Meal</a> so recipes people don't finish get fixed.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
