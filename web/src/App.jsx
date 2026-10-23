import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { AppCtx, Icon, Loading } from './ui.jsx';
import { ROLE_LABEL } from './format.js';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Orders from './pages/Orders.jsx';
import Menu from './pages/Menu.jsx';
import Inventory from './pages/Inventory.jsx';
import Analytics from './pages/Analytics.jsx';
import Branches from './pages/Branches.jsx';
import Team from './pages/Team.jsx';
import Account from './pages/Account.jsx';
import { playAlarm } from './alarm.js';

const PAGES = [
  { id: 'home', label: 'Today', icon: 'home', roles: ['owner', 'manager', 'cashier'], C: Home },
  { id: 'orders', label: 'Orders', icon: 'orders', roles: ['owner', 'manager', 'cashier', 'kitchen'], C: Orders },
  { id: 'menu', label: 'Menu', icon: 'menu', roles: ['owner', 'manager'], C: Menu },
  { id: 'inventory', label: 'Inventory', icon: 'stock', roles: ['owner', 'manager', 'cashier'], C: Inventory },
  { id: 'analytics', label: 'Sales analytics', icon: 'chart', roles: ['owner', 'manager'], C: Analytics },
  { id: 'branches', label: 'Branches', icon: 'branch', roles: ['owner', 'manager'], C: Branches },
  { id: 'team', label: 'Team', icon: 'team', roles: ['owner'], C: Team },
  { id: 'account', label: 'My account', icon: 'key', roles: ['owner', 'manager', 'cashier', 'kitchen'], C: Account, hidden: true },
];

