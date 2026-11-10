import { useEffect, useRef, useState } from 'react';
import { useStore, useClock, fmtHour } from './store.jsx';
import { ROLES, canAccess } from './engine/auth.js';
import { fmtDate } from './engine/util.js';
import { go } from './nav.js';
import { Login } from './pages/Login.jsx';
import { ForecastPage, CalendarPage, ModelPage, OverridesPage } from './pages/Forecasting.jsx';
import { PrepPage, PurchasingPage, InventoryPage, AnalyzerPage } from './pages/Kitchen.jsx';
import { WasteLogPage, DashboardPage, SavingsPage, SustainabilityPage } from './pages/Analytics.jsx';
import { AdminPage, SettingsPage, TraceabilityPage } from './pages/Admin.jsx';
import { MenuPage, CrowdPage, PlanPage, RatePage, ImpactPage, SupplyWatcher } from './pages/Student.jsx';

export const ROUTES = [
  { id: 'menu', label: "Today's Menu", group: 'Student Dining Portal', fid: 'F5.1–5.2', access: 'public', C: MenuPage },
  { id: 'crowd', label: 'Crowd Meter', group: 'Student Dining Portal', fid: 'F5.3', access: 'public', C: CrowdPage },
  { id: 'plan', label: 'Plan & Preferences', group: 'Student Dining Portal', fid: 'F5.4', access: 'public', C: PlanPage },
  { id: 'rate', label: 'Rate a Meal', group: 'Student Dining Portal', fid: 'F5.5', access: 'public', C: RatePage },
  { id: 'impact', label: 'Campus Impact', group: 'Student Dining Portal', fid: 'F5.6', access: 'public', C: ImpactPage },

  { id: 'forecast', label: 'Demand Forecast', group: 'Forecasting Engine', fid: 'F1.1', access: 'staff', C: ForecastPage },
  { id: 'calendar', label: 'Weather & Calendar', group: 'Forecasting Engine', fid: 'F1.2', access: 'staff', C: CalendarPage },
  { id: 'model', label: 'Model Monitor', group: 'Forecasting Engine', fid: 'F1.3', access: 'manager', C: ModelPage },
  { id: 'overrides', label: 'Manual Overrides', group: 'Forecasting Engine', fid: 'F1.4', access: 'manager', C: OverridesPage },

  { id: 'prep', label: 'Prep Guide', group: 'Kitchen & Inventory', fid: 'F2.1', access: 'staff', C: PrepPage },
  { id: 'purchasing', label: 'Purchasing', group: 'Kitchen & Inventory', fid: 'F2.2', access: 'staff', C: PurchasingPage },
  { id: 'inventory', label: 'Stock Alerts', group: 'Kitchen & Inventory', fid: 'F2.3', access: 'staff', C: InventoryPage, badge: 'alerts' },
  { id: 'analyzer', label: 'Menu Analyzer', group: 'Kitchen & Inventory', fid: 'F2.4', access: 'staff', C: AnalyzerPage },

  { id: 'waste-log', label: 'Waste Log', group: 'Waste & Analytics', fid: 'F3.1', access: 'staff', C: WasteLogPage },
  { id: 'dashboard', label: 'Operations Dashboard', group: 'Waste & Analytics', fid: 'F3.2', access: 'staff', C: DashboardPage },
  { id: 'savings', label: 'Savings & ROI', group: 'Waste & Analytics', fid: 'F3.3', access: 'manager', C: SavingsPage },
  { id: 'sustainability', label: 'Sustainability / ESG', group: 'Waste & Analytics', fid: 'F3.4', access: 'manager', C: SustainabilityPage },

  { id: 'admin', label: 'Data Administration', group: 'Administration', fid: 'F4.1', access: 'admin', C: AdminPage },
  { id: 'traceability', label: 'RTM Traceability', group: 'Administration', fid: 'RTM', access: 'staff', C: TraceabilityPage },
  { id: 'app-config', label: 'Settings', group: 'Administration', fid: '', access: 'manager', C: SettingsPage },
];

