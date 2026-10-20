import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp, useLoad, ErrorBox, Loading, Modal, Field, Icon } from '../ui.jsx';
import { naira, dateTime } from '../format.js';

const ACTIONS = {
  purchase: { label: 'Stock in', verb: 'Add', hint: 'quantity bought' },
  usage: { label: 'Used', verb: 'Remove', hint: 'quantity used in the kitchen' },
  waste: { label: 'Waste', verb: 'Remove', hint: 'spoilt or thrown away' },
  adjustment: { label: 'Count', verb: 'Set', hint: 'what is on the shelf now' },
};

export default function Inventory() {
  const { user, branches, branchId, notify } = useApp();
  const scopeQ = branchId === 'all' ? undefined : branchId;
  const { data, error, loading, reload, setData } = useLoad(() => api('/inventory', { query: { branchId: scopeQ } }), [scopeQ]);
  const log = useLoad(() => api('/inventory/movements', { query: { branchId: scopeQ, limit: 25 } }), [scopeQ]);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [moving, setMoving] = useState(null); // { item, reason }
  const [editing, setEditing] = useState(null);
  const canEdit = user.role === 'owner' || user.role === 'manager';
  const showBranch = !scopeQ;
  const bName = (id) => branches.find((b) => b._id === id)?.name || '';

  const items = useMemo(() => {
    if (!data) return [];
    return data.items
      .filter((i) => (filter === 'low' ? i.low : true))
      .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (showBranch ? bName(a.branchId).localeCompare(bName(b.branchId)) : 0) || (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, q, showBranch, branches]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const lowCount = data.items.filter((i) => i.low).length;
  const value = data.items.reduce((s, i) => s + i.qty * (i.costPerUnit || 0), 0);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid g4">
        <div className="card stat">
          <div className="label">Stock items</div>
          <div className="value">{data.items.length}</div>
          <div className="sub">{showBranch ? 'Across all branches' : bName(scopeQ)}</div>
        </div>
        <div className="card stat">
          <div className="label">Low stock</div>
          <div className="value" style={{ color: lowCount ? 'var(--bad)' : undefined }}>{lowCount}</div>
          <div className="sub">At or under the reorder level</div>
        </div>
        <div className="card stat">
          <div className="label">Stock value</div>
          <div className="value">{naira(value)}</div>
          <div className="sub">At the cost prices entered</div>
        </div>
        <div className="card stat">
          <div className="label">Last change</div>
          <div className="value" style={{ fontSize: 18 }}>{log.data?.movements[0] ? log.data.movements[0].itemName : '—'}</div>
          <div className="sub">{log.data?.movements[0] ? `${dateTime(log.data.movements[0].createdAt)} · ${log.data.movements[0].by}` : ''}</div>
        </div>
      </div>

      <div className="spread">
        <div className="row wrap">
          <div className="seg">
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
              All
            </button>
            <button className={filter === 'low' ? 'on' : ''} onClick={() => setFilter('low')}>
              Low stock ({lowCount})
            </button>
          </div>
          <input className="input" style={{ maxWidth: 240 }} placeholder="Search stock" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {canEdit && (
          <button className="btn primary" onClick={() => setEditing({ branchId: scopeQ || user.branchId || branches[0]?._id })}>
            <Icon name="plus" /> Stock item
          </button>
        )}
      </div>

      <div className="card flush table-wrap">
        {items.length === 0 ? (
          <div className="empty">{filter === 'low' ? 'Nothing is running low.' : 'No stock items yet.'}</div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Item</th>
                {showBranch && <th>Branch</th>}
                <th className="r">On hand</th>
                <th className="r">Reorder at</th>
                <th>Record</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i._id}>
                  <td>
                    <b>{i.name}</b>
                    <div className="muted small">{i.category}</div>
                  </td>
                  {showBranch && <td>{bName(i.branchId)}</td>}
                  <td className="r">
                    <span className={`num ${i.low ? 'badge low' : ''}`}>{i.qty}</span> <span className="muted small">{i.unit}</span>
                  </td>
                  <td className="r num muted">{i.reorderLevel}</td>
                  <td>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {Object.entries(ACTIONS).map(([reason, a]) => (
                        <button key={reason} className="btn sm" onClick={() => setMoving({ item: i, reason })}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </td>
                  {canEdit && (
                    <td className="r">
                      <button className="btn sm ghost" onClick={() => setEditing(i)}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card flush">
        <div className="card-head" style={{ padding: '16px 18px 0' }}>
          <h2>Recent stock changes</h2>
        </div>
        {log.data?.movements.length ? (
          <div className="table-wrap">
            <table className="t">
              <tbody>
                {log.data.movements.map((m) => (
                  <tr key={m._id}>
                    <td className="small">{dateTime(m.createdAt)}</td>
                    <td>
                      {m.itemName}
                      {showBranch && <div className="muted small">{bName(m.branchId)}</div>}
                    </td>
                    <td className="small">{ACTIONS[m.reason]?.label || m.reason}</td>
                    <td className={`r num ${m.change > 0 ? 'delta up' : 'delta down'}`}>
                      {m.change > 0 ? '+' : ''}
                      {m.change} {m.unit}
                    </td>
                    <td className="r num muted">→ {m.qtyAfter}</td>
                    <td className="small muted">
                      {m.by}
                      {m.note ? ` · ${m.note}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">No stock changes yet.</div>
        )}
      </div>

      {moving && (
        <MovementForm
          {...moving}
          onClose={() => setMoving(null)}
          onSaved={(item, msg) => {
            setMoving(null);
            setData((d) => ({ items: d.items.map((x) => (x._id === item._id ? item : x)) }));
            log.reload(true);
            notify(msg);
          }}
        />
      )}
      {editing && (
        <ItemForm
          item={editing}
          branches={user.role === 'owner' ? branches : branches.filter((b) => b._id === user.branchId)}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            reload(true);
            log.reload(true);
            notify(msg);
          }}
        />
      )}
    </div>
  );
}

function MovementForm({ item, reason: initial, onClose, onSaved }) {
  const [reason, setReason] = useState(initial);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const a = ACTIONS[reason];

  async function save(e) {
    e?.preventDefault();
    const n = Number(qty);
    if (qty === '' || !Number.isFinite(n) || n < 0 || (reason !== 'adjustment' && n === 0)) return setError('Enter a quantity.');
    setBusy(true);
    setError('');
    try {
      const body = reason === 'adjustment' ? { setTo: n, reason, note } : { change: reason === 'purchase' ? n : -n, reason, note };
      const d = await api(`/inventory/${item._id}/movements`, { method: 'POST', body });
      onSaved(d.item, `${item.name}: ${d.item.qty} ${item.unit} on hand`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="seg">
        {Object.entries(ACTIONS).map(([r, x]) => (
          <button key={r} className={r === reason ? 'on' : ''} onClick={() => setReason(r)}>
            {x.label}
          </button>
        ))}
      </div>
      <p className="dim">
        On hand now: <b className="num">{item.qty}</b> {item.unit}
      </p>
      <form className="stack" onSubmit={save}>
        <Field label={`${a.verb} (${item.unit})`} hint={a.hint}>
          <input className="input num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} autoFocus />
        </Field>
        <Field label="Note" hint="optional">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === 'purchase' ? 'e.g. Supplier, invoice no.' : ''} />
        </Field>
        <button hidden />
      </form>
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}

function ItemForm({ item, branches, onClose, onSaved }) {
  const isNew = !item._id;
  const [f, setF] = useState({
    branchId: item.branchId || branches[0]?._id,
    name: item.name || '',
    unit: item.unit || '',
    category: item.category || '',
    qty: '',
    reorderLevel: item.reorderLevel ?? '',
    costPerUnit: item.costPerUnit ?? '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isNew) await api('/inventory', { method: 'POST', body: f });
      else {
        const { name, unit, category, reorderLevel, costPerUnit } = f;
        await api(`/inventory/${item._id}`, { method: 'PATCH', body: { name, unit, category, reorderLevel, costPerUnit } });
      }
      onSaved(isNew ? `${f.name} added` : `${f.name} saved`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Remove ${item.name} from this branch's stock list?`)) return;
    setBusy(true);
    try {
      await api(`/inventory/${item._id}`, { method: 'DELETE' });
      onSaved(`${item.name} removed`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isNew ? 'Add a stock item' : `Edit ${item.name}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove} disabled={busy}>
              Remove
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
        {isNew && branches.length > 1 && (
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
        <Field label="Item name" className="full">
          <input className="input" value={f.name} onChange={set('name')} autoFocus placeholder="e.g. Palm oil" />
        </Field>
        <Field label="Unit">
          <input className="input" value={f.unit} onChange={set('unit')} placeholder="kg, bags (50 kg), pcs" />
        </Field>
        <Field label="Group" hint="optional">
          <input className="input" value={f.category} onChange={set('category')} placeholder="Protein, Dry goods" />
        </Field>
        {isNew && (
          <Field label="On hand now">
            <input className="input num" inputMode="decimal" value={f.qty} onChange={set('qty')} />
          </Field>
        )}
        <Field label="Reorder at" hint="warn at or under">
          <input className="input num" inputMode="decimal" value={f.reorderLevel} onChange={set('reorderLevel')} />
        </Field>
        <Field label="Cost per unit (₦)" hint="optional">
          <input className="input num" inputMode="numeric" value={f.costPerUnit} onChange={set('costPerUnit')} />
        </Field>
        <button hidden />
      </form>
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}
