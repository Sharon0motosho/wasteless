# WasteLess: Intelligent Campus Food Waste Reduction System

**Team HerdWise · Senior Project Phase 1 prototype**

An interactive web prototype that implements all 19 features (F1.1–F5.6) of the WasteLess Requirements Traceability Matrix and fulfills all 23 user requirements (R1–R23 / US1–US23).

## Run it

```bash
npm install
npm run dev      # open the printed URL (http://localhost:5173)
npm test         # 46 automated checks: the RTM verification targets plus a UI smoke test
npm run build    # production build in dist/
npm run build:link  # one self-contained page (dist-artifact/wasteless.html) for the shareable link
```

**Live prototype:** https://sharon0motosho.github.io/wasteless/

Requires Node 18+. The student portal opens without signing in. Click **Staff sign in** to use a demo account:

| Role | Username / password | Can access |
|---|---|---|
| Kitchen Staff | `kitchen` / `kitchen123` | Forecast, prep, purchasing, stock alerts, analyzer, waste log, dashboard |
| Dining Manager | `manager` / `manager123` | All of the above + model monitor, overrides, savings, ESG, settings |
| Administrator | `admin` / `admin123` | Everything, including Data Administration (F4.1) |

**Demo tip:** click **⏩ Simulate service** in the top bar to fast-forward the service clock (10 min per second). Menu supply drains in real time, and dishes switch to "Running low" or "Sold out". Students who tapped "Notify me" get a notification.

## Where each feature lives

| Epic | Feature | Screen (`#/route`) | Engine |
|---|---|---|---|
| 1 · ML Forecasting | F1.1 Multi-variable forecaster | Demand Forecast (`forecast`) | `src/engine/forecast.js`, `pipeline.js` |
| | F1.2 Weather & calendar pipeline | Weather & Calendar (`calendar`) | `src/engine/context.js` (live Open-Meteo feed) |
| | F1.3 Retraining & variance engine | Model Monitor (`model`) | `src/engine/retrain.js` |
| | F1.4 Manual overrides | Manual Overrides (`overrides`) | `src/engine/pipeline.js` |
| 2 · Kitchen & Inventory | F2.1 Prep guide & scheduler | Prep Guide (`prep`) | `src/engine/prep.js` |
| | F2.2 Purchasing & safety stock | Purchasing (`purchasing`) | `src/engine/inventory.js` |
| | F2.3 Low stock alerts | Stock Alerts (`inventory`) | `src/engine/inventory.js` |
| | F2.4 Popularity & waste analyzer | Menu Analyzer (`analyzer`) | `src/engine/analytics.js` |
| 3 · Waste Analytics | F3.1 End-of-shift waste log | Waste Log (`waste-log`) | `analytics.js#mergeLogs` |
| | F3.2 Operations dashboard | Operations Dashboard (`dashboard`) | `analytics.js#aggregate` |
| | F3.3 Savings & ROI | Savings & ROI (`savings`) | `analytics.js#savingsAnalysis` |
| | F3.4 Carbon & ESG reports | Sustainability / ESG (`sustainability`) | PDF via jsPDF, CSV export |
| 4 · Data Admin | F4.1 Ingestion & schema validator | Data Administration (`admin`) | `src/engine/csv.js`, `auth.js` |
| 5 · Student Portal | F5.1 Live menu & dietary filters | Today's Menu (`menu`) | `src/engine/student.js` |
| | F5.2 Low supply indicators | Today's Menu (`menu`) + 🔔 | `student.js#supplyStatus` |
| | F5.3 Crowd meter | Crowd Meter (`crowd`) | `student.js#crowdProfile` |
| | F5.4 Attendance & preferences | Plan & Preferences (`plan`) | `pipeline.js#studentSignal` |
| | F5.5 Rating & feedback | Rate a Meal (`rate`), shown to staff in the Analyzer | |
| | F5.6 Campus impact dashboard | Campus Impact (`impact`) | |

The in-app **RTM Traceability** page (`#/traceability`) reproduces the 2D matrix and links every requirement to its screen. Each page header also shows chips for its feature and requirement IDs.

## How the key pieces work

- **Forecasting (R1, R5, R6).** Each hall has a log-linear ridge regression on day of week, academic phase, temperature and precipitation. Coefficients are shrunk toward calendar priors, so a phase the model hasn't seen yet (such as the first finals week) still gets a sensible estimate. Campus events apply as known attendance multipliers. Dish demand = hall volume × recency-weighted dish share × calibration. On sold-out days, recorded consumption understates demand, so it is adjusted upward before training to avoid a feedback loop that keeps lowering forecasts. Validation MAPE is about 8% (target < 15%).
- **Retraining (R9).** Every day, the engine compares predictions with actual consumption over a rolling 14-day window. It retrains when rolling MAPE exceeds 10%, when error worsens by 3 or more points against the validation baseline, or every 28 days. The policy is editable. The simulated history includes a drift-triggered retrain after the fall semester starts.
- **Prep (R3).** Prep = forecast + z·σ for a chosen service level, where σ is the item's out-of-sample forecast error. Each item is split into timed batches, with cook-to-demand late batches. A traditional par level (14-day average × 1.25) is shown for comparison. Par ignores weekday patterns, so it under-preps busy weekdays and over-preps weekends.
- **Purchasing (R2).** Safety stock = z·σ_daily·√lead time. Order = demand over lead time + 1 review day + safety stock − (on hand + on order), rounded up to the supplier pack size.
- **Savings and carbon (R10, R14).** The baseline is kg of waste per portion served under traditional prep, before go-live. Avoided kg are priced at portion food cost. CO2e = avoided kg × (category production factor + 0.58 kg/kg landfill disposal).
- **Student signals (R17, R21).** Survey responses are compared with the number expected at a 1.5% panel response rate, with elasticity 0.25 and a ±10% cap. Favorite votes shift share between dishes within a hall (±5% cap), so enthusiasm alone doesn't inflate the hall total.
- **Security (R15).** Role-based access, salted SHA-256 password hashes, 30-minute inactivity timeout, lockout after 5 failed attempts, a 5 MB / 20,000-row upload limit, strict schema and referential validation, batch rollback, CSV formula-injection protection, and an audit log.

## Data and prototype limitations

- History is **synthetic and deterministic**: 180 days ending yesterday, regenerated relative to today's date. The first 90 days use traditional par-level prep. The last 90 use WasteLess. App changes (logs, overrides, surveys, imports, stock) are saved in the browser's `localStorage`. Use **Settings → Reset prototype data** to clear them.
- Live weather comes from Open-Meteo, which needs no API key. If the browser is offline, the app falls back to a seasonal weather model automatically.
- Authentication runs in the browser for demonstration only. A production deployment must enforce authentication, authorization and data validation on a server, and use a real database.
- If the project lives in a OneDrive-synced folder, file locks can interrupt tests. `npm test` uses `--pool=threads` to avoid this.
