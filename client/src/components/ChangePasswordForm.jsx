import { useState } from 'react';
import { api } from '../api';

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };

export default function ChangePasswordForm() {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api('POST', '/auth/change-password', { body: form });
      setNotice('Password updated. Other devices were signed out; you stay signed in here.');
      setForm(EMPTY);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel mb">
      <h3>Change password</h3>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}
      <form onSubmit={onSubmit}>
        <label>
          <span>Current password</span>
          <input type="password" name="currentPassword" value={form.currentPassword}
            onChange={onChange} required autoComplete="current-password" />
        </label>
        <label>
          <span>New password</span>
          <input type="password" name="newPassword" value={form.newPassword}
            onChange={onChange} required minLength={10} autoComplete="new-password" />
          <span className="muted small">At least 10 characters, with a letter and a number.</span>
        </label>
        <label>
          <span>Confirm new password</span>
          <input type="password" name="confirmPassword" value={form.confirmPassword}
            onChange={onChange} required minLength={10} autoComplete="new-password" />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
      </form>
    </div>
  );
}
