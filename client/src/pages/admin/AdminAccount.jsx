import ChangePasswordForm from '../../components/ChangePasswordForm';
import { useAuth } from '../../context/AuthContext';

export default function AdminAccount() {
  const { user } = useAuth();

  return (
    <div>
      <h2>My account</h2>

      <div className="panel mb">
        <h3>Profile</h3>
        <p><strong>{user?.name}</strong></p>
        <p className="muted small">
          {user?.email} · {user?.role}
          {user?.emailVerified ? ' · email verified' : ''}
        </p>
      </div>

      <ChangePasswordForm />
    </div>
  );
}
