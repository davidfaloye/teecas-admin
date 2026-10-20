import { useState } from 'react';
import { api } from '../api.js';
import { useApp, useLoad, ErrorBox, Loading, ColumnChart, HBars } from '../ui.jsx';
import { naira, compactNaira, shortDate, weekday, todayKey, addDays, pct } from '../format.js';

const RANGES = [
  ['7', 'Last 7 days'],
  ['14', 'Last 14 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
];

function csv(rows) {
  return rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n');
}

export default function Analytics() {
  const { branchId, user } = useApp();
  const [days, setDays] = useState('14');
  const [showTable, setShowTable] = useState(false);
  const to = todayKey();
  const from = addDays(to, -(Number(days) - 1));
  const scopeQ = branchId === 'all' ? undefined : branchId;
  const { data, error, loading, reload } = useLoad(() => api('/analytics', { query: { from, to, branchId: scopeQ } }), [from, to, scopeQ]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const { totals, previous, byDay, byBranch, topItems, byHour, byFulfilment } = data;
  const allBranches = !scopeQ && user.role === 'owner';
  const labelEvery = byDay.length > 31 ? 7 : byDay.length > 14 ? 3 : 1;

  function download() {
    const rows = [['Date', 'Completed orders', 'Sales (NGN)'], ...byDay.map((d) => [d.date, d.orders, d.revenue])];
    const blob = new Blob([csv(rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `teecas-sales-${from}-to-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const totalHourOrders = byHour.reduce((s, h) => s + h.orders, 0);
  const peak = byHour.reduce((m, h) => (h.orders > m.orders ? h : m), byHour[0]);
  const fulfil = byFulfilment.delivery + byFulfilment.pickup;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="spread">
        <div className="seg">
          {RANGES.map(([v, l]) => (
            <button key={v} className={days === v ? 'on' : ''} onClick={() => setDays(v)}>
              {l}
            </button>
          ))}
        </div>
        <button className="btn sm" onClick={download}>
          Download CSV
        </button>
      </div>

      <div className="grid g4">
        <Kpi label="Sales" value={naira(totals.revenue)} now={totals.revenue} before={previous.revenue} />
        <Kpi label="Completed orders" value={totals.completed} now={totals.completed} before={previous.completed} />
        <Kpi label="Average order" value={naira(totals.avgOrder)} now={totals.avgOrder} before={previous.avgOrder} />
        <div className="card stat">
          <div className="label">Cancelled</div>
          <div className="value">{totals.cancelled}</div>
          <div className="sub">{totals.orders ? `${Math.round((totals.cancelled / totals.orders) * 100)}% of ${totals.orders} orders` : 'No orders'}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Sales by day</h2>
            <p className="muted small">
              Completed orders, {shortDate(from)} – {shortDate(to)}
            </p>
          </div>
          <button className="btn sm ghost" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
            {showTable ? 'Hide table' : 'Show as table'}
          </button>
        </div>
        <ColumnChart
          data={byDay.map((d) => ({
            key: d.date,
            label: byDay.length <= 14 ? weekday(d.date) : shortDate(d.date),
            value: d.revenue,
            tip: (
              <>
                {weekday(d.date)} {shortDate(d.date)} · <span className="mono">{naira(d.revenue)}</span> · {d.orders} orders
              </>
            ),
          }))}
          labelEvery={labelEvery}
        />
        {showTable && (
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="r">Orders</th>
                  <th className="r">Sales</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((d) => (
                  <tr key={d.date}>
                    <td>
                      {weekday(d.date)} {shortDate(d.date)}
                    </td>
                    <td className="r num">{d.orders}</td>
                    <td className="r num">{naira(d.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid g2">
        {allBranches && (
          <div className="card">
            <div className="card-head">
              <h2>Sales by branch</h2>
            </div>
            <HBars
              rows={byBranch.map((b) => ({
                key: b.branchId,
                name: b.name,
                value: b.revenue,
                display: `${compactNaira(b.revenue)} · ${b.completed}`,
                title: `${b.name}: ${naira(b.revenue)} from ${b.completed} orders, ${b.cancelled} cancelled`,
              }))}
            />
            <p className="muted small" style={{ marginTop: 12 }}>
              Sales · completed orders
            </p>
          </div>
        )}
        <div className="card">
          <div className="card-head">
            <h2>Best sellers</h2>
            <span className="muted small">by sales</span>
          </div>
          {topItems.length ? (
            <HBars rows={topItems.map((i) => ({ key: i.name, name: i.name, value: i.revenue, display: `${compactNaira(i.revenue)} · ${i.qty} sold`, title: `${i.name}: ${i.qty} sold, ${naira(i.revenue)}` }))} />
          ) : (
            <div className="empty">No completed orders in this range.</div>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Busiest hours</h2>
              <p className="muted small">{totalHourOrders ? `Peak: ${fmtHour(peak.hour)} to ${fmtHour((peak.hour + 1) % 24)}` : 'No orders yet'}</p>
            </div>
          </div>
          <ColumnChart
            height={170}
            format={(v) => String(Math.round(v))}
            data={byHour.slice(7, 23).map((h) => ({ key: h.hour, label: fmtHour(h.hour, true), value: h.orders, tip: `${fmtHour(h.hour)} · ${h.orders} orders` }))}
            labelEvery={2}
          />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Delivery or pickup</h2>
          </div>
          <HBars
            rows={[
              { key: 'd', name: 'Delivery', value: byFulfilment.delivery, display: `${byFulfilment.delivery} · ${fulfil ? Math.round((byFulfilment.delivery / fulfil) * 100) : 0}%` },
              { key: 'p', name: 'Pickup', value: byFulfilment.pickup, display: `${byFulfilment.pickup} · ${fulfil ? Math.round((byFulfilment.pickup / fulfil) * 100) : 0}%` },
            ]}
          />
          <p className="muted small" style={{ marginTop: 12 }}>
            Orders not cancelled, all paid on delivery or at pickup.
          </p>
        </div>
      </div>
    </div>
  );
}

function fmtHour(h, short) {
  const ap = h < 12 ? 'am' : 'pm';
  const hr = h % 12 || 12;
  return short ? `${hr}${ap[0]}` : `${hr}${ap}`;
}

function Kpi({ label, value, now, before }) {
  const d = pct(now, before);
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="sub">
        {d === null ? (
          'No earlier period to compare'
        ) : (
          <>
            <span className={`delta ${d >= 0 ? 'up' : 'down'}`}>
              {d >= 0 ? '▲' : '▼'} {Math.abs(d)}%
            </span>{' '}
            vs the period before
          </>
        )}
      </div>
    </div>
  );
}
