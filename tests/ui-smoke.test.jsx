// @vitest-environment jsdom
// Renders every screen for every role and fails on any runtime error.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from '../src/store.jsx';
import App, { ROUTES } from '../src/App.jsx';
import { canAccess } from '../src/engine/auth.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  if (!globalThis.crypto?.subtle) globalThis.crypto = require('node:crypto').webcrypto;
});

const USERS = { student: null, kitchen: 'Jordan Ellis', manager: 'Dr. Alicia Moore', admin: 'Sam Okafor' };

describe('UI smoke: every route renders for every role', () => {
  for (const role of Object.keys(USERS)) {
    it(`role: ${role}`, async () => {
      localStorage.clear();
      if (role !== 'student') {
        localStorage.setItem('wasteless:v1', JSON.stringify({ session: { user: { username: role, name: USERS[role], role }, lastActive: Date.now() } }));
      }
      const errors = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.map(String).join(' ')));
      const el = document.createElement('div');
      document.body.appendChild(el);
      const root = createRoot(el);
      await act(async () => root.render(<StoreProvider><App /></StoreProvider>));
      const allowed = ROUTES.filter((r) => canAccess(role, r.access));
      for (const r of allowed) {
        await act(async () => { window.location.hash = `/${r.id}`; window.dispatchEvent(new HashChangeEvent('hashchange')); });
        expect(el.querySelector('h1')?.textContent, `${role} → ${r.id}`).toBeTruthy();
      }
      // A blocked route shows the access notice instead of the page.
      if (role === 'student') {
        await act(async () => { window.location.hash = '/admin'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
        expect(el.textContent).toMatch(/requires an administrator account/);
      }
      await act(async () => root.unmount());
      spy.mockRestore();
      const real = errors.filter((e) => !/width\(0\) and height\(0\)|The width\(|ResponsiveContainer/.test(e));
      expect(real, real.join('\n')).toEqual([]);
    }, 60000);
  }
});