const SCOPE_KEY = 'teecas_admin_branch';
const SOUND_KEY = 'teecas_admin_sound'; // per computer: one till can be muted while another rings
const REPEAT_MS = 30000; // repeat the alarm while orders wait in Incoming
const readHash = () => (window.location.hash.replace(/^#\/?/, '').split('?')[0] || '');

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(Boolean(getToken()));
  const [branches, setBranches] = useState([]);
  const [scope, setScopeState] = useState(() => {
    try {
      return localStorage.getItem(SCOPE_KEY) || 'all';
    } catch {
      return 'all';
    }
  });
  const [page, setPage] = useState(readHash());
  const [navOpen, setNavOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [live, setLive] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [sound, setSoundState] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const setSound = useCallback((on) => {
    setSoundState(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, []);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const lastRing = useRef(0);
  const ring = useCallback(() => {
    lastRing.current = Date.now();
    playAlarm();
  }, []);

  const notify = useCallback((text, kind = '', onClick) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, text, kind, onClick }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'new' ? 9000 : 4500);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  // Restore the session.
  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    const h = () => setUser(null);
    window.addEventListener('teecas:signed-out', h);
    const hc = () => {
      setPage(readHash());
      setNavOpen(false);
    };
    window.addEventListener('hashchange', hc);
    return () => {
      window.removeEventListener('teecas:signed-out', h);
      window.removeEventListener('hashchange', hc);
    };
  }, []);

  const loadBranches = useCallback(() => api('/branches').then((d) => setBranches(d.branches)).catch(() => {}), []);
  useEffect(() => {
    if (user) loadBranches();
  }, [user, loadBranches]);

  // The branch every screen is looking at. Staff other than owners are fixed to theirs.
  const branchId = user && user.role !== 'owner' ? user.branchId : scope;
  const setScope = (v) => {
    setScopeState(v);
    try {
      localStorage.setItem(SCOPE_KEY, v);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    if (user?.role === 'owner' && scope !== 'all' && branches.length && !branches.some((b) => b._id === scope)) setScope('all');
  }, [branches, scope, user]);

  const refreshNewCount = useCallback(() => {
    api('/orders', { query: { status: 'placed', limit: 200, branchId: branchId === 'all' ? undefined : branchId } })
      .then((d) => setNewCount(d.orders.length))
      .catch(() => {});
  }, [branchId]);
  useEffect(() => {
    if (user) refreshNewCount();
  }, [user, refreshNewCount]);

  // Live order feed.
  useEffect(() => {
    if (!user) return;
    const es = new EventSource(`/api/events?token=${encodeURIComponent(getToken())}`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    const fwd = (type) => (e) => {
      const order = JSON.parse(e.data);
      window.dispatchEvent(new CustomEvent(`teecas:${type}`, { detail: order }));
      refreshNewCount();
      if (type === 'order.created') {
        if (soundRef.current) ring();
        notify(`New order #${order.number}${order.branchName ? ` · ${order.branchName}` : ''} · ${order.customer.name}`, 'new', () => {
          window.location.hash = '#/orders';
        });
      }
    };
    es.addEventListener('order.created', fwd('order.created'));
    es.addEventListener('order.updated', fwd('order.updated'));
    es.addEventListener('order.deleted', fwd('order.deleted'));
    return () => {
      es.close();
      setLive(false);
    };
  }, [user, notify, refreshNewCount]);

  // Keep ringing every 30 seconds while any order is waiting in Incoming, until someone accepts
  // (or cancels) it. Checked every few seconds so it stops as soon as the last one is taken.
  const waitingRef = useRef(0);
  waitingRef.current = newCount;
  useEffect(() => {
    if (!user || user.role === 'kitchen') return;
    const t = setInterval(() => {
      if (soundRef.current && waitingRef.current > 0 && Date.now() - lastRing.current >= REPEAT_MS) ring();
    }, 3000);
    return () => clearInterval(t);
  }, [user, ring]);

  // The browser tab shows how many orders are waiting, so it's visible from another tab too.
  useEffect(() => {
    document.title = user && newCount > 0 ? `(${newCount}) Waiting · Teecas Admin` : 'Teecas Admin';
  }, [user, newCount]);

  const allowed = useMemo(() => (user ? PAGES.filter((p) => p.roles.includes(user.role)) : []), [user]);
  const current = allowed.find((p) => p.id === page) || allowed[0];

  const ctx = useMemo(
    () => ({ user, setUser, branches, reloadBranches: loadBranches, branchId, setScope, notify, signOut, sound, setSound, ring }),
    [user, branches, loadBranches, branchId, notify, signOut, sound, setSound, ring],
  );

  if (booting) return <Loading />;
  if (!user) {
    return (
      <AppCtx.Provider value={ctx}>
        <Login onSignedIn={(u) => setUser(u)} />
        <Toasts toasts={toasts} />
      </AppCtx.Provider>
    );
  }

  const Page = current.C;
  const branchName = branches.find((b) => b._id === user.branchId)?.name;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <aside className={`side ${navOpen ? 'open' : ''}`}>
          <div className="brand">
            Teecas <span>Admin</span>
            <small>Amala Express Bukka</small>
          </div>
          <nav className="nav" aria-label="Main">
            {allowed
              .filter((p) => !p.hidden)
              .map((p) => (
                <a key={p.id} href={`#/${p.id}`} className={current.id === p.id ? 'on' : ''} aria-current={current.id === p.id ? 'page' : undefined}>
                  <Icon name={p.icon} />
                  {p.label}
                  {p.id === 'orders' && newCount > 0 && <span className="count">{newCount}</span>}
                </a>
              ))}
          </nav>
          <div className="side-foot">
            <div className="who">
              <b>{user.name}</b>
              <span className="muted small">
                {ROLE_LABEL[user.role]}
                {branchName ? ` · ${branchName}` : ''}
              </span>
            </div>
            <a className="btn ghost sm" href="#/account">
              <Icon name="key" /> My account
            </a>
            <button className="btn ghost sm" onClick={signOut}>
              <Icon name="out" /> Sign out
            </button>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="btn icon menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">
              <Icon name="bars" />
            </button>
            <h1>{current.label}</h1>
            <div className="end">
              <span className={`live ${live ? 'on' : ''}`} title={live ? 'New orders appear instantly' : 'Reconnecting…'}>
                <i />
                <span>{live ? 'Live' : 'Offline'}</span>
              </span>
              <a
                href="#/orders"
                className={`bell ${newCount > 0 ? 'ringing' : ''}`}
                aria-label={`${newCount ? `${newCount} incoming ${newCount === 1 ? 'order' : 'orders'}` : 'No incoming orders'}${sound ? '' : ', sound off'}`}
                title={`${newCount ? `${newCount} waiting in Incoming` : 'No orders waiting'}${sound ? '' : ' · Sound is off (turn it on in My account)'}`}
              >
                <Icon name={sound ? 'bell' : 'bellOff'} />
                {newCount > 0 && <span className="bell-count">{newCount > 99 ? '99+' : newCount}</span>}
              </a>
              {user.role === 'owner' ? (
                <select className="input" style={{ width: 'auto' }} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Branch">
                  <option value="all">All branches</option>
                  {branches.map((b) => (
                    <option key={b._id} value={b._id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="chip">{branchName}</span>
              )}
            </div>
          </header>
          <main className="content">
            <Page key={current.id} />
          </main>
        </div>
        {navOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setNavOpen(false)} />}
      </div>
      <Toasts toasts={toasts} />
    </AppCtx.Provider>
  );
}

function Toasts({ toasts }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={t.onClick}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
