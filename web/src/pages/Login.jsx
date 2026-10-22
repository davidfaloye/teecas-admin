import { useEffect, useState } from 'react';
import { api, setToken } from '../api.js';
import { Field } from '../ui.jsx';

const DEMO = [
  ['owner@teecas.online', 'Owner, all branches'],
  ['ogba@teecas.online', 'Ogba Road manager'],
  ['kitchen.ogba@teecas.online', 'Ogba Road kitchen'],
];

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    api('/health').then((d) => setDemo(Boolean(d.demoLogins))).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    try {
      const d = await api('/auth/login', { method: 'POST', body: { email: email.trim(), password } });
      setToken(d.token);
      window.location.hash = d.user.role === 'kitchen' ? '#/orders' : '#/home';
      onSignedIn(d.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <aside className="login-art" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <i key={n} className={`t t${n}`} />
        ))}
        <b>Teecas Amala Express Bukka</b>
      </aside>
      <main className="login-panel">
        <form onSubmit={submit} noValidate>
          <div className="brand">
            Teecas <span>Admin</span>
          </div>
          <div>
            <h1>Sign in</h1>
            <p className="dim" style={{ marginTop: 8 }}>
              Orders, menu, stock and sales for every branch.
            </p>
          </div>
          <Field label="Email">
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <div className="error-box">{error}</div>}
          <button className="btn primary lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {demo && (
            <div className="demo-logins">
              <span>Demo accounts (password teecas-demo)</span>
              {DEMO.map(([e, label]) => (
                <button
                  type="button"
                  key={e}
                  onClick={() => {
                    setEmail(e);
                    setPassword('teecas-demo');
                  }}
                >
                  {e} · {label}
                </button>
              ))}
            </div>
          )}
        </form>
      </main>
    </div>
  );
}
