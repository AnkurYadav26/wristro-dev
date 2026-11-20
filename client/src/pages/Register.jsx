import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', mobile: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...form, email: form.email.trim() };
      const r = await api('POST', '/auth/register', { body });
      navigate('/verify-email', { state: { email: r.email || body.email } });
    } catch (err) {
      setError(
        Array.isArray(err.details)
          ? err.details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message)).join(' · ')
          : err.message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 460 }}>
      <h1>Create an account</h1>
      {error && <div className="alert error">{error}</div>}

      <form className="panel" onSubmit={submit}>
        <label>
          <span>Full name</span>
          <input value={form.name} onChange={set('name')} required minLength={2} maxLength={80} />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={form.email} onChange={set('email')} required />
        </label>
        <label>
          <span>Mobile (10 digits)</span>
          <input value={form.mobile} onChange={set('mobile')} required inputMode="numeric" maxLength={10} />
        </label>
        <label>
          <span>Password (min 10 chars, letters + numbers)</span>
          <input type="password" value={form.password} onChange={set('password')} required minLength={10} />
        </label>
        <label>
          <span>Confirm password</span>
          <input type="password" value={form.confirmPassword} onChange={set('confirmPassword')} required />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>

      <p className="small mt">Already have an account? <Link to="/login">Log in</Link></p>
    </div>
  );
}
