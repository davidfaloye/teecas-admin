import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { STATUS_LABEL, compactNaira } from './format.js';

// ---------- app context ----------

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// ---------- data loading ----------

export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const reload = useCallback(
    async (quiet = false) => {
      const n = ++seq.current;
      if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await fn();
        if (n === seq.current) setState({ data, error: null, loading: false });
      } catch (e) {
        if (n === seq.current) setState((s) => ({ ...s, error: e.message, loading: false }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

// Re-run `fn` whenever an order event arrives.
export function useOrderEvents(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (e) => ref.current(e.type.replace('teecas:', ''), e.detail);
    window.addEventListener('teecas:order.created', h);
    window.addEventListener('teecas:order.updated', h);
    return () => {
      window.removeEventListener('teecas:order.created', h);
      window.removeEventListener('teecas:order.updated', h);
    };
  }, []);
}

// ---------- small components ----------

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span>
        {label} {hint && <span className="hint">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <span className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </span>
  );
}

export const StatusBadge = ({ status }) => <span className={`badge ${status}`}>{STATUS_LABEL[status] || status}</span>;

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="error-box spread">
      <span>{error}</span>
      {onRetry && (
        <button className="btn sm" onClick={() => onRetry()}>
          Try again
        </button>
      )}
    </div>
  );
}

export const Loading = () => <div className="empty">Loading…</div>;

const PATHS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  menu: 'M4 6h16M4 12h16M4 18h10',
  stock: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-7',
  branch: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  team: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  bars: 'M4 7h16M4 12h16M4 17h16',
  out: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  wa: 'M4 20l1.3-4A8 8 0 1 1 8 18.7zM9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1a4 4 0 0 1-2-2l1-1-1-2z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0',
  key: 'M14 10a4 4 0 1 0-4 4l-6 6v-3h3v-3h3',
};

export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

// ---------- charts (single series, one hue) ----------

// Column chart with a hover tooltip. `data` = [{ key, label, value, tip }].
export function ColumnChart({ data, height = 200, format = compactNaira, labelEvery = 1 }) {
  const [hot, setHot] = useState(null);
  const box = useRef(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;
  const pad = { l: 48, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = niceMax(max);
  const ticks = [0, nice / 2, nice];
  const bw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const barW = Math.min(24, bw - 2);
  // Thin out the x labels so they never collide on narrow screens.
  const every = Math.max(labelEvery, Math.ceil(34 / bw));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  return (
    <div className="chart" ref={box} onMouseLeave={() => setHot(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Column chart">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text className="axis-text" x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * bw + (bw - barW) / 2;
          const top = y(d.value);
          const h = Math.max(0, H - pad.b - top);
          const r = Math.min(4, h / 2, barW / 2);
          return (
            <g key={d.key}>
              <rect className="hit" x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} onMouseEnter={() => setHot(i)} onFocus={() => setHot(i)} tabIndex={-1} />
              {h > 0 && (
                <path
                  className={`bar ${hot === i ? 'hot' : ''}`}
                  d={`M${x},${H - pad.b} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${H - pad.b} Z`}
                  pointerEvents="none"
                />
              )}
              {i % every === 0 && (
                <text className="axis-text" x={x + barW / 2} y={H - 8} textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hot !== null && data[hot] && (
        <div className="tip" style={{ left: `${((pad.l + hot * bw + bw / 2) / W) * 100}%`, top: `${(y(data[hot].value) / H) * 100}%` }}>
          {data[hot].tip}
        </div>
      )}
    </div>
  );
}

function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10;
  return step * p;
}

// Horizontal bars with the value at the tip. `rows` = [{ key, name, value, display, title }].
export function HBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div className="hbar" key={r.key} title={r.title}>
          <span className="name">{r.name}</span>
          <span className="track">
            <span className="fill" style={{ display: 'block', width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="num small">{r.display}</span>
        </div>
      ))}
    </div>
  );
}
