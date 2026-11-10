import { useState } from 'react';

export function PageHeader({ title, subtitle, features = [], reqs = [], actions }) {
  return (
    <header className="page-header">
      <div>
        <div className="trace-chips">
          {features.map((f) => (
            <span key={f} className="chip chip-feature" title="Prototype feature (RTM)">{f}</span>
          ))}
          {reqs.map((r) => (
            <span key={r} className="chip chip-req" title="User requirement / story (RTM)">{r}</span>
          ))}
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children, title }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return (
          <button key={v} type="button" className={value === v ? 'active' : ''} onClick={() => onChange(v)}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, children, hint, error }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Stars({ value, onChange, size = 22 }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          style={{ fontSize: size }}
          className={(hover || value) >= n ? 'on' : ''}
          onMouseEnter={() => onChange && setHover(n)}
          onClick={() => onChange && onChange(n)}
          disabled={!onChange}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function Meter({ pct, tone }) {
  return (
    <div className="meter" aria-valuenow={pct} role="meter" aria-valuemin={0} aria-valuemax={100}>
      <div className={`meter-fill tone-${tone || 'ok'}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

export const fmt = {
  n: (x, d = 0) => (x == null ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })),
  usd: (x) => (x == null ? '—' : Number(x).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })),
  usd2: (x) => (x == null ? '—' : Number(x).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })),
  pct: (x, d = 1) => (x == null ? '—' : `${Number(x).toFixed(d)}%`),
  signedPct: (f) => `${f >= 1 ? '+' : ''}${((f - 1) * 100).toFixed(1)}%`,
};

export const CHART = {
  predicted: '#7c6cf2',
  actual: '#1f9d74',
  waste: '#e0703a',
  prepared: '#94a3b8',
  grid: 'var(--grid)',
  palette: ['#1f9d74', '#7c6cf2', '#e0703a', '#2f80c8', '#d4a72c', '#c2457a', '#5b8a3c'],
};
