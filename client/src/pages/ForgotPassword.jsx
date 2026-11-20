import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api('POST', '/auth/forgot-password', { body: { email: email.trim() } });
      setNotice(r.message);
      navigate('/reset-password', { state: { email: email.trim() } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <h1>Forgot password</h1>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <form className="panel" onSubmit={submit}>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset code'}</button>
      </form>

      <p className="small mt"><Link to="/login">Back to login</Link></p>
    </div>
  );
}
