import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function VerifyEmail() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || '');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api('POST', '/auth/verify-email', { body: { email: email.trim(), otp: otp.trim() } });
      setUser(r.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    setNotice('');
    try {
      const r = await api('POST', '/auth/resend-otp', { body: { email: email.trim(), purpose: 'verify_email' } });
      setNotice(r.message);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <h1>Verify your email</h1>
      <p className="muted">Enter the 6-digit code we emailed you.</p>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <form className="panel" onSubmit={submit}>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          <span>6-digit code</span>
          <input value={otp} onChange={(e) => setOtp(e.target.value)} required inputMode="numeric" maxLength={6} />
        </label>
        <div className="row">
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
          <button className="btn secondary" type="button" onClick={resend} disabled={!email.trim()}>Resend code</button>
        </div>
      </form>

      <p className="small mt"><Link to="/login">Back to login</Link></p>
    </div>
  );
}
