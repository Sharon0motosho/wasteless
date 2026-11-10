import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine, Area, BarChart,
} from 'recharts';
import { useStore } from '../store.jsx';
import { HALLS, DISHES, dishById, hallById, PHASES } from '../data/catalog.js';
import { phaseFor, eventsFor, weatherFor, PHASE_LABEL } from '../engine/context.js';
import { forecastDay } from '../engine/pipeline.js';
import { FEATURES } from '../engine/forecast.js';
import { fmtDate, addDays, uid, round, groupBy, sum } from '../engine/util.js';
import { PageHeader, Card, Kpi, Badge, Field, Segmented, Empty, fmt, CHART } from '../components/ui.jsx';
import { reqLabels } from '../data/rtm.js';

const WX_ICON = { Clear: '☀️', Cloudy: '⛅', Rain: '🌧️', Snow: '❄️', Thunderstorm: '⛈️', Fog: '🌫️' };

function DayPicker({ horizon, value, onChange, forecasts, ctx, calendar }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${horizon.length}, minmax(96px, 1fr))`, overflowX: 'auto' }}>
      {horizon.map((d) => {
        const w = ctx.weatherOf(d);
        const ph = phaseFor(d, calendar);
        const ev = eventsFor(d, calendar);
        const total = sum(forecasts[d].map((r) => r.final));
        return (
          <button key={d} onClick={() => onChange(d)} className="card" style={{ padding: 10, display: 'block', textAlign: 'left', borderColor: value === d ? 'var(--brand)' : undefined, borderWidth: value === d ? 2 : 1 }}>
            <div className="small muted">{fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{fmt.n(total)}</div>
            <div className="small">{WX_ICON[w.condition] || '🌡️'} {round(w.tempC)}°C {w.precipMm > 0 ? `· ${w.precipMm}mm` : ''}</div>
            <div className="tags" style={{ marginTop: 4 }}>
              {ph.phase !== 'regular' && <Badge tone="violet">{PHASE_LABEL[ph.phase]}</Badge>}
              {ev.map((e) => <Badge key={e.id} tone="warn">{e.label}</Badge>)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function ForecastPage() {
  const { forecasts, horizon, ctx, state, model, records, TODAY } = useStore();
  const [day, setDay] = useState(TODAY);
  const [hall, setHall] = useState('all');
  const rows = forecasts[day].filter((r) => hall === 'all' || r.hall === hall);
  const total = sum(rows.map((r) => r.final));
  const w = ctx.weatherOf(day);
  const ph = phaseFor(day, state.calendar);
  const avgW = rows.length ? sum(rows.map((r) => r.model * (r.weatherFactor - 1))) / Math.max(1, sum(rows.map((r) => r.model))) : 0;
  const avgC = rows.length ? sum(rows.map((r) => r.model * (r.calendarFactor - 1))) / Math.max(1, sum(rows.map((r) => r.model))) : 0;

  const trend = useMemo(() => {
    const past = records.filter((r) => r.date >= addDays(TODAY, -21) && r.date < TODAY && (hall === 'all' || r.hall === hall));
    const byDate = groupBy(past, (r) => r.date);
    const pts = [...byDate.entries()].map(([d, rs]) => ({ date: d, label: fmtDate(d), actual: sum(rs.map((r) => r.consumed)), predicted: sum(rs.map((r) => r.predicted)) }));
    for (const d of horizon) {
      const f = forecasts[d].filter((r) => hall === 'all' || r.hall === hall);
      const v = sum(f.map((r) => r.final));
      const sd = Math.sqrt(sum(f.map((r) => (r.final * r.sigmaRel) ** 2)));
      pts.push({ date: d, label: fmtDate(d), forecast: v, band: [Math.round(v - 1.28 * sd), Math.round(v + 1.28 * sd)] });
    }
    return pts.sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [records, horizon, forecasts, hall, TODAY]);

  return (
    <div className="stack">
      <PageHeader
        title="Demand Forecast"
        subtitle="Automated daily meal-unit predictions from historical consumption, live weather, the academic calendar, campus events and student signals."
        features={['F1.1', 'F1.2']}
        reqs={reqLabels(['F1.1'])}
        actions={<Segmented value={hall} onChange={setHall} options={[['all', 'All halls'], ...HALLS.map((h) => [h.id, h.name])]} label="Hall" />}
      />
      <DayPicker horizon={horizon} value={day} onChange={setDay} forecasts={forecasts} ctx={ctx} calendar={state.calendar} />
      <div className="grid g4">
        <Kpi label={`Forecast portions · ${fmtDate(day, { weekday: 'short', month: 'short', day: 'numeric' })}`} value={fmt.n(total)} sub={`${rows.length} menu items`} />
        <Kpi label="Weather adjustment" value={fmt.signedPct(1 + avgW)} sub={`${WX_ICON[w.condition] || ''} ${w.condition}, ${w.tempC}°C, ${w.precipMm} mm · ${w.source}`} />
        <Kpi label="Calendar & event adjustment" value={fmt.signedPct(1 + avgC)} sub={`${ph.label}${eventsFor(day, state.calendar).map((e) => ` · ${e.label}`).join('')}`} />
        <Kpi label={`Model v${model.version} validation MAPE`} value={fmt.pct(model.validationMape)} sub="Target < 15% (R1)" tone={model.validationMape < 15 ? 'good' : 'bad'} />
      </div>
      <Card title="Consumption history and 7-day forecast" subtitle="Solid: actual portions served. Dashed: model prediction. Shaded: 80% prediction interval for upcoming days.">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} />
            <YAxis tick={{ fontSize: 11 }} width={48} />
            <Tooltip formatter={(v) => (Array.isArray(v) ? `${v[0]}–${v[1]}` : fmt.n(v))} />
            <Legend />
            <Area dataKey="band" name="80% interval" fill={CHART.predicted} fillOpacity={0.15} stroke="none" />
            <Line dataKey="actual" name="Actual" stroke={CHART.actual} strokeWidth={2} dot={false} />
            <Line dataKey="predicted" name="Predicted (at the time)" stroke={CHART.predicted} strokeDasharray="4 3" dot={false} />
            <Line dataKey="forecast" name="Forecast" stroke={CHART.predicted} strokeWidth={2} strokeDasharray="6 3" dot={{ r: 3 }} />
            <ReferenceLine x={fmtDate(TODAY)} stroke="var(--muted)" label={{ value: 'Today', fontSize: 11, fill: 'var(--muted)' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Forecast breakdown by menu item" subtitle="Each multiplier shows how a model input moved the number. Final = base × weather × calendar × students, unless a manager override applies.">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th><th>Hall</th><th className="num">Base</th><th className="num">Weather</th><th className="num">Calendar</th>
                <th className="num">Students</th><th>Override</th><th className="num">Final</th><th className="num">80% range</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.dish}>
                  <td>{dishById[r.dish].name}</td>
                  <td className="muted">{hallById[r.hall].name}</td>
                  <td className="num">{fmt.n(r.base)}</td>
                  <td className="num">{fmt.signedPct(r.weatherFactor)}</td>
                  <td className="num">{fmt.signedPct(r.calendarFactor)}</td>
                  <td className="num" title={`${r.responses} attendance responses (≈${Math.round(r.expected || 0)} typical), ${r.favCount} favorite votes`}>{fmt.signedPct(r.studentFactor)}</td>
                  <td>{r.override ? <Badge tone="warn" title={r.override.reason}>{r.override.mode === 'absolute' ? `= ${r.override.value}` : `${r.override.value > 0 ? '+' : ''}${r.override.value}%`}</Badge> : <span className="muted">—</span>}</td>
                  <td className="num"><strong>{fmt.n(r.final)}</strong></td>
                  <td className="num muted">{fmt.n(r.final * (1 - 1.28 * r.sigmaRel))}–{fmt.n(r.final * (1 + 1.28 * r.sigmaRel))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function CalendarPage() {
  const { state, set, update, refreshWeather, ctx, model, horizon, audit, toast } = useStore();
  const canEdit = ['manager', 'admin'].includes(state.session?.user?.role);
  const [form, setForm] = useState({ type: 'event', label: '', start: horizon[1], end: horizon[1], phase: 'midterms', multiplier: 1.1 });
  const [wi, setWi] = useState({ date: horizon[1], tempC: 2, precipMm: 15 });
  const ws = state.weatherStatus;

  // Hall-level weather effects implied by the fitted coefficients.
  const weatherRows = horizon.map((d) => {
    const w = ctx.weatherOf(d);
    const effects = Object.fromEntries(HALLS.map((h) => {
      const b = model.halls[h.id].beta;
      return [h.id, Math.exp(b[11] * (w.tempC - 18) + b[12] * Math.min(w.precipMm, 25))];
    }));
    return { d, w, effects };
  });

  function addEntry(e) {
    e.preventDefault();
    if (!form.label.trim() || form.end < form.start) return toast('Enter a label and a valid date range.', 'warn');
    const entry = { id: uid('cal'), type: form.type, label: form.label.trim(), start: form.start, end: form.end, ...(form.type === 'phase' ? { phase: form.phase } : { multiplier: Number(form.multiplier) }) };
    update('calendar', (c) => [...c, entry]);
    audit('Calendar entry added', `${entry.label} ${entry.start}–${entry.end}`);
    setForm({ ...form, label: '' });
    toast(`Added “${entry.label}”. Forecasts updated.`);
  }

  const sorted = [...state.calendar].sort((a, b) => (a.start < b.start ? -1 : 1));

  return (
    <div className="stack">
      <PageHeader
        title="Weather & Academic Calendar"
        subtitle="The environmental and calendar pipeline that feeds the forecaster. Live weather is pulled from Open-Meteo; academic phases and campus events adjust expected attendance."
        features={['F1.2']}
        reqs={reqLabels(['F1.2'])}
      />
      <Card
        title={`Weather feed · ${state.location.name}`}
        subtitle={ws.state === 'live' ? `Live data from Open-Meteo, updated ${new Date(ws.at).toLocaleTimeString()}` : ws.state === 'loading' ? 'Contacting weather service…' : ws.state === 'offline' ? `Live feed unavailable (${ws.error}). Using seasonal model.` : 'Not yet loaded'}
        actions={
          <>
            <Badge tone={ws.state === 'live' ? 'good' : ws.state === 'offline' ? 'warn' : 'neutral'}>{ws.state === 'live' ? '● Live' : ws.state}</Badge>
            <button className="btn-sm" onClick={refreshWeather}>↻ Refresh</button>
          </>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Conditions</th><th className="num">Temp</th><th className="num">Precip.</th><th>Source</th>{HALLS.map((h) => <th key={h.id} className="num">{h.name} adj.</th>)}</tr>
            </thead>
            <tbody>
              {weatherRows.map(({ d, w, effects }) => (
                <tr key={d}>
                  <td>{fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                  <td>{WX_ICON[w.condition]} {w.condition}</td>
                  <td className="num">{w.tempC}°C</td>
                  <td className="num">{w.precipMm} mm</td>
                  <td><Badge tone={w.source === 'live' ? 'good' : w.source === 'what-if' ? 'violet' : 'neutral'}>{w.source}</Badge></td>
                  {HALLS.map((h) => <td key={h.id} className="num">{fmt.signedPct(effects[h.id])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid g2">
        <Card title="What-if weather scenario" subtitle="Test how a storm or a cold snap would move tomorrow's forecast. Scenario weather overrides the live feed until cleared.">
          <div className="form-grid">
            <Field label="Date">
              <select value={wi.date} onChange={(e) => setWi({ ...wi, date: e.target.value })}>
                {horizon.map((d) => <option key={d} value={d}>{fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</option>)}
              </select>
            </Field>
            <Field label={`Temperature: ${wi.tempC}°C`}>
              <input type="range" min={-15} max={38} value={wi.tempC} onChange={(e) => setWi({ ...wi, tempC: Number(e.target.value) })} />
            </Field>
            <Field label={`Precipitation: ${wi.precipMm} mm`}>
              <input type="range" min={0} max={40} value={wi.precipMm} onChange={(e) => setWi({ ...wi, precipMm: Number(e.target.value) })} />
            </Field>
          </div>
          <WhatIfPreview wi={wi} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn-primary" disabled={!canEdit} onClick={() => { update('whatIf', (x) => ({ ...x, [wi.date]: { tempC: wi.tempC, precipMm: wi.precipMm, condition: wi.precipMm > 0.5 ? (wi.tempC <= 1 ? 'Snow' : 'Rain') : 'Clear' } })); audit('What-if weather applied', `${wi.date}: ${wi.tempC}°C ${wi.precipMm}mm`); }}>Apply scenario</button>
            {Object.keys(state.whatIf).length > 0 && <button onClick={() => set({ whatIf: {} })} disabled={!canEdit}>Clear {Object.keys(state.whatIf).length} scenario(s)</button>}
            {!canEdit && <span className="muted small">Manager access required to apply.</span>}
          </div>
        </Card>

        <Card title="Add calendar entry" subtitle="Phases (midterms, finals, breaks) and campus events (games, open houses) are applied to every forecast that falls in their range.">
          <form onSubmit={addEntry} className="form-grid">
            <Field label="Type">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} disabled={!canEdit}>
                <option value="event">Campus event</option>
                <option value="phase">Academic phase</option>
              </select>
            </Field>
            <Field label="Label"><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Football home game" disabled={!canEdit} /></Field>
            <Field label="Start"><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} disabled={!canEdit} /></Field>
            <Field label="End"><input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} disabled={!canEdit} /></Field>
            {form.type === 'phase' ? (
              <Field label="Phase">
                <select value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })} disabled={!canEdit}>
                  {PHASES.filter((p) => p !== 'regular').map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
                </select>
              </Field>
            ) : (
              <Field label={`Attendance multiplier ×${form.multiplier}`} hint="1.15 = 15% more diners">
                <input type="range" min={0.5} max={1.6} step={0.01} value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} disabled={!canEdit} />
              </Field>
            )}
            <div style={{ alignSelf: 'end' }}><button className="btn-primary" disabled={!canEdit}>Add entry</button></div>
          </form>
        </Card>
      </div>

      <Card title="Academic calendar & campus events">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Entry</th><th>Type</th><th>Dates</th><th>Effect</th><th>Status</th><th /></tr></thead>
            <tbody>
              {sorted.map((c) => {
                const status = c.end < horizon[0] ? 'Past' : c.start > horizon[horizon.length - 1] ? 'Upcoming' : 'In forecast window';
                return (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    <td><Badge tone={c.type === 'event' ? 'warn' : 'violet'}>{c.type === 'event' ? 'Event' : PHASE_LABEL[c.phase]}</Badge></td>
                    <td className="muted">{fmtDate(c.start)}{c.end !== c.start ? ` – ${fmtDate(c.end)}` : ''}</td>
                    <td>{c.type === 'event' ? `×${c.multiplier} attendance` : 'Learned phase coefficient'}</td>
                    <td><Badge tone={status === 'In forecast window' ? 'good' : 'neutral'}>{status}</Badge></td>
                    <td className="num">{canEdit && <button className="btn-sm btn-ghost btn-danger" onClick={() => { update('calendar', (cal) => cal.filter((x) => x.id !== c.id)); audit('Calendar entry removed', c.label); }}>Remove</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function WhatIfPreview({ wi }) {
  const { model, ctx, state, forecasts } = useStore();
  const scenarioCtx = { calendar: ctx.calendar, weatherOf: (iso) => weatherFor(iso, state.liveWeather, { ...state.whatIf, [wi.date]: { tempC: wi.tempC, precipMm: wi.precipMm, condition: 'x' } }) };
  const before = forecasts[wi.date];
  const after = forecastDay(wi.date, model, scenarioCtx, { surveys: state.surveys, favorites: state.favorites, overrides: state.overrides });
  const data = HALLS.map((h) => ({
    hall: h.name,
    current: sum(before.filter((r) => r.hall === h.id).map((r) => r.final)),
    scenario: sum(after.filter((r) => r.hall === h.id).map((r) => r.final)),
  }));
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="hall" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} width={44} />
        <Tooltip />
        <Legend />
        <Bar dataKey="current" name="Current forecast" fill={CHART.prepared} radius={[4, 4, 0, 0]} />
        <Bar dataKey="scenario" name="Scenario" fill={CHART.predicted} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ModelPage() {
  const { state, set, model, runMonitor, doRetrain, toast, TODAY } = useStore();
  const [policy, setPolicy] = useState(state.policy);
  const m = runMonitor();
  const log = [...state.retrainLog].reverse();
  const series = state.monitorSeries.map((p) => ({ ...p, label: fmtDate(p.date) }));
  const retrainDates = state.retrainLog.map((l) => fmtDate(addDays(l.date, -1)));

  const coef = HALLS.map((h) => {
    const b = model.halls[h.id].beta;
    const pct = (x) => fmt.signedPct(Math.exp(x));
    return { hall: h.name, fri: pct(b[5]), sat: pct(b[6]), mid: pct(b[7]), fin: pct(b[8]), brk: pct(b[9]), temp: pct(b[11]), rain: pct(b[12] * 10), calib: model.halls[h.id].calib };
  });

  return (
    <div className="stack">
      <PageHeader
        title="Model Monitor & Retraining"
        subtitle="The variance engine compares every prediction with actual consumption. When rolling error drifts past policy limits, the model retrains on the newest data automatically."
        features={['F1.3']}
        reqs={reqLabels(['F1.3'])}
        actions={
          <>
            <button onClick={() => { if (m.shouldRetrain) { doRetrain(m.reasons); toast('Variance limit exceeded: model retrained.'); } else toast(`Variance check passed (${m.rollingMape}% rolling MAPE). No retrain needed.`); }}>Run variance check</button>
            <button className="btn-primary" onClick={() => { const nm = doRetrain(['Manual retrain requested by manager']); toast(`Model v${nm.version} trained · validation MAPE ${nm.validationMape}%`); }}>Retrain now</button>
          </>
        }
      />
      <div className="grid g4">
        <Kpi label="Active model" value={`v${model.version}`} sub={`Trained through ${fmtDate(model.trainedThrough)} · ${fmt.n(model.nTrain)} records`} />
        <Kpi label="Validation MAPE (holdout)" value={fmt.pct(model.validationMape)} tone={model.validationMape < 15 ? 'good' : 'bad'} sub="Time-based 14-day holdout" />
        <Kpi label="Rolling 14-day MAPE" value={m.newDays ? fmt.pct(m.rollingMape) : '—'} sub={m.newDays ? `${m.newDays} days of new actuals` : 'No new actuals since training'} tone={m.rollingMape > policy.maxMape ? 'bad' : 'good'} />
        <Kpi label="Error delta vs. validation" value={m.newDays ? `${m.delta > 0 ? '+' : ''}${m.delta} pts` : '—'} sub={`Model age ${m.age} days`} tone={m.delta > policy.maxDelta ? 'warn' : undefined} />
      </div>
      <div className={`alert ${m.shouldRetrain ? 'alert-warn' : 'alert-good'}`}>
        <span>{m.shouldRetrain ? '⚠️' : '✅'}</span>
        <div>
          <strong>{m.shouldRetrain ? 'Retraining recommended' : 'Model within tolerance'}</strong>
          <div className="small">{m.reasons.length ? m.reasons.join(' · ') : `Rolling error is within the ${policy.maxMape}% limit and the +${policy.maxDelta} pt drift limit.`}</div>
        </div>
      </div>
      <Card title="Rolling forecast error since go-live" subtitle="14-day rolling MAPE of live predictions. Vertical markers show automatic retrains.">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={9} />
            <YAxis tick={{ fontSize: 11 }} width={40} unit="%" domain={[0, 'auto']} />
            <Tooltip formatter={(v) => `${v}%`} />
            <ReferenceLine y={policy.maxMape} stroke="var(--bad)" strokeDasharray="4 3" label={{ value: `Retrain limit ${policy.maxMape}%`, fontSize: 11, fill: 'var(--bad)', position: 'insideTopRight' }} />
            <ReferenceLine y={15} stroke="var(--warn)" strokeDasharray="2 4" label={{ value: 'R1 target 15%', fontSize: 11, fill: 'var(--warn)', position: 'insideBottomRight' }} />
            {retrainDates.map((d, i) => <ReferenceLine key={i} x={d} stroke={CHART.predicted} strokeOpacity={0.5} />)}
            <Line dataKey="rollingMape" name="Rolling MAPE" stroke={CHART.actual} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
      <div className="grid g2">
        <Card title="Retraining history">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Version</th><th>Deployed</th><th>Trigger</th><th className="num">Error before</th><th className="num">Validation</th></tr></thead>
              <tbody>
                {log.map((l) => (
                  <tr key={`${l.version}-${l.date}`}>
                    <td><Badge tone={l.version === model.version ? 'good' : 'neutral'}>v{l.version}</Badge></td>
                    <td>{fmtDate(l.date)}</td>
                    <td className="small">{l.reasons.join('; ')}</td>
                    <td className="num">{l.before != null ? `${l.before}%` : '—'}</td>
                    <td className="num">{l.validationMape}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Retraining policy" subtitle="Thresholds the variance engine uses for automatic retraining.">
          <div className="form-grid">
            <Field label="Rolling window (days)"><input type="number" min={7} max={60} value={policy.windowDays} onChange={(e) => setPolicy({ ...policy, windowDays: Number(e.target.value) })} /></Field>
            <Field label="Max rolling MAPE (%)"><input type="number" min={3} max={30} step={0.5} value={policy.maxMape} onChange={(e) => setPolicy({ ...policy, maxMape: Number(e.target.value) })} /></Field>
            <Field label="Max error delta (pts)"><input type="number" min={1} max={20} step={0.5} value={policy.maxDelta} onChange={(e) => setPolicy({ ...policy, maxDelta: Number(e.target.value) })} /></Field>
            <Field label="Scheduled refresh (days)"><input type="number" min={7} max={120} value={policy.maxAgeDays} onChange={(e) => setPolicy({ ...policy, maxAgeDays: Number(e.target.value) })} /></Field>
            <Field label="Cooldown (days)"><input type="number" min={0} max={30} value={policy.cooldownDays} onChange={(e) => setPolicy({ ...policy, cooldownDays: Number(e.target.value) })} /></Field>
          </div>
          <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => { set({ policy }); toast('Retraining policy saved.'); }}>Save policy</button>
        </Card>
      </div>
      <Card title="What the model has learned" subtitle="Effects as % change in demand vs. a regular-term weekday at 18°C with no rain. Rain shown per 10 mm.">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Hall</th><th className="num">Friday</th><th className="num">Saturday</th><th className="num">Midterms</th><th className="num">Finals</th><th className="num">Break</th><th className="num">Per +1°C</th><th className="num">Per 10 mm rain</th><th className="num">Calibration</th></tr></thead>
            <tbody>
              {coef.map((c) => (
                <tr key={c.hall}><td>{c.hall}</td><td className="num">{c.fri}</td><td className="num">{c.sat}</td><td className="num">{c.mid}</td><td className="num">{c.fin}</td><td className="num">{c.brk}</td><td className="num">{c.temp}</td><td className="num">{c.rain}</td><td className="num">×{c.calib?.toFixed(3)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>Model: per-hall log-linear ridge regression over {FEATURES.length} features (day of week, academic phase, temperature, precipitation) with calendar priors, event multipliers as offsets, and recency-weighted dish shares.</p>
      </Card>
    </div>
  );
}

export function OverridesPage() {
  const { state, update, forecasts, horizon, audit, toast } = useStore();
  const [f, setF] = useState({ date: horizon[1], scope: 'dish', hall: 'north', dish: 'D01', mode: 'percent', value: 15, reason: '' });
  const [err, setErr] = useState('');
  const rows = forecasts[f.date] || [];
  const target = f.scope === 'dish' ? rows.filter((r) => r.dish === f.dish) : rows.filter((r) => r.hall === f.hall);
  const current = sum(target.map((r) => r.final));
  const preview = f.mode === 'absolute' ? Number(f.value) * (f.scope === 'dish' ? 1 : target.length) : current * (1 + Number(f.value) / 100);

  function submit(e) {
    e.preventDefault();
    if (!f.reason.trim()) return setErr('A reason is required for the audit trail.');
    if (f.mode === 'absolute' && f.scope !== 'dish') return setErr('Absolute values can only be set for a single dish.');
    if (Number.isNaN(Number(f.value)) || (f.mode === 'absolute' && Number(f.value) < 0) || (f.mode === 'percent' && Number(f.value) < -100)) return setErr('Enter a valid adjustment.');
    setErr('');
    const o = {
      id: uid('ovr'), date: f.date, hall: f.scope === 'dish' ? dishById[f.dish].hall : f.hall, dish: f.scope === 'dish' ? f.dish : null,
      mode: f.mode, value: Number(f.value), reason: f.reason.trim(), createdBy: state.session?.user?.name, createdAt: new Date().toISOString(), active: true,
    };
    update('overrides', (x) => [...x, o]);
    audit('Forecast override created', `${o.date} ${o.dish || o.hall}: ${o.mode === 'absolute' ? '=' : ''}${o.value}${o.mode === 'percent' ? '%' : ''} (${o.reason})`);
    toast('Override applied. Prep guide and purchasing updated.');
    setF({ ...f, reason: '' });
  }

  const list = [...state.overrides].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div className="stack">
      <PageHeader
        title="Manual Forecast Overrides"
        subtitle="Adjust or replace automated predictions for special events and operational changes the model can't see. Overrides flow straight into the prep guide and purchasing plan."
        features={['F1.4']}
        reqs={reqLabels(['F1.4'])}
      />
      <div className="grid g2">
        <Card title="New override">
          <form onSubmit={submit} className="stack">
            <div className="form-grid">
              <Field label="Date">
                <select value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })}>
                  {horizon.map((d) => <option key={d} value={d}>{fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</option>)}
                </select>
              </Field>
              <Field label="Scope">
                <Segmented value={f.scope} onChange={(v) => setF({ ...f, scope: v, mode: v === 'hall' ? 'percent' : f.mode })} options={[['dish', 'Single dish'], ['hall', 'Whole hall']]} />
              </Field>
              {f.scope === 'dish' ? (
                <Field label="Dish">
                  <select value={f.dish} onChange={(e) => setF({ ...f, dish: e.target.value })}>
                    {DISHES.map((d) => <option key={d.id} value={d.id}>{d.name} · {hallById[d.hall].name}</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="Hall">
                  <select value={f.hall} onChange={(e) => setF({ ...f, hall: e.target.value })}>
                    {HALLS.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Adjustment type">
                <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
                  <option value="percent">Percent change</option>
                  {f.scope === 'dish' && <option value="absolute">Set exact portions</option>}
                </select>
              </Field>
              <Field label={f.mode === 'percent' ? 'Change (%)' : 'Portions'}>
                <input type="number" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
              </Field>
            </div>
            <Field label="Reason (required)" error={err}>
              <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Basketball tournament catering, 120 extra athletes" />
            </Field>
            <div className="alert alert-ok small">
              <span>ℹ️</span>
              <span>Current forecast: <strong>{fmt.n(current)}</strong> portions → after override: <strong>{fmt.n(preview)}</strong> ({fmt.signedPct(current ? preview / current : 1)})</span>
            </div>
            <div><button className="btn-primary">Apply override</button></div>
          </form>
        </Card>
        <Card title="Override log" subtitle="Every override is attributed and timestamped. Deactivate to restore the model forecast.">
          {list.length === 0 ? <Empty>No overrides yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Target</th><th>Change</th><th>Reason</th><th>By</th><th /></tr></thead>
                <tbody>
                  {list.map((o) => (
                    <tr key={o.id} style={{ opacity: o.active ? 1 : 0.5 }}>
                      <td>{fmtDate(o.date)}</td>
                      <td>{o.dish ? dishById[o.dish].name : `${hallById[o.hall].name} (all)`}</td>
                      <td><Badge tone="warn">{o.mode === 'absolute' ? `= ${o.value}` : `${o.value > 0 ? '+' : ''}${o.value}%`}</Badge></td>
                      <td className="small">{o.reason}</td>
                      <td className="small muted">{o.createdBy}</td>
                      <td className="num">
                        <button className="btn-sm btn-ghost" onClick={() => { update('overrides', (x) => x.map((y) => (y.id === o.id ? { ...y, active: !y.active } : y))); audit(o.active ? 'Override deactivated' : 'Override reactivated', o.id); }}>
                          {o.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
