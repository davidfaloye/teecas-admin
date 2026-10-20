import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp, useLoad, useOrderEvents, ErrorBox, Loading, StatusBadge, Modal, Icon, Field } from '../ui.jsx';
import { naira, time, ago, dateTime, nextAction, STATUS_LABEL, todayKey, addDays } from '../format.js';

const BOARD = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

export default function Orders() {
  const { branchId, user } = useApp();
  const [tab, setTab] = useState(user.role === 'kitchen' ? 'kitchen' : 'board');
  const [openId, setOpenId] = useState(null);
  const scopeQ = branchId === 'all' ? undefined : branchId;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="spread">
        <div className="seg" role="tablist">
          {[
            ['board', 'Live board'],
            ['kitchen', 'Kitchen view'],
            ['history', 'History'],
          ].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted small">Payment on every order: pay on delivery</span>
      </div>
      {tab === 'history' ? (
        <History branchQ={scopeQ} onOpen={setOpenId} />
      ) : (
        <Board branchQ={scopeQ} kitchen={tab === 'kitchen'} onOpen={setOpenId} />
      )}
      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Board({ branchQ, kitchen, onOpen }) {
  const { notify, user } = useApp();
  const [fresh, setFresh] = useState(() => new Set());
  const [, tick] = useState(0);
  const { data, error, loading, reload, setData } = useLoad(
    () => api('/orders', { query: { status: BOARD.join(','), branchId: branchQ, limit: 300 } }),
    [branchQ],
  );
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  useOrderEvents((type, order) => {
    if (branchQ && order.branchId !== branchQ) return;
    setData((d) => {
      if (!d) return d;
      const rest = d.orders.filter((o) => o._id !== order._id);
      return { orders: BOARD.includes(order.status) ? [order, ...rest] : rest };
    });
    if (type === 'order.created') {
      setFresh((s) => new Set(s).add(order._id));
      setTimeout(() => setFresh((s) => { const n = new Set(s); n.delete(order._id); return n; }), 4000);
    }
  });

  async function move(order, to) {
    try {
      const d = await api(`/orders/${order._id}/status`, { method: 'PATCH', body: { status: to } });
      setData((s) => ({ orders: BOARD.includes(d.order.status) ? s.orders.map((o) => (o._id === d.order._id ? d.order : o)) : s.orders.filter((o) => o._id !== d.order._id) }));
    } catch (e) {
      notify(e.message, 'err');
      reload(true);
    }
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const cols = kitchen ? ['placed', 'accepted', 'preparing', 'ready'] : BOARD;
  const showBranch = !branchQ && user.role === 'owner';

  return (
    <div className={`board ${kitchen ? 'kitchen' : ''}`} style={kitchen ? { gridTemplateColumns: 'repeat(4, minmax(240px, 1fr))' } : undefined}>
      {cols.map((status) => {
        const list = data.orders.filter((o) => o.status === status).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return (
          <section className="col" key={status} aria-label={STATUS_LABEL[status]}>
            <div className="col-head">
              <span>{STATUS_LABEL[status]}</span>
              <span className="n">{list.length}</span>
            </div>
            <div className="col-body">
              {list.length === 0 && <div className="muted small" style={{ padding: '8px 4px' }}>Nothing here</div>}
              {list.map((o) => (
                <Ticket key={o._id} order={o} fresh={fresh.has(o._id)} showBranch={showBranch} kitchen={kitchen} onOpen={() => onOpen(o._id)} onMove={(to) => move(o, to)} canAct={canAct(user.role, o)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function canAct(role, o) {
  const a = nextAction(o);
  if (!a) return false;
  if (role === 'kitchen') return (o.status === 'accepted' && a.to === 'preparing') || (o.status === 'preparing' && a.to === 'ready');
  return true;
}

function Ticket({ order: o, fresh, showBranch, kitchen, onOpen, onMove, canAct }) {
  const a = nextAction(o);
  return (
    <article className={`ticket ${o.status} ${fresh ? 'fresh' : ''}`} onClick={onOpen} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="top">
        <b>#{o.number}</b>
        <span title={dateTime(o.createdAt)}>{ago(o.createdAt)}</span>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="chip">{o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</span>
        {showBranch && <span className="chip">{o.branchName}</span>}
      </div>
      {!kitchen && (
        <div className="small">
          <b>{o.customer.name}</b>
          {o.fulfilment === 'delivery' && <div className="muted">{o.customer.address}</div>}
        </div>
      )}
      <ul>
        {o.items.map((i) => (
          <li key={i.itemId || i.name}>
            {i.qty}× {i.name}
          </li>
        ))}
      </ul>
      {o.note && <div className="notice small">Note: {o.note}</div>}
      {!kitchen && (
        <div className="spread small">
          <span className="muted">Pay on delivery</span>
          <b className="num">{naira(o.total)}</b>
        </div>
      )}
      {a && canAct && (
        <div className="acts" onClick={(e) => e.stopPropagation()}>
          <button className={`btn sm ${o.status === 'placed' ? 'primary' : 'gold'}`} onClick={() => onMove(a.to)}>
            {a.label}
          </button>
        </div>
      )}
    </article>
  );
}

function History({ branchQ, onOpen }) {
  const [range, setRange] = useState('today');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const today = todayKey();
  const from = range === 'today' ? today : range === '7' ? addDays(today, -6) : addDays(today, -29);
  const { data, error, loading, reload } = useLoad(
    () => api('/orders', { query: { branchId: branchQ, from: query ? undefined : from, to: query ? undefined : today, q: query, limit: 300 } }),
    [branchQ, from, query],
  );
  useOrderEvents(() => reload(true));
  const showBranch = !branchQ;

  return (
    <div className="stack">
      <div className="row wrap">
        <div className="seg">
          {[
            ['today', 'Today'],
            ['7', 'Last 7 days'],
            ['30', 'Last 30 days'],
          ].map(([id, l]) => (
            <button key={id} className={range === id && !query ? 'on' : ''} onClick={() => { setRange(id); setQ(''); setQuery(''); }}>
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
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="card flush table-wrap">
          {data.orders.length === 0 ? (
            <div className="empty">No orders match.</div>
          ) : (
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
                    {showBranch && <td>{o.branchName}</td>}
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
  useOrderEvents((type, o) => o._id === id && setData({ order: o }));

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
  const move = (to, why) => run(() => api(`/orders/${id}/status`, { method: 'PATCH', body: { status: to, reason: why } }));
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
            {canCancel && !cancelling && (
              <button className="btn danger" onClick={() => setCancelling(true)}>
                Cancel order
              </button>
            )}
            {a && canAct(user.role, o) && (
              <button className="btn primary" disabled={busy} onClick={() => move(a.to)}>
                {a.label}
              </button>
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
            <span className="chip">{o.branchName}</span>
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
                <a className="btn sm" href={`https://wa.me/${o.customer.phone}?text=${encodeURIComponent(`Hello ${o.customer.name.split(' ')[0]}, this is Teecas ${o.branchName} about your order #${o.number}.`)}`} target="_blank" rel="noreferrer">
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
                  <span className="muted small">Collected? Record it:</span>
                  {['cash', 'transfer', 'pos'].map((m) => (
                    <button key={m} className="btn sm" disabled={busy} onClick={() => pay(m)}>
                      {m === 'pos' ? 'POS' : m[0].toUpperCase() + m.slice(1)}
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
    </Modal>
  );
}
