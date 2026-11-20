import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({
    email: location.state?.email || '',
    otp: '',
    newPassword: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('POST', '/auth/reset-password', {
        body: { email: form.email.trim(), otp: form.otp.trim(), newPassword: form.newPassword },
      });
      navigate('/login', { replace: true, state: { from: '/' } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <h1>Reset password</h1>
      {error && <div className="alert error">{error}</div>}

      <form className="panel" onSubmit={submit}>
        <label>
          <span>Email</span>
          <input type="email" value={form.email} onChange={set('email')} required />
        </label>
        <label>
          <span>Reset code</span>
          <input value={form.otp} onChange={set('otp')} required inputMode="numeric" maxLength={6} />
        </label>
        <label>
          <span>New password (min 10 chars, letters + numbers)</span>
          <input type="password" value={form.newPassword} onChange={set('newPassword')} required minLength={10} />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
      </form>

      <p className="small mt"><Link to="/login">Back to login</Link></p>
    </div>
  );
}
