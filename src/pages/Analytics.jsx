import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, BarChart, LineChart, ReferenceLine, Area, AreaChart,
} from 'recharts';
import { useStore } from '../store.jsx';
import { HALLS, DISHES, CATEGORIES, SHIFTS, WASTE_REASONS, dishById, hallById } from '../data/catalog.js';
import { aggregate, kpis, filterRecords, wasteByCategory, savingsAnalysis, carbonEquivalents, carbonByCategory } from '../engine/analytics.js';
import { toCSV, downloadText, saveFile } from '../engine/csv.js';
import { fmtDate, addDays, uid, sum, round, groupBy, monthKey } from '../engine/util.js';
import { PageHeader, Card, Kpi, Badge, Field, Segmented, Empty, Meter, fmt, CHART } from '../components/ui.jsx';
import { reqLabels } from '../data/rtm.js';

export function WasteLogPage() {
  const { state, update, todayPrep, audit, toast, TODAY } = useStore();
  const [date, setDate] = useState(TODAY);
  const [shift, setShift] = useState(new Date().getHours() < 11 ? 'Breakfast' : new Date().getHours() < 16 ? 'Lunch' : 'Dinner');
  const [hall, setHall] = useState('north');
  const blank = () => Object.fromEntries(DISHES.map((d) => [d.id, { leftover: '', discarded: '', reason: 'Overproduction' }]));
  const [grid, setGrid] = useState(blank);
  const [errors, setErrors] = useState({});
  const dishes = DISHES.filter((d) => d.hall === hall);
  const byCat = groupBy(dishes, (d) => d.category);
  const prepToday = Object.fromEntries(todayPrep.map((p) => [p.dish, p.recommended]));

  function submit(e) {
    e.preventDefault();
    const errs = {};
    const entries = [];
    for (const d of dishes) {
      const g = grid[d.id];
      if (g.leftover === '' && g.discarded === '') continue;
      const lo = g.leftover === '' ? 0 : Number(g.leftover);
      const kg = g.discarded === '' ? 0 : Number(g.discarded);
      if (!Number.isInteger(lo) || lo < 0) errs[d.id] = 'Leftover must be a whole number ≥ 0';
      else if (Number.isNaN(kg) || kg < 0 || kg > 500) errs[d.id] = 'Discarded weight must be 0–500 kg';
      else if (lo === 0 && kg === 0) continue;
      else entries.push({ id: uid('w'), date, shift, hall, dish: d.id, category: d.category, leftoverPortions: lo, discardedKg: kg, reason: g.reason, staff: state.session?.user?.name, createdAt: new Date().toISOString() });
    }
    setErrors(errs);
    if (Object.keys(errs).length) return toast('Fix the highlighted rows before submitting.', 'warn');
    if (!entries.length) return toast('Enter leftover portions or discarded weight for at least one item.', 'warn');
    update('wasteLogs', (x) => [...entries, ...x]);
    audit('Waste logged', `${date} ${shift} ${hallById[hall].name}: ${entries.length} items`);
    toast(`Logged ${entries.length} item(s) for ${shift}. Dashboard updated.`);
    setGrid(blank());
  }

  const recent = state.wasteLogs.slice(0, 40);
  const todayLogs = state.wasteLogs.filter((l) => l.date === date);
  const catSummary = [...groupBy(todayLogs, (l) => dishById[l.dish].category)].map(([c, ls]) => ({ c, kg: round(sum(ls.map((l) => l.leftoverPortions * dishById[l.dish].kg + l.discardedKg)), 1) }));

  return (
    <div className="stack">
      <PageHeader
        title="End-of-Shift Waste Log"
        subtitle="Record unserved prep (portions) and discarded food (kg: plate waste, spoilage) for each item, grouped by dish category."
        features={['F3.1']}
        reqs={reqLabels(['F3.1'])}
      />
      <Card>
        <form onSubmit={submit} className="stack">
          <div className="form-grid">
            <Field label="Date"><input type="date" value={date} max={TODAY} onChange={(e) => setDate(e.target.value)} required /></Field>
            <Field label="Shift"><Segmented value={shift} onChange={setShift} options={SHIFTS} /></Field>
            <Field label="Dining hall">
              <select value={hall} onChange={(e) => setHall(e.target.value)}>{HALLS.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
            </Field>
            <Field label="Logged by"><input value={state.session?.user?.name || ''} disabled /></Field>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Category / item</th><th className="num">Prepped today</th><th>Leftover prep (portions)</th><th>Discarded (kg)</th><th>Primary reason</th><th className="num">Est. waste</th></tr></thead>
              <tbody>
                {[...byCat.entries()].map(([cat, ds]) => [
                  <tr key={cat}><td colSpan={6} style={{ background: 'var(--panel-2)', fontWeight: 600, fontSize: 12 }}>{cat}</td></tr>,
                  ...ds.map((d) => {
                    const g = grid[d.id];
                    const est = (Number(g.leftover) || 0) * d.kg + (Number(g.discarded) || 0);
                    return (
                      <tr key={d.id}>
                        <td>{d.name}{errors[d.id] && <div className="field-error">{errors[d.id]}</div>}</td>
                        <td className="num muted">{date === TODAY ? prepToday[d.id] : '—'}</td>
                        <td><input type="number" min={0} step={1} value={g.leftover} onChange={(e) => setGrid({ ...grid, [d.id]: { ...g, leftover: e.target.value } })} style={{ width: 100 }} aria-label={`${d.name} leftover portions`} /></td>
                        <td><input type="number" min={0} step={0.1} value={g.discarded} onChange={(e) => setGrid({ ...grid, [d.id]: { ...g, discarded: e.target.value } })} style={{ width: 100 }} aria-label={`${d.name} discarded kg`} /></td>
                        <td><select value={g.reason} onChange={(e) => setGrid({ ...grid, [d.id]: { ...g, reason: e.target.value } })}>{WASTE_REASONS.map((r) => <option key={r}>{r}</option>)}</select></td>
                        <td className="num">{est ? `${est.toFixed(1)} kg` : '—'}</td>
                      </tr>
                    );
                  }),
                ])}
              </tbody>
            </table>
          </div>
          <div className="row"><button className="btn-primary">Submit shift log</button><span className="muted small">Leftover portions are converted to kg using each item's portion weight.</span></div>
        </form>
      </Card>
      <div className="grid g2">
        <Card title={`Waste by category · ${fmtDate(date)}`}>
          {catSummary.length === 0 ? <Empty>No waste logged for this date yet.</Empty> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={catSummary} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid stroke={CHART.grid} horizontal={false} />
                <XAxis type="number" unit=" kg" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="c" tick={{ fontSize: 11 }} width={80} />
                <Tooltip formatter={(v) => `${v} kg`} />
                <Bar dataKey="kg" fill={CHART.waste} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card title="Recent entries">
          {recent.length === 0 ? <Empty>No entries yet.</Empty> : (
            <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>Date</th><th>Shift</th><th>Item</th><th className="num">Leftover</th><th className="num">Discarded</th><th>Reason</th><th /></tr></thead>
                <tbody>
                  {recent.map((l) => (
                    <tr key={l.id}>
                      <td>{fmtDate(l.date)}</td><td>{l.shift}</td><td>{dishById[l.dish].name}</td>
                      <td className="num">{l.leftoverPortions}</td><td className="num">{l.discardedKg} kg</td><td className="small">{l.reason}</td>
                      <td><button className="btn-sm btn-ghost btn-danger" onClick={() => { update('wasteLogs', (x) => x.filter((y) => y.id !== l.id)); audit('Waste entry deleted', l.id); }}>✕</button></td>
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

export function DashboardPage() {
  const { records, TODAY, HISTORY } = useStore();
  const [gran, setGran] = useState('daily');
  const [from, setFrom] = useState(addDays(TODAY, -60));
  const [to, setTo] = useState(TODAY);
  const [hall, setHall] = useState('all');
  const [category, setCategory] = useState('all');
  const [dish, setDish] = useState('all');
  const filtered = useMemo(() => filterRecords(records, { from, to, hall, category, dish }), [records, from, to, hall, category, dish]);
  const series = useMemo(() => aggregate(filtered, gran).map((p) => ({ ...p, label: gran === 'monthly' ? p.key : fmtDate(p.key) })), [filtered, gran]);
  const k = kpis(filtered);
  const cats = wasteByCategory(filtered);
  const goLiveLabel = gran === 'daily' ? fmtDate(HISTORY.goLive) : null;

  return (
    <div className="stack">
      <PageHeader
        title="Operations & Trend Dashboard"
        subtitle="Predicted demand, actual consumption and waste side by side. Filter by period, hall, category or dish and switch between daily, weekly and monthly views."
        features={['F3.2']}
        reqs={reqLabels(['F3.2'])}
        actions={<button onClick={() => downloadText(`wasteless-consumption-${gran}.csv`, toCSV(series, ['key', 'predicted', 'consumed', 'prepared', 'leftover', 'wasteKg', 'mape']))}>⬇ Export CSV</button>}
      />
      <Card>
        <div className="row">
          <Segmented value={gran} onChange={setGran} options={[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]} />
          <Segmented value={from} onChange={setFrom} options={[[addDays(TODAY, -30), '30d'], [addDays(TODAY, -60), '60d'], [addDays(TODAY, -180), '180d']]} />
          <label className="row small">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="row small">To <input type="date" value={to} min={from} max={TODAY} onChange={(e) => setTo(e.target.value)} /></label>
          <select value={hall} onChange={(e) => { setHall(e.target.value); setDish('all'); }}><option value="all">All halls</option>{HALLS.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <select value={dish} onChange={(e) => setDish(e.target.value)}><option value="all">All dishes</option>{DISHES.filter((d) => hall === 'all' || d.hall === hall).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </div>
      </Card>
      <div className="grid g4">
        <Kpi label="Portions consumed" value={fmt.n(k.consumed)} sub={`${fmt.n(k.prepared)} prepared`} />
        <Kpi label="Food waste" value={`${fmt.n(k.wasteKg)} kg`} tone="warn" sub="Leftover prep + plate waste" />
        <Kpi label="Leftover rate" value={fmt.pct(k.leftoverRate)} sub="Unserved ÷ prepared" />
        <Kpi label="Forecast accuracy" value={fmt.pct(k.accuracy)} sub={`MAPE ${fmt.pct(k.mape)}`} tone={k.mape < 15 ? 'good' : 'bad'} />
      </div>
      <Card title="Predicted vs. actual consumption vs. waste">
        {series.length === 0 ? <Empty>No data for these filters.</Empty> : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={16} />
              <YAxis yAxisId="p" tick={{ fontSize: 11 }} width={52} />
              <YAxis yAxisId="w" orientation="right" tick={{ fontSize: 11 }} width={48} unit=" kg" />
              <Tooltip />
              <Legend />
              <Bar yAxisId="p" dataKey="predicted" name="Predicted demand" fill={CHART.predicted} radius={[3, 3, 0, 0]} />
              <Bar yAxisId="p" dataKey="consumed" name="Actual consumption" fill={CHART.actual} radius={[3, 3, 0, 0]} />
              <Line yAxisId="w" dataKey="wasteKg" name="Waste (kg)" stroke={CHART.waste} strokeWidth={2} dot={false} />
              {goLiveLabel && <ReferenceLine yAxisId="p" x={goLiveLabel} stroke="var(--muted)" strokeDasharray="4 3" label={{ value: 'WasteLess go-live', fontSize: 11, fill: 'var(--muted)', position: 'insideTopLeft' }} />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>
      <div className="grid g2">
        <Card title="Waste by dish category">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={cats} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="category" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={48} unit=" kg" />
              <Tooltip formatter={(v) => `${v} kg`} />
              <Bar dataKey="wasteKg" name="Waste" fill={CHART.waste} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Leftover rate trend" subtitle="Share of prepared portions that went unserved.">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={series.map((s) => ({ ...s, rate: s.prepared ? round((s.leftover / s.prepared) * 100, 1) : 0 }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={16} />
              <YAxis tick={{ fontSize: 11 }} width={40} unit="%" />
              <Tooltip formatter={(v) => `${v}%`} />
              <Line dataKey="rate" name="Leftover rate" stroke={CHART.waste} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <Card title="Historical consumption table">
        <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>{gran === 'daily' ? 'Date' : gran === 'weekly' ? 'Week of' : 'Month'}</th><th className="num">Predicted</th><th className="num">Consumed</th><th className="num">Prepared</th><th className="num">Leftover</th><th className="num">Waste (kg)</th><th className="num">MAPE</th></tr></thead>
            <tbody>
              {[...series].reverse().map((s) => (
                <tr key={s.key}><td>{s.label}</td><td className="num">{fmt.n(s.predicted)}</td><td className="num">{fmt.n(s.consumed)}</td><td className="num">{fmt.n(s.prepared)}</td><td className="num">{fmt.n(s.leftover)}</td><td className="num">{fmt.n(s.wasteKg, 1)}</td><td className="num">{s.mape}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function SavingsPage() {
  const { records, state, set } = useStore();
  const s = useMemo(() => savingsAnalysis(records, state.settings), [records, state.settings]);
  const months = [...groupBy(s.series, (p) => monthKey(p.date))].map(([m, ps]) => ({ m, kg: round(sum(ps.map((p) => p.kg)), 0), usd: round(sum(ps.map((p) => p.usd)), 0) }));
  const perDayCost = (Number(state.settings.monthlyCost) / 30.4);
  const chart = s.series.map((p, i) => ({ ...p, label: fmtDate(p.date), cost: round(Number(state.settings.implementationCost) + perDayCost * (i + 1), 0) }));

  return (
    <div className="stack">
      <PageHeader
        title="Cost Savings & ROI"
        subtitle="Money saved by cutting waste, measured against the kitchen's pre-WasteLess baseline (kg of waste per portion served under traditional par-level prep)."
        features={['F3.3']}
        reqs={reqLabels(['F3.3'])}
      />
      <div className="grid g4">
        <Kpi label="Cumulative savings" value={fmt.usd(s.usdSaved)} tone="good" sub={`Over ${s.days} days since go-live`} />
        <Kpi label="Waste avoided" value={`${fmt.n(s.kgAvoided)} kg`} sub={`${fmt.usd2(s.kgAvoided ? s.usdSaved / s.kgAvoided : 0)} saved per kg avoided`} />
        <Kpi label="Return on investment" value={`${s.roi}%`} tone={s.roi >= 0 ? 'good' : 'bad'} sub={`Program cost to date ${fmt.usd(s.programCost)}`} />
        <Kpi label="Payback period" value={s.paybackMonths ? `${s.paybackMonths} mo` : 'n/a'} sub={`Annualized savings ${fmt.usd(s.annualizedSavings)}`} />
      </div>
      <Card title="Cumulative savings vs. program cost" subtitle="ROI turns positive where the savings line crosses the cost line.">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
            <YAxis tick={{ fontSize: 11 }} width={64} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => fmt.usd(v)} />
            <Legend />
            <Area dataKey="cumUsd" name="Cumulative savings" stroke={CHART.actual} fill={CHART.actual} fillOpacity={0.15} strokeWidth={2} />
            <Line dataKey="cost" name="Program cost" stroke={CHART.waste} strokeDasharray="5 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
      <div className="grid g2">
        <Card title="Baseline comparison">
          <table>
            <tbody>
              <tr><td>Waste per portion served, before WasteLess</td><td className="num"><strong>{(s.baselineKgPerPortion * 1000).toFixed(0)} g</strong></td></tr>
              <tr><td>Waste per portion served, with WasteLess</td><td className="num"><strong>{(s.currentKgPerPortion * 1000).toFixed(0)} g</strong></td></tr>
              <tr><td>Reduction</td><td className="num"><Badge tone="good">−{s.reductionPct}%</Badge></td></tr>
              <tr><td>Meals' worth of food saved</td><td className="num">{fmt.n(s.mealsSaved)}</td></tr>
            </tbody>
          </table>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <Field label="Implementation cost ($)"><input type="number" min={0} value={state.settings.implementationCost} onChange={(e) => set({ settings: { ...state.settings, implementationCost: Number(e.target.value) } })} /></Field>
            <Field label="Monthly operating cost ($)"><input type="number" min={0} value={state.settings.monthlyCost} onChange={(e) => set({ settings: { ...state.settings, monthlyCost: Number(e.target.value) } })} /></Field>
          </div>
        </Card>
        <Card title="Monthly savings">
          <table>
            <thead><tr><th>Month</th><th className="num">Waste avoided</th><th className="num">Savings</th></tr></thead>
            <tbody>{months.map((m) => <tr key={m.m}><td>{m.m}</td><td className="num">{fmt.n(m.kg)} kg</td><td className="num">{fmt.usd(m.usd)}</td></tr>)}</tbody>
          </table>
          <p className="muted small" style={{ marginTop: 10 }}>Savings per record = (baseline kg/portion × portions served − actual waste kg) ÷ portion weight × portion food cost.</p>
        </Card>
      </div>
    </div>
  );
}

export function SustainabilityPage() {
  const { records, state, set, audit, toast, TODAY } = useStore();
  const s = useMemo(() => savingsAnalysis(records, state.settings), [records, state.settings]);
  const eq = carbonEquivalents(s.co2AvoidedMt);
  const baseline = useMemo(() => {
    const pre = records.filter((r) => r.mode === 'traditional');
    const m = {};
    for (const d of DISHES) {
      const rs = pre.filter((r) => r.dish === d.id);
      const c = sum(rs.map((r) => r.consumed));
      m[d.id] = c ? sum(rs.map((r) => r.wasteKg)) / c : 0;
    }
    return m;
  }, [records]);
  const byCat = carbonByCategory(records, (id) => baseline[id]).sort((a, b) => b.mt - a.mt);
  const target = Number(state.settings.esgTargetPct);
  const progress = Math.min(100, (s.reductionPct / target) * 100);
  const chart = s.series.map((p) => ({ label: fmtDate(p.date), mt: p.cumCo2Mt }));
  const months = [...groupBy(s.series, (p) => monthKey(p.date))].map(([m, ps]) => ({ month: m, waste_avoided_kg: round(sum(ps.map((p) => p.kg)), 1), cost_savings_usd: round(sum(ps.map((p) => p.usd)), 2), co2e_avoided_mt: round(ps[ps.length - 1].cumCo2Mt - (s.series[s.series.indexOf(ps[0]) - 1]?.cumCo2Mt || 0), 3) }));

  function exportCSV() {
    const header = [
      `# WasteLess Sustainability & ESG Report,generated ${new Date().toLocaleString()}`,
      `# Reporting period,${s.series[0]?.date} to ${s.series[s.series.length - 1]?.date}`,
      `# Total CO2e avoided (MT),${s.co2AvoidedMt}`,
      `# Waste reduction vs baseline (%),${s.reductionPct}`,
      `# ESG target,${target}% reduction by ${state.settings.esgTargetYear}`,
      '',
    ].join('\n');
    downloadText(`wasteless-esg-report-${TODAY}.csv`, header + toCSV(months));
    audit('ESG report exported', 'CSV');
  }

  async function exportPDF() {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const green = [31, 138, 98];
    doc.setFillColor(...green);
    doc.rect(0, 0, 612, 84, 'F');
    doc.setTextColor(255);
    doc.setFontSize(20);
    doc.text('WasteLess Sustainability & ESG Report', 40, 42);
    doc.setFontSize(10);
    doc.text(`Campus Dining Services · Period ${s.series[0]?.date} to ${s.series[s.series.length - 1]?.date} · Generated ${new Date().toLocaleDateString()}`, 40, 64);
    doc.setTextColor(20);
    doc.setFontSize(13);
    doc.text('Headline impact', 40, 116);
    autoTable(doc, {
      startY: 126,
      theme: 'grid',
      headStyles: { fillColor: green },
      head: [['Metric', 'Value']],
      body: [
        ['Greenhouse gas emissions avoided', `${s.co2AvoidedMt} MT CO2e`],
        ['Food waste avoided', `${fmt.n(s.kgAvoided)} kg`],
        ['Meals saved (0.4 kg / meal)', fmt.n(s.mealsSaved)],
        ['Waste per portion: baseline → current', `${(s.baselineKgPerPortion * 1000).toFixed(0)} g → ${(s.currentKgPerPortion * 1000).toFixed(0)} g (−${s.reductionPct}%)`],
        ['Cost savings', fmt.usd(s.usdSaved)],
        ['Equivalent passenger cars removed for a year', String(eq.cars)],
        ['Equivalent tree seedlings grown for 10 years', fmt.n(eq.trees)],
      ],
    });
    let y = doc.lastAutoTable.finalY + 28;
    doc.setFontSize(13);
    doc.text('Campus ESG target progress', 40, y);
    doc.setFontSize(10);
    doc.text(`Target: ${target}% reduction in food waste per portion by ${state.settings.esgTargetYear}. Achieved: ${s.reductionPct}% (${progress.toFixed(0)}% of target).`, 40, y + 18);
    doc.setFillColor(230, 236, 232);
    doc.rect(40, y + 28, 532, 12, 'F');
    doc.setFillColor(...green);
    doc.rect(40, y + 28, (532 * progress) / 100, 12, 'F');
    y += 64;
    doc.setFontSize(13);
    doc.text('Monthly detail', 40, y);
    autoTable(doc, { startY: y + 10, theme: 'striped', headStyles: { fillColor: green }, head: [['Month', 'Waste avoided (kg)', 'CO2e avoided (MT)', 'Savings (USD)']], body: months.map((m) => [m.month, fmt.n(m.waste_avoided_kg, 1), m.co2e_avoided_mt.toFixed(3), fmt.usd(m.cost_savings_usd)]) });
    y = doc.lastAutoTable.finalY + 24;
    autoTable(doc, { startY: y, theme: 'striped', headStyles: { fillColor: green }, head: [['Category', 'CO2e avoided (MT)']], body: byCat.map((c) => [c.category, c.mt.toFixed(3)]) });
    y = doc.lastAutoTable.finalY + 20;
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(doc.splitTextToSize('Methodology: avoided waste = baseline kg-per-portion (pre-WasteLess, traditional par prep) × portions served − measured waste. Emissions = avoided kg × (category production factor + 0.58 kg CO2e/kg landfill disposal). Vehicle equivalence 4.6 MT CO2e/yr; tree seedling 0.06 MT over 10 yrs.', 532), 40, Math.min(y, 740));
    const saved = await saveFile(`wasteless-esg-report-${TODAY}.pdf`, doc.output('blob'), 'application/pdf');
    audit('ESG report exported', 'PDF');
    if (saved) toast('ESG report PDF ready.');
  }

  return (
    <div className="stack">
      <PageHeader
        title="Sustainability & Carbon Offsets"
        subtitle="Greenhouse gas emissions avoided by preventing food waste, tracked against the campus ESG target. Export formatted reports for compliance."
        features={['F3.4']}
        reqs={reqLabels(['F3.4'])}
        actions={<><button onClick={exportCSV}>⬇ CSV report</button><button className="btn-primary" onClick={exportPDF}>⬇ PDF report</button></>}
      />
      <div className="grid g4">
        <Kpi label="Emissions avoided" value={`${s.co2AvoidedMt} MT`} tone="good" sub="CO2e since go-live" />
        <Kpi label="Cars off the road" value={eq.cars} sub="Passenger vehicles for one year" />
        <Kpi label="Tree seedlings" value={fmt.n(eq.trees)} sub="Grown for 10 years" />
        <Kpi label="Miles not driven" value={fmt.n(eq.miles)} sub="Average gasoline car" />
      </div>
      <Card title={`ESG target: ${target}% less food waste per portion by ${state.settings.esgTargetYear}`}>
        <div className="row" style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 22 }}>{s.reductionPct}%</strong>
          <span className="muted">achieved · {progress.toFixed(0)}% of target</span>
          <div className="spacer" />
          <label className="row small">Target % <input type="number" min={5} max={90} value={state.settings.esgTargetPct} onChange={(e) => set({ settings: { ...state.settings, esgTargetPct: Number(e.target.value) } })} style={{ width: 70 }} /></label>
          <label className="row small">by <input type="number" min={2025} max={2040} value={state.settings.esgTargetYear} onChange={(e) => set({ settings: { ...state.settings, esgTargetYear: Number(e.target.value) } })} style={{ width: 80 }} /></label>
        </div>
        <Meter pct={progress} tone={progress >= 100 ? 'good' : 'ok'} />
      </Card>
      <div className="grid g2">
        <Card title="Cumulative CO2e avoided (MT)">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} width={44} />
              <Tooltip formatter={(v) => `${v} MT`} />
              <Area dataKey="mt" name="CO2e avoided" stroke={CHART.actual} fill={CHART.actual} fillOpacity={0.18} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Emissions avoided by category" subtitle="Protein-heavy categories carry the largest footprint per kg.">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byCat} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="category" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={44} />
              <Tooltip formatter={(v) => `${v} MT`} />
              <Bar dataKey="mt" name="MT CO2e" fill={CHART.actual} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <Card title="Report preview: monthly detail">
        <table>
          <thead><tr><th>Month</th><th className="num">Waste avoided</th><th className="num">CO2e avoided</th><th className="num">Savings</th></tr></thead>
          <tbody>{months.map((m) => <tr key={m.month}><td>{m.month}</td><td className="num">{fmt.n(m.waste_avoided_kg, 1)} kg</td><td className="num">{m.co2e_avoided_mt.toFixed(3)} MT</td><td className="num">{fmt.usd(m.cost_savings_usd)}</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}
