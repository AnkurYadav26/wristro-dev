import { useEffect, useState } from 'react';
import { api } from '../../api';
import { inr, toPaise, toRupees, formatDate } from '../../format';

const BLANK = {
  code: '', description: '', discountPercent: '10', active: true,
  startsAt: '', expiresAt: '', minOrderRupees: '', maxDiscountRupees: '',
  usageLimit: '', perCustomerLimit: '',
};

const toIso = (local) => (local ? new Date(local).toISOString() : null);
const numOrNull = (v) => (String(v).trim() === '' ? null : Number(v));

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => setCoupons((await api('GET', '/admin/coupons')).coupons || []);
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const reset = () => { setForm(BLANK); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    const body = {
      description: form.description || '',
      discountPercent: Number(form.discountPercent),
      active: !!form.active,
      startsAt: toIso(form.startsAt),
      expiresAt: toIso(form.expiresAt),
      minOrderValuePaise: form.minOrderRupees === '' ? 0 : toPaise(form.minOrderRupees),
      maxDiscountPaise: form.maxDiscountRupees === '' ? null : toPaise(form.maxDiscountRupees),
      usageLimit: numOrNull(form.usageLimit),
      perCustomerLimit: numOrNull(form.perCustomerLimit),
    };
    if (!editingId) body.code = form.code.trim().toUpperCase();

    try {
      if (editingId) await api('PATCH', `/admin/coupons/${editingId}`, { body });
      else await api('POST', '/admin/coupons', { body });
      setNotice(editingId ? 'Coupon updated.' : 'Coupon created.');
      reset();
      await load();
    } catch (err) { setError(err.message); }
  };

  const edit = (c) => {
    setEditingId(c._id);
    setForm({
      code: c.code || '', description: c.description || '',
      discountPercent: String(c.discountPercent ?? ''),
      active: c.active !== false,
      startsAt: c.startsAt ? new Date(c.startsAt).toISOString().slice(0, 16) : '',
      expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 16) : '',
      minOrderRupees: c.minOrderValuePaise ? String(toRupees(c.minOrderValuePaise)) : '',
      maxDiscountRupees: c.maxDiscountPaise != null ? String(toRupees(c.maxDiscountPaise)) : '',
      usageLimit: c.usageLimit != null ? String(c.usageLimit) : '',
      perCustomerLimit: c.perCustomerLimit != null ? String(c.perCustomerLimit) : '',
    });
  };

  const remove = async (c) => {
    setError('');
    setNotice('');
    try {
      const r = await api('DELETE', `/admin/coupons/${c._id}`);
      setNotice(r.deactivated ? r.message : 'Coupon deleted.');
      await load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <h2>Coupons</h2>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <form className="panel mb" onSubmit={submit}>
        <h3>{editingId ? `Edit coupon ${form.code}` : 'New coupon'}</h3>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>Code *</span>
            <input value={form.code} onChange={set('code')} required={!editingId} disabled={!!editingId} maxLength={30} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Discount % *</span>
            <input type="number" min="1" max="90" value={form.discountPercent} onChange={set('discountPercent')} required />
          </label>
          <label style={{ flex: 2 }}>
            <span>Description</span>
            <input value={form.description} onChange={set('description')} maxLength={300} />
          </label>
        </div>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>Starts at</span>
            <input type="datetime-local" value={form.startsAt} onChange={set('startsAt')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Expires at</span>
            <input type="datetime-local" value={form.expiresAt} onChange={set('expiresAt')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Min order ₹</span>
            <input type="number" min="0" value={form.minOrderRupees} onChange={set('minOrderRupees')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Max discount ₹</span>
            <input type="number" min="0" value={form.maxDiscountRupees} onChange={set('maxDiscountRupees')} />
          </label>
        </div>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>Usage limit</span>
            <input type="number" min="1" value={form.usageLimit} onChange={set('usageLimit')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Per-customer limit</span>
            <input type="number" min="1" value={form.perCustomerLimit} onChange={set('perCustomerLimit')} />
          </label>
          <label className="row" style={{ gap: 8, alignSelf: 'flex-end' }}>
            <input type="checkbox" checked={form.active} onChange={set('active')} />
            <span>Active</span>
          </label>
        </div>
        <div className="row">
          <button className="btn" type="submit">{editingId ? 'Save changes' : 'Create coupon'}</button>
          {editingId && <button className="btn secondary" type="button" onClick={reset}>Cancel</button>}
        </div>
      </form>

      <table>
        <thead>
          <tr><th>Code</th><th>Discount</th><th>Min order</th><th>Used</th><th>Window</th><th>Active</th><th /></tr>
        </thead>
        <tbody>
          {coupons.map((c) => (
            <tr key={c._id}>
              <td><strong>{c.code}</strong><div className="muted small">{c.description}</div></td>
              <td>{c.discountPercent}%{c.maxDiscountPaise != null ? <div className="muted small">max {inr(c.maxDiscountPaise)}</div> : null}</td>
              <td>{inr(c.minOrderValuePaise)}</td>
              <td>{c.usedCount}{c.usageLimit != null ? ` / ${c.usageLimit}` : ''}</td>
              <td className="small muted">
                {c.startsAt ? formatDate(c.startsAt) : 'any'} → {c.expiresAt ? formatDate(c.expiresAt) : 'any'}
              </td>
              <td>{c.active ? 'Yes' : 'No'}</td>
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
