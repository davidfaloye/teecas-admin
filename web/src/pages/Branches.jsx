import { useState } from 'react';
import { api } from '../api.js';
import { useApp, Modal, Field, Switch, Icon } from '../ui.jsx';
import { naira } from '../format.js';

export default function Branches() {
  const { user, branches, reloadBranches, notify } = useApp();
  const [editing, setEditing] = useState(null);
  const isOwner = user.role === 'owner';
  const list = isOwner ? branches : branches.filter((b) => b._id === user.branchId);

  async function toggle(b, on) {
    try {
      await api(`/branches/${b._id}`, { method: 'PATCH', body: { acceptingOrders: on } });
      notify(on ? `${b.name} is taking app orders again` : `App orders paused at ${b.name}`);
      reloadBranches();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="spread">
        <p className="dim">Each branch has its own WhatsApp number, delivery fee and stock. Pause online orders when a branch is too busy or closed.</p>
        {isOwner && (
          <button className="btn primary" onClick={() => setEditing({})}>
            <Icon name="plus" /> Branch
          </button>
        )}
      </div>
      <div className="grid g3">
        {list.map((b) => (
          <article className="card stack" key={b._id}>
            <div className="spread">
              <h2>{b.name}</h2>
              {isOwner && (
                <button className="btn sm ghost" onClick={() => setEditing(b)}>
                  Edit
                </button>
              )}
            </div>
            <div className="small dim">
              {b.address}
              {b.landmark && <div className="muted">{b.landmark}</div>}
            </div>
            <div className="lines small">
              <Line k="WhatsApp" v={`+${b.whatsapp}`} />
              <Line k="Hours" v={b.hours || '—'} />
              <Line k="Usual delivery fee" v={naira(b.deliveryFee || 0)} />
            </div>
            <label className="row" style={{ justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
              <span>
                <b>App orders</b>
                <div className="muted small">{b.acceptingOrders ? 'Customers can order' : 'Paused: the app shows it as closed'}</div>
              </span>
              <Switch checked={Boolean(b.acceptingOrders)} onChange={(v) => toggle(b, v)} label={`Take app orders at ${b.name}`} />
            </label>
          </article>
        ))}
      </div>
      {editing && (
        <BranchForm
          branch={editing}
          canDelete={branches.length > 1}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            notify(msg);
            reloadBranches();
          }}
        />
      )}
    </div>
  );
}

const Line = ({ k, v }) => (
  <div className="l">
    <span className="muted">{k}</span>
    <span className="leader" />
    <span className="num">{v}</span>
  </div>
);

function BranchForm({ branch, canDelete, onClose, onSaved }) {
  const isNew = !branch._id;
  const [f, setF] = useState({
    name: branch.name || '',
    address: branch.address || '',
    landmark: branch.landmark || '',
    whatsapp: branch.whatsapp ? '+' + branch.whatsapp : '',
    hours: branch.hours || '',
    deliveryFee: branch.deliveryFee ?? 0,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...f, phone: f.whatsapp };
      if (isNew) await api('/branches', { method: 'POST', body: { ...body, acceptingOrders: true } });
      else await api(`/branches/${branch._id}`, { method: 'PATCH', body });
      onSaved(isNew ? `${f.name} added` : `${f.name} saved`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Close ${branch.name}? It disappears from the app. Its order history is kept.`)) return;
    setBusy(true);
    try {
      await api(`/branches/${branch._id}`, { method: 'DELETE' });
      onSaved(`${branch.name} closed`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isNew ? 'Add a branch' : `Edit ${branch.name}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && canDelete && (
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove} disabled={busy}>
              Close branch
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
        <Field label="Branch name" className="full">
          <input className="input" value={f.name} onChange={set('name')} autoFocus placeholder="e.g. Ogba Road" />
        </Field>
        <Field label="Address" className="full">
          <input className="input" value={f.address} onChange={set('address')} />
        </Field>
        <Field label="Landmark" hint="optional" className="full">
          <input className="input" value={f.landmark} onChange={set('landmark')} />
        </Field>
        <Field label="WhatsApp number" hint="orders go here">
          <input className="input num" value={f.whatsapp} onChange={set('whatsapp')} placeholder="+234 808 852 4502" />
        </Field>
        <Field label="Usual delivery fee (₦)" hint="for reference; not added to order totals">
          <input className="input num" inputMode="numeric" value={f.deliveryFee} onChange={set('deliveryFee')} />
        </Field>
        <Field label="Opening hours" className="full">
          <input className="input" value={f.hours} onChange={set('hours')} placeholder="Mon–Sat 8am – 9pm" />
        </Field>
        <button hidden />
      </form>
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}
