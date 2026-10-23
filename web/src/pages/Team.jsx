import { useState } from 'react';
import { api } from '../api.js';
import { useApp, useLoad, ErrorBox, Loading, Modal, Field, Icon } from '../ui.jsx';
import { ROLE_LABEL, dateTime } from '../format.js';

const ROLE_HELP = {
  owner: 'Everything, every branch',
  manager: 'Orders, menu availability, stock and sales for one branch',
  cashier: 'Orders, payments and stock counts for one branch',
  kitchen: 'The order board only, moves orders to preparing and ready',
};

export default function Team() {
  const { branches, notify, user: me } = useApp();
  const { data, error, loading, reload } = useLoad(() => api('/users'), []);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const bName = (id) => branches.find((b) => b._id === id)?.name || '—';

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  // Search by name, email, role or branch, ignoring case.
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? data.users.filter((u) =>
        [u.name, u.email, ROLE_LABEL[u.role], u.role === 'owner' ? 'All branches' : bName(u.branchId)].some((t) => (t || '').toLowerCase().includes(needle)),
      )
    : data.users;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="spread">
        <p className="dim">Give each staff member their own sign-in. They only see their branch.</p>
        <button className="btn primary" onClick={() => setEditing({ role: 'manager', branchId: branches[0]?._id })}>
          <Icon name="plus" /> Staff member
        </button>
      </div>
      <div className="row wrap" style={{ gap: 10 }}>
        <input
          className="input"
          type="search"
          style={{ maxWidth: 320 }}
          placeholder="Search staff"
          aria-label="Search staff"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
        />
        {needle && <span className="muted small">{shown.length === 0 ? 'No one matches' : `${shown.length} of ${data.users.length} staff`}</span>}
      </div>
      {needle && shown.length === 0 ? (
        <div className="card empty">
          No staff member matches “{q.trim()}”.{' '}
          <button className="btn sm ghost" onClick={() => setQ('')}>
            Clear search
          </button>
        </div>
      ) : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Branch</th>
                <th>Last sign-in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u._id}>
                  <td>
                    <b>{u.name}</b> {u._id === me._id && <span className="chip">You</span>}
                    <div className="muted small">{u.email}</div>
                  </td>
                  <td>
                    {ROLE_LABEL[u.role]} {u.disabled && <span className="badge cancelled">Disabled</span>}
                  </td>
                  <td>{u.role === 'owner' ? 'All branches' : bName(u.branchId)}</td>
                  <td className="small muted">{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'}</td>
                  <td className="r">
                    <button className="btn sm ghost" onClick={() => setEditing(u)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <UserForm
          user={editing}
          branches={branches}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            notify(msg);
            reload(true);
          }}
        />
      )}
    </div>
  );
}

function UserForm({ user, branches, onClose, onSaved }) {
  const isNew = !user._id;
  const { user: me } = useApp();
  // Owners can't be deleted (the restaurant always keeps one), and nobody deletes themselves.
  const canDelete = !isNew && user.role !== 'owner' && user._id !== me._id;
  const [f, setF] = useState({ name: user.name || '', email: user.email || '', role: user.role || 'manager', branchId: user.branchId || branches[0]?._id || '', password: '', disabled: Boolean(user.disabled) });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { name: f.name, role: f.role, branchId: f.role === 'owner' ? null : f.branchId, disabled: f.disabled };
      if (f.password) body.password = f.password;
      if (isNew) await api('/users', { method: 'POST', body: { ...body, email: f.email, password: f.password } });
      else await api(`/users/${user._id}`, { method: 'PATCH', body });
      onSaved(isNew ? `${f.name} can now sign in` : `${f.name} saved`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${user.name}? They won’t be able to sign in again. Orders and stock records they handled keep their name.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/users/${user._id}`, { method: 'DELETE' });
      onSaved(`${user.name} deleted`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isNew ? 'Add a staff member' : `Edit ${user.name}`}
      onClose={onClose}
      footer={
        <>
          {canDelete && (
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove} disabled={busy}>
              Delete
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <form className="form-grid" onSubmit={save}>
        <Field label="Name">
          <input className="input" value={f.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Email" hint={isNew ? 'their sign-in' : 'cannot be changed'}>
          <input className="input" type="email" value={f.email} onChange={set('email')} disabled={!isNew} />
        </Field>
        <Field label="Role" className="full">
          <select className="input" value={f.role} onChange={set('role')}>
            {Object.keys(ROLE_LABEL).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]} — {ROLE_HELP[r]}
              </option>
            ))}
          </select>
        </Field>
        {f.role !== 'owner' && (
          <Field label="Branch" className="full">
            <select className="input" value={f.branchId} onChange={set('branchId')}>
              {branches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={isNew ? 'Password' : 'New password'} hint={isNew ? 'at least 8 characters' : 'leave empty to keep'} className="full">
          <input className="input" type="text" autoComplete="new-password" value={f.password} onChange={set('password')} />
        </Field>
        {!isNew && (
          <label className="row small full">
            <input type="checkbox" checked={f.disabled} onChange={(e) => setF((s) => ({ ...s, disabled: e.target.checked }))} /> Disable this sign-in
          </label>
        )}
        <button hidden />
      </form>
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}
