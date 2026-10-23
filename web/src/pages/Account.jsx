import { useState } from 'react';
import { api } from '../api.js';
import { useApp, Field } from '../ui.jsx';
import { ROLE_LABEL } from '../format.js';

export default function Account() {
  const { user, notify, sound, setSound, ring } = useApp();
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
      <section className="stack">
        <h3>New-order sound</h3>
        <label className="row" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              if (e.target.checked) ring(); // play it once so staff know what to listen for
            }}
            style={{ marginTop: 3 }}
          />
          <span>
            Ring a bell when a new order comes in
            <span className="muted small" style={{ display: 'block' }}>
              It rings again every 30 seconds until someone accepts the order. This setting is for this computer only.
            </span>
          </span>
        </label>
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start', justifySelf: 'start', width: 'auto' }} onClick={ring}>
          Play the sound
        </button>
      </section>
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
