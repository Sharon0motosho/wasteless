import { useState } from 'react';
import { useStore } from '../store.jsx';
import { authenticate, DEMO_ACCOUNTS, ROLES } from '../engine/auth.js';
import { Field } from '../components/ui.jsx';
import { go } from '../nav.js';

export function Login({ onDone }) {
  const { state, set, users, audit } = useStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e, u = username, p = password) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    const res = await authenticate(users, u.trim(), p, state.attempts);
    setBusy(false);
    if (res.attempts) set({ attempts: res.attempts });
    if (!res.ok) {
      setError(res.error);
      audit('Failed sign-in', u.trim());
      return;
    }
    set({ session: { user: res.user, lastActive: Date.now() }, attempts: res.attempts });
    audit('Signed in', `${res.user.username} (${res.user.role})`);
    go(ROLES[res.user.role].home);
    onDone();
  }

  return (
    <div className="login-wrap">
      <div className="login card">
        <div className="brand" style={{ padding: '0 0 14px' }}>
          <div className="brand-mark">W</div>
          <div>
            <div className="brand-name" style={{ color: 'var(--ink)' }}>WasteLess</div>
            <div className="muted small">Staff sign in · role-based access</div>
          </div>
        </div>
        <form onSubmit={submit} className="stack">
          <Field label="Username">
            <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </Field>
          <Field label="Password" error={error}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <div className="row">
            <button className="btn-primary" disabled={busy || !users.length}>{busy ? 'Checking…' : 'Sign in'}</button>
            <button type="button" className="btn-ghost" onClick={onDone}>Back to student portal</button>
          </div>
        </form>
        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0 12px' }} />
        <p className="muted small" style={{ marginBottom: 8 }}>Prototype demo accounts (click to sign in):</p>
        <div className="stack demo-accts" style={{ '--gap': '6px' }}>
          {DEMO_ACCOUNTS.map((a) => (
            <button key={a.username} type="button" onClick={() => submit(null, a.username, a.password)} disabled={!users.length}>
              <span><strong>{ROLES[a.role].label}</strong> · {a.username}</span>
              <span className="muted small">{a.password}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
