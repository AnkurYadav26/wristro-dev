import { useEffect, useState } from 'react';
import { api } from '../../api';

const BLANK = { name: '', description: '', image: '', sortOrder: 0, isActive: true };

export default function AdminCategories() {
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => setCategories((await api('GET', '/admin/categories')).categories || []);

  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const reset = () => { setForm(BLANK); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    const body = { name: form.name.trim(), sortOrder: Number(form.sortOrder) || 0, isActive: !!form.isActive };
    if (form.description.trim()) body.description = form.description.trim();
    if (form.image.trim()) body.image = form.image.trim();
    try {
      if (editingId) await api('PATCH', `/admin/categories/${editingId}`, { body });
      else await api('POST', '/admin/categories', { body });
      setNotice(editingId ? 'Category updated.' : 'Category created.');
      reset();
      await load();
    } catch (err) { setError(err.message); }
  };

  const edit = (c) => {
    setEditingId(c._id);
    setForm({
      name: c.name || '', description: c.description || '', image: c.image || '',
      sortOrder: c.sortOrder ?? 0, isActive: c.isActive !== false,
    });
  };

  const remove = async (c) => {
    setError('');
    setNotice('');
    try {
      await api('DELETE', `/admin/categories/${c._id}`);
      setNotice('Category deleted.');
      await load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <h2>Categories</h2>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <form className="panel mb" onSubmit={submit}>
        <h3>{editingId ? 'Edit category' : 'New category'}</h3>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>Name *</span>
            <input value={form.name} onChange={set('name')} required minLength={2} maxLength={60} />
          </label>
          <label style={{ width: 140 }}>
            <span>Sort order</span>
            <input type="number" value={form.sortOrder} onChange={set('sortOrder')} />
          </label>
        </div>
        <label>
          <span>Description</span>
          <input value={form.description} onChange={set('description')} maxLength={300} />
        </label>
        <label>
          <span>Image URL</span>
          <input value={form.image} onChange={set('image')} placeholder="https://…" />
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={form.isActive} onChange={set('isActive')} />
          <span>Active</span>
        </label>
        <div className="row">
          <button className="btn" type="submit">{editingId ? 'Save changes' : 'Create category'}</button>
          {editingId && <button className="btn secondary" type="button" onClick={reset}>Cancel</button>}
        </div>
      </form>

      <table>
        <thead>
          <tr><th>Name</th><th>Slug</th><th>Order</th><th>Active</th><th /></tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c._id}>
              <td>{c.name}</td>
              <td className="muted small">{c.slug}</td>
              <td>{c.sortOrder}</td>
              <td>{c.isActive ? 'Yes' : 'No'}</td>
              <td>
                <div className="row">
                  <button className="btn secondary small" onClick={() => edit(c)}>Edit</button>
                  <button className="btn danger small" onClick={() => remove(c)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
