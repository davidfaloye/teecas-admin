import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp, useLoad, useOrderEvents, ErrorBox, Loading, Spinner, StatusBadge, Modal, Icon, Field } from '../ui.jsx';
import { naira, time, ago, dateTime, nextAction, STATUS_LABEL, PAY_METHODS, todayKey, addDays } from '../format.js';

// The four columns of the live board. "preparing" and "ready" (used by the kitchen view and by
// older orders) sit in Accepted.
const COLUMNS = [
  {
    id: 'incoming',
    title: 'Incoming order',
    statuses: ['placed'],
    color: 'var(--accent)',
    help: 'New orders from the app. Customers don’t choose a branch, so every branch sees these. The branch nearest the customer that has the food takes it by accepting; it then leaves the other branches’ boards. If no branch can fill it, open the order and cancel it with a reason; the customer sees the reason.',
  },
  {
    id: 'accepted',
    title: 'Accepted order',
    statuses: ['accepted', 'preparing', 'ready'],
    color: 'var(--warn)',
    help: 'The branch has confirmed the order and the kitchen is making it. When it’s packed, tap Send out for delivery. Pickup orders skip delivery: tap Collected & paid when the customer picks it up and pays.',
  },
  {
    id: 'out',
    title: 'Out for delivery',
    statuses: ['out_for_delivery'],
    color: 'var(--violet)',
    help: 'The rider has the food and is on the way. The customer pays on arrival by cash, transfer or POS. When the rider confirms, tap Delivered & paid and choose how they paid.',
  },
  {
    id: 'done',
    title: 'Order delivered & paid',
    statuses: ['completed'],
    color: 'var(--good)',
    help: 'Finished: the customer has the food and the money is collected. Only today’s orders show here; older ones are under History. These count towards sales.',
  },
];
const ACTIVE = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
const DONE_SHOWN = 25;

