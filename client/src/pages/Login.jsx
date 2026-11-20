import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login, verifyAdminLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('credentials'); // 'credentials' | 'otp' (admins only)
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submitPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await login(email.trim(), password);
      // Admins are asked for an emailed one-time code before the session is created.
      if (res?.otpRequired) {
        setStep('otp');
        setOtp('');
        setNotice(res.message || 'Enter the 6-digit code we emailed you.');
        return;
      }
      navigate(from, { replace: true });
    } catch (err) {
      if (err.code === 'EMAIL_NOT_VERIFIED') {
        navigate('/verify-email', { state: { email: err.details?.email || email.trim() } });
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await verifyAdminLogin(email.trim(), otp.trim());
      // Admins always land in the admin panel, never the storefront.
      navigate(from.startsWith('/admin') ? from : '/admin', { replace: true });
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
      const r = await api('POST', '/auth/resend-otp', { body: { email: email.trim(), purpose: 'admin_login' } });
      setNotice(r.message);
    } catch (err) {
      setError(err.message);
    }
  };

  if (step === 'otp') {
    return (
      <div className="page" style={{ maxWidth: 420 }}>
        <h1>Admin verification</h1>
        <p className="muted">For security, admin sign-in always needs a one-time code sent to your email.</p>
        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert ok">{notice}</div>}

        <form className="panel" onSubmit={submitOtp}>
          <label>
            <span>Email</span>
            <input type="email" value={email} readOnly />
          </label>
          <label>
            <span>6-digit code</span>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
              autoFocus
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
            />
          </label>
          <div className="row">
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify & sign in'}</button>
            <button className="btn secondary" type="button" onClick={resend} disabled={busy}>Resend code</button>
          </div>
        </form>

        <p className="small mt">
          <button
            type="button"
            onClick={() => { setStep('credentials'); setError(''); setNotice(''); }}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', font: 'inherit' }}
          >
            Back
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <h1>Log in</h1>
      {error && <div className="alert error">{error}</div>}

      <form className="panel" onSubmit={submitPassword}>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>

      <p className="small mt">
        <Link to="/forgot-password">Forgot password?</Link> · New here? <Link to="/register">Create an account</Link>
      </p>
    </div>
  );
}
