import { useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { DISHES, INGREDIENTS, HALLS } from '../data/catalog.js';
import { SCHEMAS, validateCSV, toDomain, templateCSV, toCSV, downloadText, MAX_FILE_BYTES } from '../engine/csv.js';
import { FEATURES, REQUIREMENTS, EPICS } from '../data/rtm.js';
import { uid, addDays, fmtDate } from '../engine/util.js';
import { PageHeader, Card, Kpi, Badge, Field, Segmented, Empty, fmt } from '../components/ui.jsx';
import { go } from '../nav.js';

function sampleFile(type, today) {
  // A realistic upload with a few deliberate errors to demonstrate validation.
  const d = (n) => addDays(today, -n);
  if (type === 'sales') {
    const rows = ['date,hall,dish_id,prepared,consumed,predicted'];
    for (let i = 1; i <= 3; i++) for (const dish of DISHES.slice(0, 6)) rows.push(`${d(i)},${dish.hall},${dish.id},${210 + i * 7},${190 + i * 5},${200 + i * 4}`);
    rows.push(`${d(2)},north,D99,120,100,110`); // unknown dish
    rows.push(`${d(2)},south,D07,80,95,90`); // consumed > prepared
    rows.push(`2026/11/01,north,D01,100,90,95`); // bad date format
    rows.push(`${addDays(today, 3)},north,D02,100,90,95`); // future date
    return rows.join('\n');
  }
  if (type === 'inventory') {
    return ['date,ingredient_id,on_hand,unit', ...INGREDIENTS.slice(0, 8).map((i) => `${d(0)},${i.id},${Math.round(i.onHand * 1.4)},${i.unit}`), `${d(0)},I04,-5,kg`, `${d(0)},I05,12,L`].join('\n');
  }
  const rows = ['date,shift,hall,dish_id,leftover_portions,discarded_kg,reason'];
  for (const dish of DISHES.slice(6, 11)) rows.push(`${d(1)},Lunch,${dish.hall},${dish.id},${8 + dish.id.charCodeAt(2) % 7},${(1.5 + (dish.id.charCodeAt(2) % 4) * 0.6).toFixed(1)},Overproduction`);
  rows.push(`${d(1)},Brunch,south,D08,5,1.0,Spoilage`); // bad shift
  rows.push(`${d(1)},Dinner,north,D08,5,1.0,Spoilage`); // dish not at hall
  return rows.join('\n');
}

export function AdminPage() {
  const { state, set, update, audit, toast, TODAY, HISTORY, records } = useStore();
  const [type, setType] = useState('sales');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [mode, setMode] = useState('valid-only');
  const [drag, setDrag] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const inputRef = useRef();

  function runValidation(name, text, size) {
    if (size > MAX_FILE_BYTES) {
      setFile({ name, size });
      setResult({ fileErrors: [`File is ${(size / 1048576).toFixed(1)} MB; limit is 5 MB.`], rows: [], validRows: [], invalidCount: 0 });
      return;
    }
    setFile({ name, size, text });
    setResult(validateCSV(text, type, { today: TODAY }));
  }

  function onFile(f) {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) {
      toast('Only .csv files are accepted.', 'warn');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => runValidation(f.name, String(reader.result), f.size);
    reader.readAsText(f);
  }

  function commit() {
    const rows = result.validRows;
    if (!rows.length) return;
    if (mode === 'all-or-nothing' && result.invalidCount) return toast('Fix all invalid rows or switch to “Import valid rows only”.', 'warn');
    const batchId = uid('batch');
    const domain = toDomain(type, rows, batchId);
    const batch = { id: batchId, type, filename: file.name, rows: rows.length, rejected: result.invalidCount, by: state.session.user.name, at: new Date().toISOString(), status: 'Active' };
    if (type === 'sales') {
      update('imports', (im) => ({ ...im, sales: [...im.sales.filter((r) => !domain.some((d) => d.date === r.date && d.dish === r.dish)), ...domain] }));
    } else if (type === 'waste') {
      update('wasteLogs', (x) => [...domain, ...x]);
    } else {
      // Keep the latest count per ingredient; snapshot prior stock for rollback.
      batch.snapshot = Object.fromEntries(domain.map((d) => [d.ingredient, state.stock[d.ingredient]]));
      const latest = {};
      for (const d of domain) if (!latest[d.ingredient] || d.date >= latest[d.ingredient].date) latest[d.ingredient] = d;
      update('stock', (s) => {
        const n = { ...s };
        for (const d of Object.values(latest)) n[d.ingredient] = { ...n[d.ingredient], onHand: d.onHand };
        return n;
      });
    }
    update('imports', (im) => ({ ...im, batches: [batch, ...im.batches] }));
    audit('Data imported', `${SCHEMAS[type].label}: ${rows.length} rows from ${file.name} (${result.invalidCount} rejected)`);
    toast(`Imported ${rows.length} rows. ${type === 'sales' ? 'Check Model Monitor to retrain on the new data.' : ''}`);
    setFile(null);
    setResult(null);
  }

  function rollback(b) {
    setConfirmId(null);
    if (b.type === 'sales') update('imports', (im) => ({ ...im, sales: im.sales.filter((r) => r.batchId !== b.id) }));
    if (b.type === 'waste') update('wasteLogs', (x) => x.filter((l) => l.batchId !== b.id));
    if (b.type === 'inventory' && b.snapshot) update('stock', (s) => ({ ...s, ...b.snapshot }));
    update('imports', (im) => ({ ...im, batches: im.batches.map((x) => (x.id === b.id ? { ...x, status: 'Rolled back' } : x)) }));
    audit('Import rolled back', `${b.filename} (${b.id})`);
    toast('Batch rolled back.');
  }

  const schema = SCHEMAS[type];
  const errorRows = result?.rows?.filter((r) => r.errors.length) || [];

  return (
    <div className="stack">
      <PageHeader
        title="Data Administration"
        subtitle="Upload, validate and manage historical meal sales, inventory counts and waste records. Files are checked against strict schemas before anything touches production data."
        features={['F4.1']}
        reqs={['R15/US15']}
        actions={<Badge tone="good">🔒 Administrator session</Badge>}
      />
      <div className="grid g4">
        <Kpi label="Operating records" value={fmt.n(records.length)} sub={`${fmt.n(HISTORY.records.length)} historical + imports`} />
        <Kpi label="Imported sales rows" value={fmt.n(state.imports.sales.length)} />
        <Kpi label="Waste log entries" value={fmt.n(state.wasteLogs.length)} />
        <Kpi label="Upload batches" value={state.imports.batches.length} sub={`${state.imports.batches.filter((b) => b.status === 'Active').length} active`} />
      </div>

      <Card title="1 · Choose dataset" actions={<button className="btn-sm" onClick={() => downloadText(`template-${type}.csv`, templateCSV(type))}>⬇ Download {type} template</button>}>
        <Segmented value={type} onChange={(v) => { setType(v); setFile(null); setResult(null); }} options={Object.entries(SCHEMAS).map(([k, s]) => [k, s.label])} />
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Column</th><th>Required</th></tr></thead>
            <tbody>{schema.columns.map((c) => <tr key={c.name}><td><code>{c.name}</code></td><td>{c.required ? <Badge tone="violet">required</Badge> : <Badge>optional</Badge>}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>Valid halls: {HALLS.map((h) => h.id).join(', ')} · Dish IDs D01–D{DISHES.length} · Ingredient IDs I01–I{INGREDIENTS.length} · Dates YYYY-MM-DD, not in the future · Max 5 MB / 20,000 rows.</p>
      </Card>

      <Card title="2 · Upload & validate">
        <div
          className="empty"
          style={{ borderColor: drag ? 'var(--brand)' : undefined, background: drag ? 'var(--brand-soft)' : undefined, cursor: 'pointer' }}
          onClick={() => inputRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
        >
          <div style={{ fontSize: 26 }}>📄</div>
          <div><strong>Drop a .csv file here</strong> or click to browse</div>
          <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn-sm" onClick={() => { const t = sampleFile(type, TODAY); runValidation(`sample-${type}.csv`, t, t.length); }}>Try a sample file (with deliberate errors)</button>
        </div>

        {result && (
          <div className="stack" style={{ marginTop: 16 }}>
            <div className="row">
              <strong>{file.name}</strong>
              <span className="muted small">{fmt.n(file.size / 1024, 1)} KB</span>
              {result.fileErrors.length ? <Badge tone="bad">Rejected</Badge> : (
                <>
                  <Badge tone="good">{result.validRows.length} valid</Badge>
                  <Badge tone={result.invalidCount ? 'bad' : 'neutral'}>{result.invalidCount} invalid</Badge>
                  {result.duplicates > 0 && <Badge tone="warn">{result.duplicates} duplicates</Badge>}
                  {result.unknownColumns?.length > 0 && <Badge tone="warn">Ignored columns: {result.unknownColumns.join(', ')}</Badge>}
                </>
              )}
            </div>
            {result.fileErrors.map((e) => <div key={e} className="alert alert-bad"><span>⛔</span><span>{e}</span></div>)}
            {errorRows.length > 0 && (
              <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Line</th><th>Problems</th><th>Row</th></tr></thead>
                  <tbody>{errorRows.slice(0, 100).map((r) => <tr key={r.line}><td className="num">{r.line}</td><td className="small" style={{ color: 'var(--bad)' }}>{r.errors.join(' · ')}</td><td className="small muted"><code>{Object.values(r.data).join(', ')}</code></td></tr>)}</tbody>
                </table>
              </div>
            )}
            {result.validRows.length > 0 && (
              <>
                <h3>Preview (first 8 valid rows)</h3>
                <div className="table-wrap">
                  <table>
                    <thead><tr>{Object.keys(result.validRows[0]).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                    <tbody>{result.validRows.slice(0, 8).map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
                  </table>
                </div>
                <div className="row">
                  <Segmented value={mode} onChange={setMode} options={[['valid-only', 'Import valid rows only'], ['all-or-nothing', 'All-or-nothing']]} />
                  <button className="btn-primary" onClick={commit} disabled={mode === 'all-or-nothing' && result.invalidCount > 0}>3 · Commit {result.validRows.length} rows</button>
                  <button className="btn-ghost" onClick={() => { setFile(null); setResult(null); }}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}
      </Card>

      <Card title="Upload history" actions={<button className="btn-sm" onClick={() => downloadText(`wasteless-history-${TODAY}.csv`, toCSV(records, ['date', 'hall', 'dish', 'category', 'predicted', 'prepared', 'consumed', 'leftover', 'wasteKg', 'source']))}>⬇ Export full dataset</button>}>
        {state.imports.batches.length === 0 ? <Empty>No uploads yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>File</th><th>Dataset</th><th className="num">Rows</th><th className="num">Rejected</th><th>Uploaded by</th><th>When</th><th>Status</th><th /></tr></thead>
              <tbody>
                {state.imports.batches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.filename}</td><td>{SCHEMAS[b.type].label}</td><td className="num">{b.rows}</td><td className="num">{b.rejected}</td><td>{b.by}</td><td className="small">{new Date(b.at).toLocaleString()}</td>
                    <td><Badge tone={b.status === 'Active' ? 'good' : 'neutral'}>{b.status}</Badge></td>
                    <td className="num">{b.status === 'Active' && (confirmId === b.id ? (
                      <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn-sm btn-danger" onClick={() => rollback(b)}>Confirm roll back</button>
                        <button className="btn-sm btn-ghost" onClick={() => setConfirmId(null)}>Keep</button>
                      </span>
                    ) : <button className="btn-sm btn-ghost btn-danger" onClick={() => setConfirmId(b.id)}>Roll back</button>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {state.imports.sales.length > 0 && <p className="small" style={{ marginTop: 10 }}>New sales data available. <a href="#model" onClick={() => go('model')}>Open Model Monitor to retrain →</a></p>}
      </Card>

      <Card title="Security audit log" subtitle="Sign-ins, imports, overrides, exports and other sensitive actions.">
        <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
            <tbody>{state.audit.slice(0, 120).map((a) => <tr key={a.id}><td className="small">{new Date(a.at).toLocaleString()}</td><td>{a.user}</td><td>{a.action}</td><td className="small muted">{a.detail}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function SettingsPage() {
  const { state, set, dispatch, refreshWeather, toast, audit } = useStore();
  const [loc, setLoc] = useState(state.location);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="stack">
      <PageHeader title="Settings" subtitle="Campus configuration used across the platform." />
      <div className="grid g2">
        <Card title="Campus location (weather feed)">
          <div className="form-grid">
            <Field label="Name"><input value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} /></Field>
            <Field label="Latitude"><input type="number" step="0.01" value={loc.lat} onChange={(e) => setLoc({ ...loc, lat: Number(e.target.value) })} /></Field>
            <Field label="Longitude"><input type="number" step="0.01" value={loc.lon} onChange={(e) => setLoc({ ...loc, lon: Number(e.target.value) })} /></Field>
          </div>
          <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => { set({ location: loc }); setTimeout(refreshWeather, 0); toast('Location saved. Refreshing weather…'); }}>Save & refresh weather</button>
        </Card>
        <Card title="Operating parameters">
          <div className="form-grid">
            <Field label="Prep service level" hint="Chance an item lasts through service"><input type="number" min={0.5} max={0.99} step={0.01} value={state.settings.serviceLevel} onChange={(e) => set({ settings: { ...state.settings, serviceLevel: Number(e.target.value) } })} /></Field>
            <Field label="Purchasing service level" hint="Drives safety stock"><input type="number" min={0.5} max={0.995} step={0.005} value={state.settings.purchaseServiceLevel} onChange={(e) => set({ settings: { ...state.settings, purchaseServiceLevel: Number(e.target.value) } })} /></Field>
            <Field label="Forecast horizon (days)"><input type="number" min={3} max={14} value={state.settings.horizonDays} onChange={(e) => set({ settings: { ...state.settings, horizonDays: Math.max(3, Math.min(14, Number(e.target.value))) } })} /></Field>
          </div>
        </Card>
        <Card title="Demo data">
          <p className="muted small" style={{ marginBottom: 10 }}>Clears logs, overrides, surveys, ratings, imports and stock changes, and restores the seeded 180-day history.</p>
          {confirmReset ? (
            <div className="row">
              <button className="btn-danger" onClick={() => { dispatch({ type: 'reset' }); audit('Demo data reset', ''); toast('Prototype data reset.'); setConfirmReset(false); }}>Yes, reset everything</button>
              <button className="btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          ) : <button className="btn-danger" onClick={() => setConfirmReset(true)}>Reset prototype data</button>}
        </Card>
      </div>
    </div>
  );
}

// How each requirement is fulfilled in this prototype.
const HOW = {
  R1: 'Per-hall ridge regression on weekday, academic phase, temperature and precipitation, with event offsets and recency-weighted dish shares. Validation MAPE is shown on the forecast page and checked against the 15% target in automated tests.',
  R2: 'Safety stock = z·σ·√lead time; order = demand over lead time + review − (on hand + on order), rounded to pack size. Purchase orders update on-order quantities.',
  R3: 'Prep = forecast + z·σ at a chosen service level, split into timed batches with cook-to-demand late batches; compared with traditional par.',
  R4: 'Dashboard with daily/weekly/monthly views, date range, hall, category and dish filters, a history table and CSV export.',
  R5: 'Live Open-Meteo feed (with offline fallback) feeds the temperature and precipitation coefficients; what-if scenarios show the effect.',
  R6: 'Editable calendar of phases (midterms, finals, breaks) learned as model features, and events applied as attendance multipliers.',
  R7: 'End-of-shift grid by dish category: leftover portions, discarded kg and reason; validated and fed into analytics.',
  R8: 'Predicted vs. actual bars with a waste line on one chart, plus waste-by-category and leftover-rate trend.',
  R9: 'Daily rolling-MAPE monitoring; retrains when error passes the limit, worsens vs. validation, or on schedule. Full retrain log.',
  R10: 'Savings vs. the pre-go-live waste-per-portion baseline; cumulative $, $/kg, ROI and payback.',
  R11: "Alerts when on-hand stock < today's prep requirement (critical) or < requirement + safety stock (warning). Updates live.",
  R12: 'Popularity index vs. waste-rate matrix with quadrant classification, actions, and student ratings.',
  R13: 'Dish- or hall-level percent or absolute overrides with a required reason, attribution and deactivation.',
  R14: 'MT CO2e avoided with category factors and disposal emissions; ESG target tracking; PDF and CSV exports.',
  R15: 'Admin-only portal: CSV schema validation (types, enums, referential checks, duplicates, size limits), preview, commit, rollback, audit log.',
  R16: 'Live menu per hall with remaining portions updated each second from the service clock.',
  R17: 'Favorite dishes lift those dishes’ demand share in the forecast.',
  R18: 'Hourly occupancy % of seating per hall from forecast diners × arrival curve × dwell time.',
  R19: '“Running low” and “Sold out” badges at ≤ 20% remaining, plus opt-in notifications.',
  R20: 'Diet filters (must have all) and allergen exclusions (must have none).',
  R21: 'Planned attendance per day, hall and meal feeds the student-signal factor in forecasts.',
  R22: 'Public dashboard of kg saved, meals saved, CO2e, milestones and weekly trend.',
  R23: 'Star rating, quick tags and comments; shown to kitchen staff in the Menu Analyzer.',
};

export function TraceabilityPage() {
  return (
    <div className="stack">
      <PageHeader
        title="Requirements Traceability Matrix"
        subtitle="Every user requirement (R1–R23) and user story mapped to the prototype feature that implements it. Click a feature to open it."
        features={['RTM']}
      />
      <Card title="2D matrix">
        <div className="table-wrap">
          <table className="rtm">
            <thead>
              <tr><th>Requirement / story</th>{FEATURES.map((f) => <th key={f.id}><a href={`#${f.page}`}>{f.id}</a></th>)}</tr>
            </thead>
            <tbody>
              {REQUIREMENTS.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.id}</strong> / {r.us}: {r.name}</td>
                  {FEATURES.map((f) => <td key={f.id} className={r.features.includes(f.id) ? 'hit' : ''}>{r.features.includes(f.id) ? '✓' : ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Feature index">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Feature</th><th>Name</th><th>Epic</th><th>Requirements</th><th /></tr></thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f.id}>
                  <td><Badge tone="good">{f.id}</Badge></td>
                  <td>{f.name}</td>
                  <td className="small muted">{f.epic}. {EPICS[f.epic]}</td>
                  <td>{REQUIREMENTS.filter((r) => r.features.includes(f.id)).map((r) => r.id).join(', ')}</td>
                  <td><a href={`#${f.page}`}>Open →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Verification specification" subtitle="Each verification target is covered by an automated test in tests/requirements.test.js (run with npm test).">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Req</th><th>Story</th><th>Requirement</th><th>Feature</th><th>Verification target</th><th>How the prototype fulfills it</th></tr></thead>
            <tbody>
              {REQUIREMENTS.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.id}</strong></td><td>{r.us}</td>
                  <td className="small"><strong>{r.name}:</strong> {r.desc}</td>
                  <td>{r.features.map((f) => <a key={f} href={`#${FEATURES.find((x) => x.id === f).page}`} style={{ marginRight: 4 }}>{f}</a>)}</td>
                  <td className="small">{r.verify}</td>
                  <td className="small muted">{HOW[r.id]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
