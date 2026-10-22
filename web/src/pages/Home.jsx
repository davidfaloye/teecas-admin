import { api } from '../api.js';
import { useApp, useLoad, useOrderEvents, ErrorBox, Loading, StatusBadge } from '../ui.jsx';
import { naira, time } from '../format.js';

export default function Home() {
  const { branchId, user } = useApp();
  const { data, error, loading, reload } = useLoad(
    () => api('/analytics/today', { query: { branchId: branchId === 'all' ? undefined : branchId } }),
    [branchId],
  );
  useOrderEvents(() => reload(true));

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const { totals, branches, recent, lowStock } = data;
  const showBranches = branches.length > 1;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid g4">
        <Stat label="Sales today" value={naira(totals.revenue)} sub={`${totals.completed} completed orders`} />
        <Stat label="In progress" value={totals.open} sub={`${naira(totals.openValue)} to collect on delivery`} />
        <Stat label="Orders today" value={totals.orders} sub={totals.cancelled ? `${totals.cancelled} cancelled` : 'None cancelled'} />
        <Stat label="Low stock" value={lowStock.length} sub={lowStock.length ? 'Items at or under reorder level' : 'Everything is stocked'} />
      </div>

      {showBranches && (
        <div className="card">
          <div className="card-head">
            <h2>Branches today</h2>
            <a href="#/analytics" className="small">
              Compare over time →
            </a>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Online orders</th>
                  <th className="r">Orders</th>
                  <th className="r">In progress</th>
                  <th className="r">Sales</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.branchId}>
                    <td>
                      <b>{b.name}</b>
                    </td>
                    <td>{b.acceptingOrders ? <span className="badge paid">Open</span> : <span className="badge cancelled">Paused</span>}</td>
                    <td className="r num">{b.orders}</td>
                    <td className="r num">{b.open}</td>
                    <td className="r num">{naira(b.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid g2">
        <div className="card flush">
          <div className="card-head" style={{ padding: '16px 18px 0' }}>
            <h2>Latest orders</h2>
            <a href="#/orders" className="small">
              Open the board →
            </a>
          </div>
          {recent.length === 0 ? (
            <div className="empty">No orders yet today. New app orders show up here the moment they're placed.</div>
          ) : (
            <div className="table-wrap">
            <table className="t">
              <tbody>
                {recent.map((o) => (
                  <tr key={o._id} className="click" onClick={() => (window.location.hash = '#/orders')}>
                    <td className="num">#{o.number}</td>
                    <td>
                      {o.customer.name}
                      <div className="muted small">
                        {time(o.createdAt)}
                        {showBranches ? ` · ${o.branchName}` : ''}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="r num">{naira(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div className="card flush">
          <div className="card-head" style={{ padding: '16px 18px 0' }}>
            <h2>Running low</h2>
            <a href="#/inventory" className="small">
              Inventory →
            </a>
          </div>
          {lowStock.length === 0 ? (
            <div className="empty">Nothing is under its reorder level.</div>
          ) : (
            <table className="t">
              <tbody>
                {lowStock.map((i) => (
                  <tr key={i._id}>
                    <td>
                      {i.name}
                      {showBranches && user.role === 'owner' && <div className="muted small">{i.branchName}</div>}
                    </td>
                    <td className="r">
                      <span className="badge low num">
                        {i.qty} {i.unit}
                      </span>
                    </td>
                    <td className="r muted small">reorder at {i.reorderLevel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