export default function Orders() {
  const { branchId } = useApp();
  const [tab, setTab] = useState('board');
  const [openId, setOpenId] = useState(null);
  const scopeQ = branchId === 'all' ? undefined : branchId;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread">
        <div className="seg" role="tablist">
          {[
            ['board', 'Live board'],
            // Kitchen view is switched off for now. To bring it back, uncomment this line and
            // pass kitchen={tab === 'kitchen'} to <Board> below (its columns are in KITCHEN_COLUMNS).
            // ['kitchen', 'Kitchen view'],
            ['history', 'History'],
          ].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted small">Every order is pay on delivery</span>
      </div>
      {tab === 'history' ? <History branchQ={scopeQ} onOpen={setOpenId} /> : <Board branchQ={scopeQ} onOpen={setOpenId} />}
      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/* Kitchen view (switched off): big-type tickets moving accepted -> preparing -> ready.
const KITCHEN_COLUMNS = [
  { id: 'k-new', title: 'Accepted', statuses: ['accepted'], color: 'var(--warn)', help: 'Accepted orders waiting to be cooked.' },
  { id: 'k-cook', title: 'Preparing', statuses: ['preparing'], color: 'var(--warn)', help: 'Being cooked now.' },
  { id: 'k-ready', title: 'Ready', statuses: ['ready'], color: 'var(--good)', help: 'Packed and waiting for the rider or the customer.' },
];
*/

export function Help({ text, end }) {
  return (
    <span className={`help ${end ? 'end' : ''}`}>
      <button type="button" className="help-btn" aria-label="What does this mean?">
        <Icon name="info" />
      </button>
      <span className="help-tip" role="tooltip">
        {text}
      </span>
    </span>
  );
}

function Board({ branchQ, onOpen }) {
  const { notify, user } = useApp();
  const [fresh, setFresh] = useState(() => new Set());
  const [, tick] = useState(0);
  const today = todayKey();
  const { data, error, loading, reload, setData } = useLoad(async () => {
    const [active, done] = await Promise.all([
      api('/orders', { query: { status: ACTIVE.join(','), branchId: branchQ, limit: 300 } }),
      api('/orders', { query: { status: 'completed', branchId: branchQ, from: today, to: today, limit: 300 } }),
    ]);
    return { orders: [...active.orders, ...done.orders] };
  }, [branchQ, today]);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const keep = (o) => ACTIVE.includes(o.status) || o.status === 'completed';
  const upsert = (order) =>
    setData((d) => {
      if (!d) return d;
      const rest = d.orders.filter((o) => o._id !== order._id);
      return { orders: keep(order) ? [order, ...rest] : rest };
    });

  useOrderEvents((type, order) => {
    if (type === 'order.deleted') {
      setData((d) => (d ? { orders: d.orders.filter((o) => o._id !== order._id) } : d));
      return;
    }
    // Unassigned orders show on every board; once a branch takes one, other boards drop it.
    if (order.branchId && branchQ && order.branchId !== branchQ) {
      setData((d) => (d ? { orders: d.orders.filter((o) => o._id !== order._id) } : d));
      return;
    }
    upsert(order);
    if (type === 'order.created') {
      setFresh((s) => new Set(s).add(order._id));
      setTimeout(() => setFresh((s) => { const n = new Set(s); n.delete(order._id); return n; }), 4000);
    }
  });

  async function move(order, to, paymentMethod, branchId) {
    try {
      const d = await api(`/orders/${order._id}/status`, { method: 'PATCH', body: { status: to, paymentMethod, branchId } });
      upsert(d.order);
      return true;
    } catch (e) {
      notify(e.message, 'err');
      reload(true);
      return false;
    }
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const showBranch = !branchQ && user.role === 'owner';

  return (
    <div className="board">
      {COLUMNS.map((c, ci) => {
        const done = c.id === 'done';
        const list = data.orders
          .filter((o) => c.statuses.includes(o.status))
          .sort((a, b) => (done ? (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt) : a.createdAt.localeCompare(b.createdAt)));
        const shown = done ? list.slice(0, DONE_SHOWN) : list;
        return (
          <section className="col" key={c.id} aria-label={c.title}>
            <div className="col-head">
              <span className="dot" style={{ background: c.color }} />
              <span>{c.title}</span>
              <Help text={c.help} end={ci === COLUMNS.length - 1} />
              <span className="n">{list.length}</span>
            </div>
            <div className="col-body">
              {list.length === 0 && <div className="muted small" style={{ padding: '8px 4px' }}>{done ? 'None yet today' : 'Nothing here'}</div>}
              {shown.map((o) =>
                done ? (
                  <DoneTicket key={o._id} order={o} showBranch={showBranch} onOpen={() => onOpen(o._id)} />
                ) : (
                  <Ticket key={o._id} order={o} fresh={fresh.has(o._id)} showBranch={showBranch} onOpen={() => onOpen(o._id)} onMove={(to, pm, bid) => move(o, to, pm, bid)} defaultBranch={branchQ} canAct={canAct(user.role, o)} />
                ),
              )}
            </div>
            {done && list.length > DONE_SHOWN && <div className="col-foot">{list.length - DONE_SHOWN} more today in History</div>}
          </section>
        );
      })}
    </div>
  );
}

// Kitchen accounts only move food through the kitchen view, so they watch the board read-only.
function canAct(role, o) {
  return Boolean(nextAction(o)) && role !== 'kitchen';
}

function PayPicker({ label, onPick, onCancel, busy }) {
  return (
    <div className="pay-pick" onClick={(e) => e.stopPropagation()}>
      <span className="small" style={{ fontWeight: 600, color: 'var(--good)' }}>
        {label}: how did they pay?
      </span>
      <div className="row" style={{ gap: 6 }}>
        {PAY_METHODS.map(([m, l]) => (
          <button key={m} className="btn sm good" disabled={busy} onClick={() => onPick(m)}>
            {l}
          </button>
        ))}
      </div>
      <button className="btn sm ghost" onClick={onCancel}>
        Not yet
      </button>
    </div>
  );
}

// Who prepares an unassigned order is decided when it is accepted: the owner picks a branch,
// branch staff accept it for their own branch.
function AcceptButton({ order: o, busy, onAccept, defaultBranch, big }) {
  const { user, branches } = useApp();
  const [pick, setPick] = useState(defaultBranch || '');
  const cls = `btn ${big ? '' : 'sm'} primary`;
  if (o.branchId) {
    return (
      <button className={cls} disabled={busy} onClick={() => onAccept()}>
        Accept order
      </button>
    );
  }
  if (user.role !== 'owner') {
    const mine = branches.find((b) => b._id === user.branchId)?.name || 'my branch';
    return (
      <button className={cls} disabled={busy} onClick={() => onAccept(user.branchId)}>
        Accept for {mine}
      </button>
    );
  }
  const open = branches.filter((b) => !b.archived);
  return (
    <div className="accept-pick" onClick={(e) => e.stopPropagation()}>
      <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Branch that will prepare and deliver this order">
        <option value="">Choose branch…</option>
        {open.map((b) => (
          <option key={b._id} value={b._id}>
            {b.name}
            {b.acceptingOrders ? '' : ' (paused)'}
          </option>
        ))}
      </select>
      <button className={cls} disabled={busy || !pick} onClick={() => onAccept(pick)}>
        Accept
      </button>
    </div>
  );
}

function Ticket({ order: o, fresh, showBranch, onOpen, onMove, canAct, defaultBranch }) {
  const a = nextAction(o);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async (pm, branchId) => {
    setBusy(true);
    const ok = await onMove(a.to, pm, branchId);
    setBusy(false);
    if (ok) setPaying(false);
  };
  return (
    <article className={`ticket ${o.status} ${fresh ? 'fresh' : ''}`} onClick={onOpen} tabIndex={0} onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onOpen()}>
      <div className="top">
        <b>#{o.number}</b>
        <span title={dateTime(o.createdAt)}>{ago(o.createdAt)}</span>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="chip">{o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</span>
        {showBranch && o.branchId && <span className="chip">{o.branchName}</span>}
        {o.paymentStatus === 'paid' && <span className="badge paid">Paid</span>}
      </div>
      <div className="small">
        <b>{o.customer.name}</b>
        {o.fulfilment === 'delivery' && <div className="muted">{o.customer.address}</div>}
      </div>
      <ul>
        {o.items.map((i) => (
          <li key={i.itemId || i.name}>
            {i.qty}× {i.name}
          </li>
        ))}
      </ul>
      {o.note && <div className="notice small">Note: {o.note}</div>}
      <div className="spread small">
        <span className="muted">{o.paymentStatus === 'paid' ? `Paid by ${o.paidWith}` : 'To collect'}</span>
        <b className="num">{naira(o.total)}</b>
      </div>
      {a && canAct && (paying ? (
        <PayPicker label={a.label} busy={busy} onPick={go} onCancel={() => setPaying(false)} />
      ) : o.status === 'placed' ? (
        <div className="acts" onClick={(e) => e.stopPropagation()}>
          <AcceptButton order={o} busy={busy} defaultBranch={defaultBranch} onAccept={(bid) => go(undefined, bid)} />
        </div>
      ) : (
        <div className="acts" onClick={(e) => e.stopPropagation()}>
          <button className={`btn sm ${o.status === 'placed' ? 'primary' : a.to === 'completed' ? 'good' : 'gold'}`} disabled={busy} onClick={() => (a.pay ? setPaying(true) : go())}>
            {a.label}
          </button>
        </div>
      ))}
    </article>
  );
}

function DoneTicket({ order: o, showBranch, onOpen }) {
  return (
    <article className="ticket completed done" onClick={onOpen} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="top">
        <b>#{o.number}</b>
        <span>{time(o.completedAt || o.updatedAt)}</span>
      </div>
      <div className="row small" style={{ flexWrap: 'nowrap' }}>
        <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {o.customer.name}
          {showBranch ? <span className="muted"> · {o.branchName}</span> : null}
        </span>
        <b className="num">{naira(o.total)}</b>
      </div>
      <div className="muted small">
        {o.fulfilment === 'delivery' ? 'Delivered' : 'Collected'} · paid by {o.paidWith === 'pos' ? 'POS' : o.paidWith || '—'}
      </div>
    </article>
  );
}

const PAGE_SIZE = 25;
const RANGES = [
  ['today', 'Today'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
];

function History({ branchQ, onOpen }) {
  const [range, setRange] = useState('today');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const today = todayKey();
  const from = range === 'today' ? today : range === '7' ? addDays(today, -6) : addDays(today, -29);
  // The page belongs to the current filter, so a new range, search or branch starts at page 1.
  const filterKey = `${branchQ}|${from}|${query}`;
  const [paging, setPaging] = useState({ key: filterKey, page: 0 });
  const page = paging.key === filterKey ? paging.page : 0;
  const setPage = (fn) => setPaging({ key: filterKey, page: fn(page) });
  const { data, error, loading, reload } = useLoad(
    () =>
      api('/orders', {
        query: { branchId: branchQ, from: query ? undefined : from, to: query ? undefined : today, q: query, limit: PAGE_SIZE, skip: page * PAGE_SIZE, total: 1 },
      }),
    [branchQ, from, query, page],
  );
  useOrderEvents(() => reload(true));
  const showBranch = !branchQ;

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const what = query ? `results for "${query}"` : RANGES.find(([id]) => id === range)[1].toLowerCase();
  const switching = loading && data; // keep the old rows on screen, dimmed, until the new ones arrive

  return (
    <div className="stack">
      <div className="row wrap">
        <div className="seg">
          {RANGES.map(([id, l]) => (
            <button key={id} className={range === id && !query ? 'on' : ''} disabled={loading && range === id && !query} onClick={() => { setRange(id); setQ(''); setQuery(''); }}>
              {l}
            </button>
          ))}
        </div>
        <form className="row grow" style={{ maxWidth: 360 }} onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <input className="input" placeholder="Search name, phone or order #" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn icon" aria-label="Search">
            <Icon name="search" />
          </button>
        </form>
        {switching && (
          <span className="loading-inline" aria-live="polite">
            <Spinner /> Loading {what}…
          </span>
        )}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading label="Loading orders…" />
      ) : (
        <div className={`card flush ${switching ? 'is-loading' : ''}`} aria-busy={Boolean(switching)}>
          {data.orders.length === 0 ? (
            <div className="empty">No orders match.</div>
          ) : (
            <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Time</th>
                  {showBranch && <th>Branch</th>}
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o._id} className="click" onClick={() => onOpen(o._id)}>
                    <td className="num">#{o.number}</td>
                    <td className="small">{dateTime(o.createdAt)}</td>
                    {showBranch && <td>{o.branchName || <span className="muted">—</span>}</td>}
                    <td>{o.customer.name}</td>
                    <td className="small">{o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="small">{o.paymentStatus === 'paid' ? <span className="badge paid">Paid · {o.paidWith}</span> : <span className="muted">Unpaid</span>}</td>
                    <td className="r num">{naira(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {total > 0 && (
            <div className="pager">
              <span className="small dim num">
                {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total} orders
              </span>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <span className="small num" style={{ minWidth: 86, textAlign: 'center' }}>
                  Page {page + 1} of {pages}
                </span>
                <button className="btn sm" disabled={page >= pages - 1 || loading} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ id, onClose }) {
  const { user, notify } = useApp();
  const { data, error, loading, setData, reload } = useLoad(() => api(`/orders/${id}`), [id]);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useOrderEvents((type, o) => {
    if (o._id !== id) return;
    if (type === 'order.deleted') {
      // Someone else deleted it while this was open.
      if (!deletedHere.current) notify(`Order #${o.number} was deleted.`);
      onClose();
      return;
    }
    setData({ order: o });
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deletedHere = useRef(false);
  async function remove() {
    setBusy(true);
    try {
      const d = await api(`/orders/${id}`, { method: 'DELETE' });
      deletedHere.current = true;
      notify(`Order #${d.number} deleted.`);
      setConfirmDelete(false);
      onClose();
    } catch (e) {
      notify(e.message, 'err');
      setBusy(false);
    }
  }

  const o = data?.order;
  async function run(fn) {
    setBusy(true);
    try {
      const d = await fn();
      setData({ order: d.order });
      return true;
    } catch (e) {
      notify(e.message, 'err');
      reload(true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const [paying, setPaying] = useState(false);
  const move = (to, why, paymentMethod, branchId) => run(() => api(`/orders/${id}/status`, { method: 'PATCH', body: { status: to, reason: why, paymentMethod, branchId } }));
  const pay = (method) => run(() => api(`/orders/${id}/payment`, { method: 'PATCH', body: { paymentStatus: 'paid', method } }));
  const unpay = () => run(() => api(`/orders/${id}/payment`, { method: 'PATCH', body: { paymentStatus: 'unpaid' } }));

  const a = o && nextAction(o);
  const canPay = user.role !== 'kitchen';
  const canCancel = user.role !== 'kitchen' && o && !['completed', 'cancelled'].includes(o.status);

  return (
    <Modal
      title={o ? `Order #${o.number}` : 'Order'}
      onClose={onClose}
      wide
      footer={
        o && (
          <>
            {user.role === 'owner' && (
              <button className="btn ghost danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" /> Delete
              </button>
            )}
            {canCancel && !cancelling && (
              <button className="btn danger" onClick={() => setCancelling(true)}>
                Cancel order
              </button>
            )}
            {a && canAct(user.role, o) && !paying && o.status === 'placed' && <AcceptButton order={o} busy={busy} big onAccept={(bid) => move(a.to, undefined, undefined, bid)} />}
            {a && canAct(user.role, o) && !paying && o.status !== 'placed' && (
              <button className={`btn ${a.to === 'completed' ? 'good' : 'primary'}`} disabled={busy} onClick={() => (a.pay ? setPaying(true) : move(a.to))}>
                {a.label}
              </button>
            )}
            {a && paying && (
              <>
                <span className="small" style={{ alignSelf: 'center', fontWeight: 600 }}>
                  {a.label}, paid by:
                </span>
                {PAY_METHODS.map(([m, l]) => (
                  <button key={m} className="btn good" disabled={busy} onClick={async () => (await move(a.to, undefined, m)) && setPaying(false)}>
                    {l}
                  </button>
                ))}
                <button className="btn ghost" onClick={() => setPaying(false)}>
                  Back
                </button>
              </>
            )}
          </>
        )
      }
    >
      {loading && !o && <Loading />}
      <ErrorBox error={error} />
      {o && (
        <>
          <div className="row wrap">
            <StatusBadge status={o.status} />
            <span className="chip">{o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</span>
            {o.branchId && <span className="chip">{o.branchName}</span>}
            <span className="muted small">Placed {dateTime(o.createdAt)} in the app</span>
          </div>

          {cancelling && (
            <div className="card stack" style={{ background: 'var(--bg-2)' }}>
              <Field label="Why are you cancelling?" hint="the customer sees this">
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer could not be reached" autoFocus />
              </Field>
              <div className="row">
                <button className="btn danger" disabled={busy || !reason.trim()} onClick={async () => (await move('cancelled', reason.trim())) && setCancelling(false)}>
                  Cancel the order
                </button>
                <button className="btn ghost" onClick={() => setCancelling(false)}>
                  Keep it
                </button>
              </div>
            </div>
          )}

          <div className="grid g2">
            <div className="stack">
              <h3>Customer</h3>
              <div>
                <b>{o.customer.name}</b>
                <div className="num small">+{o.customer.phone}</div>
                {o.customer.address && <div className="dim small">{o.customer.address}</div>}
              </div>
              <div className="row wrap">
                <a className="btn sm" href={`tel:+${o.customer.phone}`}>
                  <Icon name="phone" /> Call
                </a>
                <a className="btn sm" href={`https://wa.me/${o.customer.phone}?text=${encodeURIComponent(`Hello ${o.customer.name.split(' ')[0]}, this is Teecas${o.branchName ? ` ${o.branchName}` : ''} about your order #${o.number}.`)}`} target="_blank" rel="noreferrer">
                  <Icon name="wa" /> WhatsApp
                </a>
              </div>
              {o.note && <div className="notice small">Note: {o.note}</div>}
              {o.cancelReason && <div className="error-box small">Cancelled: {o.cancelReason}</div>}
            </div>
            <div className="stack">
              <h3>Items</h3>
              <div className="lines">
                {o.items.map((i) => (
                  <div className="l" key={i.itemId || i.name}>
                    <span>
                      {i.qty}× {i.name}
                    </span>
                    <span className="leader" />
                    <span className="num">{naira(i.lineTotal)}</span>
                  </div>
                ))}
                {o.deliveryFeeExcluded && (
                  <div className="l muted">
                    <span>Delivery</span>
                    <span className="leader" />
                    <span>paid to the rider</span>
                  </div>
                )}
                {o.deliveryFee > 0 && (
                  <div className="l muted">
                    <span>Delivery</span>
                    <span className="leader" />
                    <span className="num">{naira(o.deliveryFee)}</span>
                  </div>
                )}
                <div className="l" style={{ fontWeight: 700, fontSize: 17 }}>
                  <span>Total</span>
                  <span className="leader" />
                  <span className="num">{naira(o.total)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid g2">
            <div className="stack">
              <h3>Payment · pay on delivery</h3>
              {o.paymentStatus === 'paid' ? (
                <div className="row wrap">
                  <span className="badge paid">
                    Paid by {o.paidWith} {o.paidAt ? `· ${time(o.paidAt)}` : ''}
                  </span>
                  {canPay && (
                    <button className="btn sm ghost" disabled={busy} onClick={unpay}>
                      Undo
                    </button>
                  )}
                </div>
              ) : canPay && o.status !== 'cancelled' ? (
                <div className="row wrap">
                  <span className="muted small">Paid before delivery (e.g. transfer)? Record it:</span>
                  {PAY_METHODS.map(([m, l]) => (
                    <button key={m} className="btn sm" disabled={busy} onClick={() => pay(m)}>
                      {l}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="muted small">Not paid</span>
              )}
            </div>
            <div className="stack">
              <h3>Timeline</h3>
              <ul className="timeline">
                {o.statusHistory.map((h, i) => (
                  <li key={i}>
                    <span>
                      <b>{STATUS_LABEL[h.status]}</b> <span className="muted small">{time(h.at)} · {h.by}</span>
                      {h.reason && <div className="muted small">{h.reason}</div>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
      {confirmDelete && o && (
        <Modal
          small
          title={`Delete order #${o.number}?`}
          onClose={() => !busy && setConfirmDelete(false)}
          footer={
            <>
              <button className="btn ghost" disabled={busy} onClick={() => setConfirmDelete(false)} autoFocus>
                Keep it
              </button>
              <button className="btn danger-fill" disabled={busy} onClick={remove}>
                {busy ? <Spinner label="Deleting" /> : <Icon name="trash" />} Delete for good
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {o.customer?.name || 'This customer'}’s order for {naira(o.total)} will be removed from the board, history and sales figures. <b>This can’t be undone.</b>
          </p>
          {!['completed', 'cancelled'].includes(o.status) && (
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              This order is still open. If it just isn’t going ahead, cancel it instead so the customer sees why.
            </p>
          )}
        </Modal>
      )}
    </Modal>
  );
}