function useHashRoute() {
  const get = () => window.location.hash.replace(/^#\/?/, '') || '';
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const f = () => setRoute(get());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return route;
}


export default function App() {
  const { state, set, toasts, alerts, TODAY, audit } = useStore();
  const route = useHashRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const role = state.session?.user?.role || 'student';
  const allowed = ROUTES.filter((r) => canAccess(role, r.access));
  const current = allowed.find((r) => r.id === route) || allowed.find((r) => r.id === ROLES[role].home);
  const blocked = route && !allowed.find((r) => r.id === route) && ROUTES.find((r) => r.id === route);
  const openAlerts = alerts.filter((a) => !state.ackAlerts.includes(a.id)).length;

  useEffect(() => {
    setNavOpen(false);
  }, [route]);

  if (showLogin && !state.session) return <Login onDone={() => setShowLogin(false)} />;

  const groups = [...new Set(allowed.map((r) => r.group))];
  const Page = current.C;

  return (
    <div className="app">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <div className="brand-name">WasteLess</div>
            <div className="brand-sub">Team HerdWise · Campus Dining</div>
          </div>
        </div>
        {groups.map((g) => (
          <div className="nav-group" key={g}>
            <div className="nav-group-title">{g}</div>
            {allowed.filter((r) => r.group === g).map((r) => (
              <a key={r.id} href={`#${r.id}`} className={`nav-link ${current.id === r.id ? 'active' : ''}`}>
                {r.label}
                {r.badge === 'alerts' && openAlerts > 0 ? <span className="dot">{openAlerts}</span> : <span className="fid">{r.fid}</span>}
              </a>
            ))}
          </div>
        ))}
      </aside>

      <div className="main">
        <div className="topbar">
          <button className="menu-toggle btn-sm" onClick={() => setNavOpen((o) => !o)} aria-label="Toggle navigation">☰</button>
          <span className="muted small">{fmtDate(TODAY, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
          <ServiceClock />
          <div className="spacer" />
          <Notifications />
          {state.session ? (
            <>
              <span className="small">
                <strong>{state.session.user.name}</strong> <span className="muted">· {ROLES[role].label}</span>
              </span>
              <button
                className="btn-sm"
                onClick={() => {
                  audit('Signed out', state.session.user.username);
                  set({ session: null });
                  go('menu');
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <button className="btn-sm btn-primary" onClick={() => setShowLogin(true)}>Staff sign in</button>
          )}
        </div>
        <main className="content">
          {blocked && (
            <div className="alert alert-warn" style={{ marginBottom: 16 }}>
              <span>🔒</span>
              <span>“{blocked.label}” requires {blocked.access === 'admin' ? 'an administrator' : blocked.access === 'manager' ? 'a dining manager' : 'a staff'} account. Showing your home page instead.</span>
            </div>
          )}
          <Page />
        </main>
      </div>

      <SupplyWatcher />
      <StockAlertWatcher />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

function ServiceClock() {
  const clock = useClock();
  return (
    <span className="row small no-print" style={{ gap: 6 }} title="Live service clock. Fast-forward to demo real-time menu updates.">
      <span className="badge badge-good">● Live {fmtHour(clock.hour)}</span>
      <button className="btn-sm btn-ghost" onClick={() => clock.setSpeed(clock.speed ? 0 : 10)} title="Fast-forward service time (10 min per second)">
        {clock.speed ? '⏸ Pause' : '⏩ Simulate service'}
      </button>
      {clock.offset !== 0 && <button className="btn-sm btn-ghost" onClick={clock.reset}>↺ Now</button>}
    </span>
  );
}

function Notifications() {
  const { state, set } = useStore();
  const [open, setOpen] = useState(false);
  const unread = state.notifications.filter((n) => !n.read).length;
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn-sm btn-ghost" onClick={() => { setOpen((o) => !o); set({ notifications: state.notifications.map((n) => ({ ...n, read: true })) }); }} aria-label="Notifications">
        🔔{unread > 0 && <span className="badge badge-bad">{unread}</span>}
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: 36, width: 320, zIndex: 20, maxHeight: 360, overflowY: 'auto' }}>
          <h2 style={{ marginBottom: 8 }}>Notifications</h2>
          {state.notifications.length === 0 ? (
            <p className="muted small">No notifications yet. Tap “Notify me” on a dish to get low-supply alerts.</p>
          ) : (
            state.notifications.slice(0, 20).map((n) => (
              <div key={n.id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                {n.msg}
                <div className="muted" style={{ fontSize: 11 }}>{new Date(n.at).toLocaleTimeString()}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Real-time staff notification when a new critical shortage appears (R11).
function StockAlertWatcher() {
  const { alerts, state, toast } = useStore();
  const seen = useRef(null);
  useEffect(() => {
    const ids = new Set(alerts.filter((a) => a.level === 'critical').map((a) => a.id));
    if (seen.current && state.session) {
      for (const a of alerts) if (a.level === 'critical' && !seen.current.has(a.id)) toast(`⛔ Shortage: ${a.name} covers only ${a.coverage}% of today's prep.`, 'bad');
    }
    seen.current = ids;
  }, [alerts, state.session, toast]);
  return null;
}
