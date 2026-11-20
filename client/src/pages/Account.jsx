import { useEffect, useState } from 'react';
import { api } from '../api';
import AddressForm from '../components/AddressForm';
import ChangePasswordForm from '../components/ChangePasswordForm';
import { useAuth } from '../context/AuthContext';

export default function Account() {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState([]);
  const [editing, setEditing] = useState(null); // address object or 'new'
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    const r = await api('GET', '/addresses');
    setAddresses(r.addresses || []);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  const onSaved = async (addr, warnings) => {
    setEditing(null);
    setNotice(warnings?.length ? warnings.join(' ') : 'Address saved.');
    await load();
  };

  const setDefault = async (id) => {
    setError('');
    try {
      const r = await api('POST', `/addresses/${id}/default`);
      setAddresses(r.addresses || []);
    } catch (err) { setError(err.message); }
  };

  const remove = async (id) => {
    setError('');
    try {
      await api('DELETE', `/addresses/${id}`);
      await load();
      setNotice('Address removed.');
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="page">
      <h1>My account</h1>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <div className="panel mb">
        <h3>Profile</h3>
        <p><strong>{user?.name}</strong></p>
        <p className="muted small">
          {user?.email} · {user?.mobile || 'no mobile'} ·{' '}
          {user?.emailVerified ? 'email verified' : 'email not verified'}
        </p>
      </div>

      <ChangePasswordForm />

      <div className="row between mb">
        <h2>Delivery addresses</h2>
        {!editing && (
          <button className="btn small" onClick={() => { setNotice(''); setEditing('new'); }}>Add address</button>
        )}
      </div>

      {editing && (
        <div className="mb">
          <AddressForm
            initial={editing === 'new' ? null : editing}
            onSaved={onSaved}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {addresses.length === 0 && !editing ? (
        <p className="muted">No addresses saved yet.</p>
      ) : (
        <div className="stat-grid">
          {addresses.map((a) => (
            <div key={a._id} className="stat">
              <div className="row between">
                <strong>{a.fullName}</strong>
                {a.isDefault && <span className="small">default</span>}
              </div>
              <p className="small muted">
                {[a.houseNo, a.buildingName, a.street, a.landmark].filter(Boolean).join(', ')}<br />
                {a.city}, {a.district}, {a.state} — {a.pincode}<br />
                Mobile: {a.mobile}
                {a.pinVerified ? ' · PIN verified' : ''}
              </p>
              <div className="row wrap">
                <button className="btn secondary small" onClick={() => setEditing(a)}>Edit</button>
                {!a.isDefault && <button className="btn secondary small" onClick={() => setDefault(a._id)}>Set default</button>}
                <button className="btn danger small" onClick={() => remove(a._id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
