import { useState } from 'react';
import { api } from '../api.js';
import { useApp, Field } from '../ui.jsx';
import { ROLE_LABEL } from '../format.js';

export default function Account() {
  const { user, notify } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/auth/password', { method: 'POST', body: { current, next } });
      setCurrent('');
      setNext('');
      notify('Password changed');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" style={{ maxWidth: 460 }}>
      <div>
        <h2>{user.name}</h2>
        <p className="muted small">
          {user.email} · {ROLE_LABEL[user.role]}
        </p>
      </div>
      <form className="stack" onSubmit={save}>
        <h3>Change password</h3>
        <Field label="Current password">
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="at least 8 characters">
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        {error && <div className="error-box">{error}</div>}
        <button className="btn primary" disabled={busy}>
          Change password
        </button>
      </form>
    </div>
  );
}
