import { useMemo, useState } from 'react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, ReferenceLine, Cell, Legend } from 'recharts';
import { useStore } from '../store.jsx';
import { HALLS, dishById, hallById, ingredientById } from '../data/catalog.js';
import { prepPlan } from '../engine/prep.js';
import { ingredientNeeds } from '../engine/inventory.js';
import { menuAnalysis, filterRecords } from '../engine/analytics.js';
import { toCSV, downloadText } from '../engine/csv.js';
import { fmtDate, addDays, uid, sum, round, groupBy } from '../engine/util.js';
import { PageHeader, Card, Kpi, Badge, Field, Segmented, Empty, Meter, Stars, fmt, CHART } from '../components/ui.jsx';
import { reqLabels } from '../data/rtm.js';

export function PrepPage() {
  const { state, set, update, forecasts, baseRecords, horizon, TODAY } = useStore();
  const [day, setDay] = useState(TODAY);
  const [hall, setHall] = useState('all');
  const sl = state.settings.serviceLevel;
  const canTune = ['manager', 'admin'].includes(state.session?.user?.role);
  const plan = useMemo(() => prepPlan(forecasts[day], baseRecords, sl), [forecasts, day, baseRecords, sl]);
  const rows = plan.filter((p) => hall === 'all' || p.hall === hall);
  const totalRec = sum(rows.map((r) => r.recommended));
  const totalPar = sum(rows.map((r) => r.par));
  const leftoverKg = sum(rows.map((r) => r.expLeftoverKg));
  const done = state.prepDone[day] || {};

  return (
    <div className="stack">
      <PageHeader
        title="Daily Prep Guide"
        subtitle="Exact portions to prepare for each item, split into batches. Later batches are cook-to-demand: confirm against live counts before starting them."
        features={['F2.1']}
        reqs={reqLabels(['F2.1'])}
        actions={
          <>
            <Segmented value={day} onChange={setDay} options={horizon.slice(0, 3).map((d, i) => [d, i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(d, { weekday: 'short' })])} />
          </>
        }
      />
      <div className="grid g4">
        <Kpi label="Portions to prep" value={fmt.n(totalRec)} sub={`${rows.length} items · ${fmtDate(day, { weekday: 'long', month: 'short', day: 'numeric' })}`} />
        <Kpi
          label="vs. traditional par levels"
          value={`${totalPar - totalRec >= 0 ? '−' : '+'}${fmt.n(Math.abs(totalPar - totalRec))}`}
          sub={totalPar - totalRec >= 0 ? `${fmt.pct(((totalPar - totalRec) / totalPar) * 100)} fewer portions than par` : 'Busy day: par (a flat 14-day average) would under-prep and sell out'}
          tone={totalPar - totalRec >= 0 ? 'good' : 'warn'}
        />
        <Kpi label="Expected leftover" value={`${fmt.n(leftoverKg, 1)} kg`} sub="Statistical expectation at this service level" />
        <Kpi label="Service level" value={fmt.pct(sl * 100, 0)} sub={`Chance each item lasts through service · ${fmt.pct((1 - sl) * 100, 0)} sell-out risk`} />
      </div>
      <Card
        title="Prep schedule"
        actions={
          <>
            <Segmented value={hall} onChange={setHall} options={[['all', 'All'], ...HALLS.map((h) => [h.id, h.name])]} />
            <label className="row small" title={canTune ? '' : 'Managers set the service level'}>
              Service level
              <input type="range" min={0.6} max={0.98} step={0.01} value={sl} disabled={!canTune} onChange={(e) => set({ settings: { ...state.settings, serviceLevel: Number(e.target.value) } })} />
            </label>
          </>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Done</th><th>Item</th><th>Hall</th><th className="num">Forecast</th><th className="num">Prep</th><th className="num">Par</th><th className="num">vs. par</th><th>Batches</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.dish} style={{ opacity: done[r.dish] ? 0.55 : 1 }}>
                  <td><input type="checkbox" checked={!!done[r.dish]} onChange={(e) => update('prepDone', (x) => ({ ...x, [day]: { ...(x[day] || {}), [r.dish]: e.target.checked } }))} aria-label="Mark prepped" /></td>
                  <td>
                    <div>{dishById[r.dish].name}</div>
                    <div className="muted small">{dishById[r.dish].category}{r.override ? ' · manager override' : ''}</div>
                  </td>
                  <td className="muted">{hallById[r.hall].name}</td>
                  <td className="num">{fmt.n(r.final)} <span className="muted small">±{fmt.n(r.sigma)}</span></td>
                  <td className="num"><strong style={{ fontSize: 15 }}>{fmt.n(r.recommended)}</strong></td>
                  <td className="num muted">{fmt.n(r.par)}</td>
                  <td className="num">{r.recommended < r.par ? <Badge tone="good">−{r.par - r.recommended}</Badge> : r.recommended > r.par ? <Badge tone="warn" title="Par would under-prep for this day's demand">+{r.recommended - r.par}</Badge> : <span className="muted">0</span>}</td>
                  <td>
                    <div className="tags">
                      {r.batches.map((b) => (
                        <Badge key={b.time} tone={b.onDemand ? 'violet' : 'neutral'} title={b.onDemand ? 'Cook-to-demand: check live counts first' : 'Scheduled batch'}>
                          {b.time} · {b.qty}{b.onDemand ? ' ⟳' : ''}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Prep = forecast + z × σ, where z is set by the service level and σ is the item's out-of-sample forecast error. Par = the traditional method (14-day average × 1.25). ⟳ marks cook-to-demand batches.
        </p>
      </Card>
    </div>
  );
}

export function PurchasingPage() {
  const { state, set, update, purchasing, audit, toast } = useStore();
  const toOrder = purchasing.filter((p) => p.orderQty > 0);
  const cost = sum(toOrder.map((p) => p.orderCost));
  const naive = sum(purchasing.map((p) => p.naiveCost));
  const canOrder = ['manager', 'admin'].includes(state.session?.user?.role);

  function createPO() {
    const po = { id: uid('PO').toUpperCase(), createdAt: new Date().toISOString(), by: state.session?.user?.name, status: 'Open', lines: toOrder.map((p) => ({ ingredient: p.id, qty: p.orderQty, cost: p.orderCost, eta: addDays(new Date().toISOString().slice(0, 10), p.leadTime) })), total: cost };
    update('purchaseOrders', (x) => [po, ...x]);
    update('stock', (s) => {
      const n = { ...s };
      for (const l of po.lines) n[l.ingredient] = { ...n[l.ingredient], onOrder: (n[l.ingredient].onOrder || 0) + l.qty };
      return n;
    });
    audit('Purchase order created', `${po.id} · ${po.lines.length} lines · $${round(cost)}`);
    toast(`Purchase order ${po.id} created.`);
  }

  function receive(po) {
    update('stock', (s) => {
      const n = { ...s };
      for (const l of po.lines) n[l.ingredient] = { onHand: n[l.ingredient].onHand + l.qty, onOrder: Math.max(0, n[l.ingredient].onOrder - l.qty) };
      return n;
    });
    update('purchaseOrders', (x) => x.map((p) => (p.id === po.id ? { ...p, status: 'Received', receivedAt: new Date().toISOString() } : p)));
    audit('Purchase order received', po.id);
    toast(`${po.id} received into inventory.`);
  }

  return (
    <div className="stack">
      <PageHeader
        title="Purchasing & Safety Stock"
        subtitle="Order quantities that cover each ingredient's lead time and review period from the 7-day forecast, plus a statistical safety stock, net of stock on hand and on order."
        features={['F2.2']}
        reqs={reqLabels(['F2.2'])}
        actions={
          <>
            <button onClick={() => downloadText('wasteless-purchase-plan.csv', toCSV(purchasing.map((p) => ({ ingredient: p.name, unit: p.unit, on_hand: p.onHand, on_order: p.onOrder, lead_time_days: p.leadTime, lead_time_demand: p.leadDemand, safety_stock: p.safetyStock, reorder_point: p.reorderPoint, order_qty: p.orderQty, order_cost: p.orderCost }))))}>⬇ Export CSV</button>
            <button className="btn-primary" disabled={!toOrder.length || !canOrder} onClick={createPO} title={canOrder ? '' : 'Manager approval required'}>Create purchase order ({toOrder.length})</button>
          </>
        }
      />
      <div className="grid g4">
        <Kpi label="Recommended order" value={fmt.usd(cost)} sub={`${toOrder.length} of ${purchasing.length} ingredients`} />
        <Kpi label="Naive ordering (horizon +30%)" value={fmt.usd(naive)} sub="No netting of stock on hand" />
        <Kpi label="Avoided over-ordering" value={fmt.usd(naive - cost)} tone="good" sub={naive ? `${fmt.pct(((naive - cost) / naive) * 100)} less spend` : ''} />
        <Kpi label="Below reorder point" value={purchasing.filter((p) => p.belowReorder).length} tone={purchasing.some((p) => p.belowReorder) ? 'warn' : 'good'} sub="Stock position < lead-time demand + safety stock" />
      </div>
      <Card
        title="Ingredient plan"
        actions={
          <label className="row small">
            Safety-stock service level {fmt.pct(state.settings.purchaseServiceLevel * 100, 0)}
            <input type="range" min={0.8} max={0.99} step={0.01} value={state.settings.purchaseServiceLevel} disabled={!canOrder} onChange={(e) => set({ settings: { ...state.settings, purchaseServiceLevel: Number(e.target.value) } })} />
          </label>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Ingredient</th><th className="num">On hand</th><th className="num">On order</th><th className="num">Avg daily use</th><th className="num">Lead time</th><th className="num">Lead-time demand</th><th className="num">Safety stock</th><th className="num">Reorder point</th><th>Status</th><th className="num">Order qty</th><th className="num">Cost</th></tr>
            </thead>
            <tbody>
              {purchasing.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="num">{fmt.n(p.onHand, 1)} {p.unit}</td>
                  <td className="num">{fmt.n(p.onOrder, 1)}</td>
                  <td className="num">{fmt.n(p.avgDaily, 1)}</td>
                  <td className="num">{p.leadTime} d</td>
                  <td className="num">{fmt.n(p.leadDemand, 1)}</td>
                  <td className="num">{fmt.n(p.safetyStock, 1)}</td>
                  <td className="num">{fmt.n(p.reorderPoint, 1)}</td>
                  <td>{p.belowReorder ? <Badge tone="warn">Reorder</Badge> : <Badge tone="good">OK · {p.daysOfCover}d cover</Badge>}</td>
                  <td className="num"><strong>{p.orderQty ? `${fmt.n(p.orderQty)} ${p.unit}` : '—'}</strong></td>
                  <td className="num">{p.orderQty ? fmt.usd(p.orderCost) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Safety stock = z × σ<sub>daily</sub> × √lead time. Order = demand over (lead time + 1-day review) + safety stock − (on hand + on order), rounded up to the supplier pack size.
        </p>
      </Card>
      <Card title="Purchase orders">
        {state.purchaseOrders.length === 0 ? <Empty>No purchase orders yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>PO</th><th>Created</th><th>By</th><th className="num">Lines</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
              <tbody>
                {state.purchaseOrders.map((po) => (
                  <tr key={po.id}>
                    <td><code>{po.id}</code></td>
                    <td>{new Date(po.createdAt).toLocaleString()}</td>
                    <td>{po.by}</td>
                    <td className="num" title={po.lines.map((l) => `${ingredientById[l.ingredient].name}: ${l.qty}`).join('\n')}>{po.lines.length}</td>
                    <td className="num">{fmt.usd(po.total)}</td>
                    <td><Badge tone={po.status === 'Open' ? 'ok' : 'good'}>{po.status}</Badge></td>
                    <td className="num">{po.status === 'Open' && <button className="btn-sm" onClick={() => receive(po)}>Mark received</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function InventoryPage() {
  const { state, update, alerts, todayPrep, purchasing, audit, toast } = useStore();
  const need = ingredientNeeds(Object.fromEntries(todayPrep.map((p) => [p.dish, p.recommended])));
  const open = alerts.filter((a) => !state.ackAlerts.includes(a.id));
  const acked = alerts.filter((a) => state.ackAlerts.includes(a.id));

  function setOnHand(id, v) {
    const val = Math.max(0, Number(v) || 0);
    update('stock', (s) => ({ ...s, [id]: { ...s[id], onHand: val } }));
  }

  return (
    <div className="stack">
      <PageHeader
        title="Low Stock & Shortage Alerts"
        subtitle="Live comparison of ingredient stock with what today's prep plan needs. Alerts update the moment a stock count changes."
        features={['F2.3']}
        reqs={reqLabels(['F2.3'])}
      />
      <div className="grid g3">
        <Kpi label="Critical shortages" value={alerts.filter((a) => a.level === 'critical').length} tone={alerts.some((a) => a.level === 'critical') ? 'bad' : 'good'} sub="On hand < today's requirement" />
        <Kpi label="Safety-stock warnings" value={alerts.filter((a) => a.level === 'warning').length} tone={alerts.some((a) => a.level === 'warning') ? 'warn' : 'good'} sub="Requirement covered, safety buffer breached" />
        <Kpi label="Ingredients tracked" value={purchasing.length} sub="Requirement from today's prep guide" />
      </div>
      <Card title={`Active alerts (${open.length})`}>
        {open.length === 0 ? <Empty>✅ All ingredients cover today's prep requirement.</Empty> : (
          <div className="stack">
            {open.map((a) => (
              <div key={a.id} className={`alert alert-${a.level === 'critical' ? 'bad' : 'warn'}`}>
                <span>{a.level === 'critical' ? '⛔' : '⚠️'}</span>
                <div style={{ flex: 1 }}>
                  <strong>{a.name}</strong> · {a.level === 'critical' ? `short ${a.shortfall} ${a.unit}` : 'below safety stock'}
                  <div className="small">On hand {a.onHand} {a.unit} vs. {a.required} {a.unit} needed today ({a.coverage}% covered){a.safetyStock ? ` · safety stock ${a.safetyStock}` : ''}</div>
                  <div className="small muted">Affects: {a.affected.join(', ')}</div>
                </div>
                <button className="btn-sm" onClick={() => { update('ackAlerts', (x) => [...x, a.id]); audit('Alert acknowledged', a.id); }}>Acknowledge</button>
              </div>
            ))}
          </div>
        )}
        {acked.length > 0 && <p className="muted small" style={{ marginTop: 10 }}>{acked.length} acknowledged alert(s) still active. <button className="btn-sm btn-ghost" onClick={() => update('ackAlerts', () => [])}>Show again</button></p>}
      </Card>
      <Card title="Stock count" subtitle="Enter physical counts to update inventory. Coverage = on hand ÷ today's requirement.">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ingredient</th><th className="num">Needed today</th><th style={{ width: 150 }}>On hand</th><th style={{ width: 200 }}>Coverage</th><th>Status</th><th /></tr></thead>
            <tbody>
              {purchasing.map((p) => {
                const req = need[p.id];
                const cov = req > 0 ? (p.onHand / req) * 100 : 999;
                const a = alerts.find((x) => x.ingredient === p.id);
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="num">{fmt.n(req, 1)} {p.unit}</td>
                    <td><input type="number" min={0} step="0.1" value={state.stock[p.id].onHand} onChange={(e) => setOnHand(p.id, e.target.value)} style={{ width: 110 }} aria-label={`${p.name} on hand`} /> <span className="muted small">{p.unit}</span></td>
                    <td><Meter pct={Math.min(100, cov / 2)} tone={a?.level === 'critical' ? 'bad' : a ? 'warn' : 'good'} /><span className="small muted">{req > 0 ? `${Math.round(cov)}%` : 'not needed today'}</span></td>
                    <td>{a ? <Badge tone={a.level === 'critical' ? 'bad' : 'warn'}>{a.level}</Badge> : <Badge tone="good">OK</Badge>}</td>
                    <td className="num">
                      <button className="btn-sm btn-ghost" title="Simulate usage during service" onClick={() => { setOnHand(p.id, round(state.stock[p.id].onHand - req * 0.25, 2)); toast(`Recorded usage of ${p.name}.`); }}>− use</button>
                    </td>
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

const QUAD_COLOR = { Star: CHART.actual, 'Over-prepped favorite': '#d4a72c', Niche: '#2f80c8', 'Problem item': '#cf4433' };

export function AnalyzerPage() {
  const { records, state, TODAY } = useStore();
  const [win, setWin] = useState(30);
  const [fbDish, setFbDish] = useState('all');
  const rows = useMemo(() => menuAnalysis(filterRecords(records, { from: addDays(TODAY, -win), to: TODAY }), state.ratings), [records, state.ratings, win, TODAY]);
  const ranked = [...rows].sort((a, b) => b.popularity - b.wasteRate * 3 - (a.popularity - a.wasteRate * 3));
  const reviews = state.ratings.filter((r) => fbDish === 'all' || r.dish === fbDish).sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1)).slice(0, 25);
  const tagCounts = [...groupBy(state.ratings.filter((r) => fbDish === 'all' || r.dish === fbDish).flatMap((r) => r.tags), (t) => t)].map(([t, xs]) => [t, xs.length]).sort((a, b) => b[1] - a[1]);

  return (
    <div className="stack">
      <PageHeader
        title="Menu Popularity & Waste Analyzer"
        subtitle="Which dishes earn their place on the menu? Popularity (servings vs. hall average) is plotted against waste rate, with student ratings alongside."
        features={['F2.4', 'F5.5']}
        reqs={reqLabels(['F2.4'])}
        actions={<Segmented value={win} onChange={setWin} options={[[14, '14 days'], [30, '30 days'], [90, '90 days']]} />}
      />
      <div className="grid g2">
        <Card title="Menu engineering matrix" subtitle="Right = more popular · Up = more waste. Hover a point for details.">
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 10, right: 16, bottom: 18, left: 0 }}>
              <CartesianGrid stroke={CHART.grid} />
              <XAxis type="number" dataKey="popularity" name="Popularity" unit="" tick={{ fontSize: 11 }} label={{ value: 'Popularity index (100 = hall average)', position: 'bottom', fontSize: 11, offset: 0 }} />
              <YAxis type="number" dataKey="wasteRate" name="Waste rate" unit="%" tick={{ fontSize: 11 }} width={44} />
              <ZAxis type="number" dataKey="avgDaily" range={[60, 360]} />
              <ReferenceLine x={100} stroke="var(--muted)" strokeDasharray="3 3" />
              <ReferenceLine y={[...rows].map((r) => r.wasteRate).sort((a, b) => a - b)[Math.floor(rows.length / 2)]} stroke="var(--muted)" strokeDasharray="3 3" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => payload?.[0] ? (
                <div className="card" style={{ padding: 10 }}>
                  <strong>{payload[0].payload.name}</strong>
                  <div className="small">{payload[0].payload.quadrant}</div>
                  <div className="small muted">Popularity {payload[0].payload.popularity} · waste {payload[0].payload.wasteRate}%</div>
                </div>
              ) : null} />
              <Scatter data={rows} isAnimationActive={false}>
                {rows.map((r) => <Cell key={r.id} fill={QUAD_COLOR[r.quadrant]} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div className="row small">{Object.entries(QUAD_COLOR).map(([q, c]) => <span key={q} className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 5, background: c }} />{q}</span>)}</div>
        </Card>
        <div className="stack">
          <Card title="🏆 Top performers">
            {ranked.slice(0, 4).map((r) => (
              <div key={r.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ flex: 1 }}>{r.name}</span>
                <span className="small muted">pop {r.popularity} · waste {r.wasteRate}%</span>
                {r.rating && <Badge tone="good">★ {r.rating}</Badge>}
              </div>
            ))}
          </Card>
          <Card title="⚠️ Underperformers">
            {ranked.slice(-4).reverse().map((r) => (
              <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row"><span style={{ flex: 1 }}>{r.name}</span><span className="small muted">pop {r.popularity} · waste {r.wasteRate}%</span>{r.rating && <Badge tone={r.rating < 3 ? 'bad' : 'neutral'}>★ {r.rating}</Badge>}</div>
                <div className="small muted">{r.action}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
      <Card title="All menu items">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Hall</th><th className="num">Avg servings/day</th><th className="num">Popularity</th><th className="num">Waste rate</th><th className="num">Waste cost</th><th className="num">Rating</th><th>Classification</th><th>Recommendation</th></tr></thead>
            <tbody>
              {[...rows].sort((a, b) => b.popularity - a.popularity).map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="muted">{hallById[r.hall].name}</td>
                  <td className="num">{fmt.n(r.avgDaily, 1)}</td>
                  <td className="num">{r.popularity}</td>
                  <td className="num">{r.wasteRate}%</td>
                  <td className="num">{fmt.usd(r.wasteCost)}</td>
                  <td className="num">{r.rating ? `★ ${r.rating} (${r.reviews})` : '—'}</td>
                  <td><Badge tone={r.quadrant === 'Star' ? 'good' : r.quadrant === 'Problem item' ? 'bad' : r.quadrant === 'Niche' ? 'ok' : 'warn'}>{r.quadrant}</Badge></td>
                  <td className="small">{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card
        title="Student feedback for recipe evaluation"
        subtitle="Ratings and comments submitted from the student portal (F5.5)."
        actions={
          <select value={fbDish} onChange={(e) => setFbDish(e.target.value)}>
            <option value="all">All dishes</option>
            {rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        }
      >
        <div className="tags" style={{ marginBottom: 10 }}>{tagCounts.map(([t, n]) => <Badge key={t} tone="neutral">{t} · {n}</Badge>)}</div>
        {reviews.length === 0 ? <Empty>No reviews yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Dish</th><th>Rating</th><th>Tags</th><th>Comment</th></tr></thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{fmtDate(r.date)}</td>
                    <td>{dishById[r.dish].name}</td>
                    <td><Stars value={r.stars} size={14} /></td>
                    <td><div className="tags">{r.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div></td>
                    <td className="small">{r.comment || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
