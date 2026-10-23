import { useState } from 'react';
import { api } from '../api.js';
import { useApp, useLoad, ErrorBox, Loading, Modal, Field, Switch, Icon } from '../ui.jsx';
import { naira } from '../format.js';

export default function Menu() {
  const { user, branches, branchId, notify } = useApp();
  const { data, error, loading, reload, setData } = useLoad(() => api('/menu'), []);
  const [editing, setEditing] = useState(null); // item object or {} for new
  const [catEditing, setCatEditing] = useState(null);
  const [q, setQ] = useState('');
  const isOwner = user.role === 'owner';
  // Which branches' sold-out switches to show.
  const visibleBranches = isOwner ? (branchId === 'all' ? branches : branches.filter((b) => b._id === branchId)) : branches.filter((b) => b._id === user.branchId);

  async function toggle(item, bId, available) {
    setData((d) => ({ ...d, items: d.items.map((i) => (i._id === item._id ? { ...i, unavailableBranches: available ? (i.unavailableBranches || []).filter((x) => x !== bId) : [...(i.unavailableBranches || []), bId] } : i)) }));
    try {
      const r = await api(`/menu/items/${item._id}/availability`, { method: 'PUT', body: { branchId: bId, available } });
      setData((d) => ({ ...d, items: d.items.map((i) => (i._id === item._id ? r.item : i)) }));
      const b = branches.find((x) => x._id === bId);
      notify(`${item.name} ${available ? 'is back on' : 'is sold out'} at ${b?.name}`);
    } catch (e) {
      notify(e.message, 'err');
      reload(true);
    }
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  // Search matches the dish name, its description or its category, ignoring case.
  const needle = q.trim().toLowerCase();
  const catName = Object.fromEntries(data.categories.map((c) => [c._id, c.name]));
  const matches = (i) => !needle || [i.name, i.description, catName[i.categoryId]].some((t) => (t || '').toLowerCase().includes(needle));
  const found = needle ? data.items.filter(matches).length : data.items.length;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="spread">
        <p className="dim">
          {isOwner
            ? 'Changes show in the ordering app straight away. Switch a dish off at a branch when it runs out.'
            : 'Switch a dish off when it runs out at your branch. It shows as sold out in the app.'}
        </p>
        {isOwner && (
          <div className="row">
            <button className="btn" onClick={() => setCatEditing({})}>
              <Icon name="plus" /> Category
            </button>
            <button className="btn primary" onClick={() => setEditing({ categoryId: data.categories[0]?._id, isAvailable: true })}>
              <Icon name="plus" /> Dish
            </button>
          </div>
        )}
      </div>

      <div className="row wrap" style={{ gap: 10 }}>
        <input
          className="input"
          type="search"
          style={{ maxWidth: 320 }}
          placeholder="Search dishes"
          aria-label="Search dishes"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
        />
        {needle && (
          <span className="muted small">
            {found === 0 ? 'No dishes match' : `${found} ${found === 1 ? 'dish' : 'dishes'} found`}
          </span>
        )}
      </div>

      {needle && found === 0 && (
        <div className="card empty">
          Nothing on the menu matches “{q.trim()}”.{' '}
          <button className="btn sm ghost" onClick={() => setQ('')}>
            Clear search
          </button>
        </div>
      )}

      {data.categories.map((c) => {
        const items = data.items.filter((i) => i.categoryId === c._id && matches(i));
        if (needle && items.length === 0) return null; // while searching, hide categories with no match
        return (
          <section className="card flush" key={c._id}>
            <div className="cat-title spread">
              <div className="row" style={{ alignItems: 'baseline' }}>
                <h2>{c.name}</h2>
                <small>{c.subtitle}</small>
              </div>
              {isOwner && (
                <button className="btn sm ghost" onClick={() => setCatEditing(c)}>
                  Edit
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <div className="empty">No dishes in this category yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>Dish</th>
                      <th className="r">Price</th>
                      <th>{visibleBranches.length > 1 ? 'Available at' : 'Available'}</th>
                      {isOwner && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i._id}>
                        <td>
                          <div className="row">
                            <span className="emoji">{i.emoji || '🍽️'}</span>
                            <div>
                              <b>{i.name}</b> {i.popular && <span className="chip">Popular</span>} {i.isAvailable === false && <span className="badge cancelled">Hidden everywhere</span>}
                              <div className="muted small">{i.description}</div>
                            </div>
                          </div>
                        </td>
                        <td className="r price">{naira(i.price)}</td>
                        <td>
                          <div className="avail">
                            {visibleBranches.map((b) => {
                              const on = !(i.unavailableBranches || []).includes(b._id);
                              return (
                                <label key={b._id}>
                                  <Switch checked={on} onChange={(v) => toggle(i, b._id, v)} label={`${i.name} available at ${b.name}`} />
                                  {visibleBranches.length > 1 ? b.name : on ? 'On' : 'Sold out'}
                                </label>
                              );
                            })}
                          </div>
                        </td>
                        {isOwner && (
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
              </div>
            )}
          </section>
        );
      })}

      {editing && (
        <ItemForm
          item={editing}
          categories={data.categories}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            notify(msg);
            reload(true);
          }}
        />
      )}
      {catEditing && (
        <CategoryForm
          category={catEditing}
          onClose={() => setCatEditing(null)}
          onSaved={(msg) => {
            setCatEditing(null);
            notify(msg);
            reload(true);
          }}
        />
      )}
    </div>
  );
}

