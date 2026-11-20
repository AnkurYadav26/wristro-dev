import { useEffect, useState } from 'react';
import { api } from '../../api';

const BLANK = {
  name: '', companyName: '', contactPerson: '', phone: '', email: '', gstin: '',
  line1: '', line2: '', city: '', state: '', pincode: '', notes: '', isActive: true,
};

export default function AdminSuppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => setSuppliers((await api('GET', '/admin/suppliers')).suppliers || []);
  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const reset = () => { setForm(BLANK); setEditingId(null); };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    const body = { name: form.name.trim(), isActive: !!form.isActive };
    if (form.companyName.trim()) body.companyName = form.companyName.trim();
    if (form.contactPerson.trim()) body.contactPerson = form.contactPerson.trim();
    if (form.phone.trim()) body.phone = form.phone.trim();
    if (form.email.trim()) body.email = form.email.trim();
    if (form.gstin.trim()) body.gstin = form.gstin.trim();
    if (form.notes.trim()) body.notes = form.notes.trim();

    const address = {};
    if (form.line1.trim()) address.line1 = form.line1.trim();
    if (form.line2.trim()) address.line2 = form.line2.trim();
    if (form.city.trim()) address.city = form.city.trim();
    if (form.state.trim()) address.state = form.state.trim();
    if (form.pincode.trim()) address.pincode = form.pincode.trim();
    if (Object.keys(address).length) body.address = address;

    try {
      if (editingId) await api('PATCH', `/admin/suppliers/${editingId}`, { body });
      else await api('POST', '/admin/suppliers', { body });
      setNotice(editingId ? 'Supplier updated.' : 'Supplier created.');
      reset();
      await load();
    } catch (err) { setError(err.message); }
  };

  const edit = (s) => {
    setEditingId(s._id);
    setForm({
      name: s.name || '', companyName: s.companyName || '', contactPerson: s.contactPerson || '',
      phone: s.phone || '', email: s.email || '', gstin: s.gstin || '',
      line1: s.address?.line1 || '', line2: s.address?.line2 || '', city: s.address?.city || '',
      state: s.address?.state || '', pincode: s.address?.pincode || '',
      notes: s.notes || '', isActive: s.isActive !== false,
    });
  };

  const remove = async (s) => {
    setError('');
    setNotice('');
    try {
      const r = await api('DELETE', `/admin/suppliers/${s._id}`);
      setNotice(r.deactivated ? r.message : 'Supplier deleted.');
      await load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <h2>Suppliers</h2>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <form className="panel mb" onSubmit={submit}>
        <h3>{editingId ? 'Edit supplier' : 'New supplier'}</h3>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>Name *</span>
            <input value={form.name} onChange={set('name')} required minLength={2} maxLength={120} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Company name</span>
            <input value={form.companyName} onChange={set('companyName')} maxLength={160} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Contact person</span>
            <input value={form.contactPerson} onChange={set('contactPerson')} maxLength={80} />
          </label>
        </div>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>Phone</span>
            <input value={form.phone} onChange={set('phone')} maxLength={20} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Email</span>
            <input type="email" value={form.email} onChange={set('email')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>GSTIN</span>
            <input value={form.gstin} onChange={set('gstin')} maxLength={15} />
          </label>
        </div>
        <div className="row wrap">
          <label style={{ flex: 2 }}>
            <span>Address line 1</span>
            <input value={form.line1} onChange={set('line1')} />
          </label>
          <label style={{ flex: 2 }}>
            <span>Address line 2</span>
            <input value={form.line2} onChange={set('line2')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>City</span>
            <input value={form.city} onChange={set('city')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>State</span>
            <input value={form.state} onChange={set('state')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>PIN code</span>
            <input value={form.pincode} onChange={set('pincode')} maxLength={6} />
          </label>
        </div>
        <label>
          <span>Notes</span>
          <textarea value={form.notes} onChange={set('notes')} maxLength={1000} />
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={form.isActive} onChange={set('isActive')} />
          <span>Active</span>
        </label>
        <div className="row">
          <button className="btn" type="submit">{editingId ? 'Save changes' : 'Create supplier'}</button>
          {editingId && <button className="btn secondary" type="button" onClick={reset}>Cancel</button>}
        </div>
      </form>

      <table>
        <thead>
          <tr><th>Name</th><th>Contact</th><th>GSTIN</th><th>City</th><th>Active</th><th /></tr>
        </thead>
        <tbody>
          {suppliers.map((s) => (
            <tr key={s._id}>
              <td>{s.name}<div className="muted small">{s.companyName}</div></td>
              <td className="small">{s.contactPerson}<div className="muted">{s.phone} {s.email}</div></td>
              <td className="small">{s.gstin || '—'}</td>
              <td className="small">{s.address?.city || '—'}</td>
              <td>{s.isActive ? 'Yes' : 'No'}</td>
              <td>
                <div className="row">
                  <button className="btn secondary small" onClick={() => edit(s)}>Edit</button>
                  <button className="btn danger small" onClick={() => remove(s)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
