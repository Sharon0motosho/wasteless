// Role-based access control for the prototype. Passwords are stored as salted
// SHA-256 digests (never plain text); sessions expire after inactivity and
// repeated failures trigger a temporary lockout.
// NOTE: a production deployment must enforce these checks server-side.

export const ROLES = {
  student: { label: 'Student', home: 'menu' },
  kitchen: { label: 'Kitchen Staff', home: 'prep' },
  manager: { label: 'Dining Manager', home: 'forecast' },
  admin: { label: 'Administrator', home: 'admin' },
};

// Which roles can open each page.
export const ACCESS = {
  staff: ['kitchen', 'manager', 'admin'],
  manager: ['manager', 'admin'],
  admin: ['admin'],
  public: ['student', 'kitchen', 'manager', 'admin'],
};

export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 60 * 1000;

const SALT = 'wasteless-herdwise::';

export async function hashPassword(username, password) {
  const data = new TextEncoder().encode(SALT + username.toLowerCase() + '::' + password);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Demo accounts (hashes of kitchen123 / manager123 / admin123), computed at startup.
export const DEMO_ACCOUNTS = [
  { username: 'kitchen', name: 'Jordan Ellis', role: 'kitchen', password: 'kitchen123' },
  { username: 'manager', name: 'Dr. Alicia Moore', role: 'manager', password: 'manager123' },
  { username: 'admin', name: 'Sam Okafor', role: 'admin', password: 'admin123' },
];

export async function buildUserTable() {
  return Promise.all(
    DEMO_ACCOUNTS.map(async (a) => ({ username: a.username, name: a.name, role: a.role, hash: await hashPassword(a.username, a.password) })),
  );
}

export async function authenticate(users, username, password, attempts = {}) {
  const key = username.toLowerCase();
  const a = attempts[key];
  if (a && a.lockedUntil && Date.now() < a.lockedUntil) {
    return { ok: false, error: `Account locked. Try again in ${Math.ceil((a.lockedUntil - Date.now()) / 1000)}s.` };
  }
  const user = users.find((u) => u.username === key);
  const hash = await hashPassword(key, password);
  if (!user || user.hash !== hash) {
    const count = (a?.count || 0) + 1;
    const lockedUntil = count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : null;
    return { ok: false, error: lockedUntil ? 'Too many attempts. Account locked for 60 seconds.' : 'Invalid username or password.', attempts: { ...attempts, [key]: { count: lockedUntil ? 0 : count, lockedUntil } } };
  }
  return { ok: true, user: { username: user.username, name: user.name, role: user.role }, attempts: { ...attempts, [key]: { count: 0 } } };
}

export function canAccess(role, level) {
  return (ACCESS[level] || []).includes(role);
}