function ItemForm({ item, categories, onClose, onSaved }) {
  const isNew = !item._id;
  const [f, setF] = useState({
    name: item.name || '',
    categoryId: item.categoryId || categories[0]?._id || '',
    price: item.price ?? '',
    description: item.description || '',
    emoji: item.emoji || '',
    imageUrl: item.imageUrl || '',
    popular: Boolean(item.popular),
    isAvailable: item.isAvailable !== false,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));

  async function save(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...f, price: f.price === '' ? '' : Number(f.price) };
      if (isNew) await api('/menu/items', { method: 'POST', body });
      else await api(`/menu/items/${item._id}`, { method: 'PATCH', body });
      onSaved(isNew ? `${f.name} added to the menu` : `${f.name} saved`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${item.name} from the menu? Past orders keep their record.`)) return;
    setBusy(true);
    try {
      await api(`/menu/items/${item._id}`, { method: 'DELETE' });
      onSaved(`${item.name} removed`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isNew ? 'Add a dish' : `Edit ${item.name}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove} disabled={busy}>
              Remove dish
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form className="form-grid" onSubmit={save}>
        <Field label="Name" className="full">
          <input className="input" value={f.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Category">
          <select className="input" value={f.categoryId} onChange={set('categoryId')}>
            {categories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price (₦)">
          <input className="input num" inputMode="numeric" value={f.price} onChange={(e) => set('price')(e.target.value.replace(/[^\d]/g, ''))} />
        </Field>
        <Field label="Short description" hint="shown in the app" className="full">
          <input className="input" value={f.description} onChange={set('description')} maxLength={200} />
        </Field>
        <Field label="Icon" hint="an emoji">
          <input className="input" value={f.emoji} onChange={set('emoji')} maxLength={8} />
        </Field>
        <Field label="Photo link" hint="optional, https://">
          <input className="input" value={f.imageUrl} onChange={set('imageUrl')} placeholder="https://…" />
        </Field>
        <label className="row small">
          <Switch checked={f.popular} onChange={set('popular')} label="Popular" /> Mark as popular
        </label>
        <label className="row small">
          <Switch checked={f.isAvailable} onChange={set('isAvailable')} label="Show in app" /> Show in the app
        </label>
        <button hidden />
      </form>
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}

function CategoryForm({ category, onClose, onSaved }) {
  const isNew = !category._id;
  const [name, setName] = useState(category.name || '');
  const [subtitle, setSubtitle] = useState(category.subtitle || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isNew) await api('/menu/categories', { method: 'POST', body: { name, subtitle } });
      else await api(`/menu/categories/${category._id}`, { method: 'PATCH', body: { name, subtitle } });
      onSaved(isNew ? `${name} added` : `${name} saved`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/menu/categories/${category._id}`, { method: 'DELETE' });
      onSaved(`${category.name} removed`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isNew ? 'Add a category' : `Edit ${category.name}`}
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
      <form className="stack" onSubmit={save}>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Subtitle" hint="optional">
          <input className="input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="e.g. Rich · slow-simmered" />
        </Field>
        <button hidden />
      </form>
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}
