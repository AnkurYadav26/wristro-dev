import { useEffect, useState } from 'react';
import { api } from '../api';

const BLANK = {
  fullName: '', mobile: '', alternateMobile: '', pincode: '', houseNo: '', buildingName: '',
  street: '', landmark: '', city: '', district: '', state: '', isDefault: false,
};

/** Create/edit a delivery address. PIN lookup auto-fills city/district/state. */
export default function AddressForm({ initial, onSaved, onCancel }) {
  const id = initial?._id || initial?.id || null;
  const [form, setForm] = useState({ ...BLANK, ...(initial || {}) });
  const [meta, setMeta] = useState({ states: [], unionTerritories: [] });
  const [pin, setPin] = useState(null);
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('GET', '/meta/states').then(setMeta).catch(() => {});
  }, []);

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const lookupPin = async (value) => {
    if (!/^[1-9]\d{5}$/.test(value)) { setPin(null); return; }
    try {
      const r = await api('GET', `/pincode/${value}`);
      setPin(r);
      if (r.found) {
        setForm((f) => ({
          ...f,
          city: f.city || r.city || '',
          district: f.district || r.district || '',
          state: r.state || f.state,
        }));
      }
    } catch { setPin(null); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors([]);
    const body = {
      fullName: form.fullName, mobile: form.mobile, pincode: form.pincode, houseNo: form.houseNo,
      street: form.street, city: form.city, district: form.district, state: form.state,
    };
    if (form.alternateMobile) body.alternateMobile = form.alternateMobile;
    if (form.buildingName) body.buildingName = form.buildingName;
    if (form.landmark) body.landmark = form.landmark;
    if (form.isDefault) body.isDefault = true;

    try {
      const res = id
        ? await api('PATCH', `/addresses/${id}`, { body })
        : await api('POST', '/addresses', { body });
      onSaved(res.address, res.warnings || []);
    } catch (err) {
      setErrors(
        Array.isArray(err.details)
          ? err.details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message))
          : [err.message],
      );
    } finally {
      setSaving(false);
    }
  };

  const allStates = [...(meta.states || []), ...(meta.unionTerritories || [])];

  return (
    <form onSubmit={submit} className="panel">
      <h3>{id ? 'Edit address' : 'Add address'}</h3>

      {errors.length > 0 && (
        <div className="alert error">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errors.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      <div className="row wrap">
        <label style={{ flex: 1 }}>
          <span>Full name *</span>
          <input value={form.fullName} onChange={set('fullName')} required maxLength={80} />
        </label>
        <label style={{ flex: 1 }}>
          <span>Mobile (10 digits) *</span>
          <input value={form.mobile} onChange={set('mobile')} required inputMode="numeric" maxLength={10} />
        </label>
      </div>

      <div className="row wrap">
        <label style={{ flex: 1 }}>
          <span>Alternate mobile</span>
          <input value={form.alternateMobile} onChange={set('alternateMobile')} inputMode="numeric" maxLength={10} />
        </label>
        <label style={{ flex: 1 }}>
          <span>PIN code *</span>
          <input
            value={form.pincode}
            onChange={set('pincode')}
            onBlur={(e) => lookupPin(e.target.value.trim())}
            required
            inputMode="numeric"
            maxLength={6}
          />
        </label>
      </div>

      {pin && (
        <p className="small muted">
          {pin.found
            ? `PIN found: ${[pin.city, pin.district, pin.state].filter(Boolean).join(', ')}`
            : pin.unavailable
              ? 'PIN lookup is unavailable right now — enter the details manually.'
              : 'We could not find this PIN code. Please double-check it.'}
        </p>
      )}

      <label>
        <span>House / flat no. *</span>
        <input value={form.houseNo} onChange={set('houseNo')} required maxLength={60} />
      </label>
      <label>
        <span>Building name</span>
        <input value={form.buildingName} onChange={set('buildingName')} maxLength={100} />
      </label>
      <label>
        <span>Street / area *</span>
        <input value={form.street} onChange={set('street')} required maxLength={160} />
      </label>
      <label>
        <span>Landmark</span>
        <input value={form.landmark} onChange={set('landmark')} maxLength={100} />
      </label>

      <div className="row wrap">
        <label style={{ flex: 1 }}>
          <span>City *</span>
          <input value={form.city} onChange={set('city')} required maxLength={80} />
        </label>
        <label style={{ flex: 1 }}>
          <span>District *</span>
          <input value={form.district} onChange={set('district')} required maxLength={80} />
        </label>
      </div>

      <label>
        <span>State / UT *</span>
        <select value={form.state} onChange={set('state')} required>
          <option value="">Select state</option>
          {allStates.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={!!form.isDefault} onChange={set('isDefault')} />
        <span>Make this my default address</span>
      </label>

      <div className="row">
        <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save address'}</button>
        {onCancel && (
          <button className="btn secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        )}
      </div>
    </form>
  );
}
