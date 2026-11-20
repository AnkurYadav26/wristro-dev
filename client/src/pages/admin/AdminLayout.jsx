import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="admin-root">
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <Link to="/admin" className="admin-brand">
            WRISTORA <span>Admin</span>
          </Link>
          <div className="admin-topbar-actions">
            {user?.name && <span className="admin-user">{user.name}</span>}
            <a className="admin-store-link" href="/" target="_blank" rel="noreferrer">View store ↗</a>
            <button type="button" className="admin-logout" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </header>

      <div className="admin-shell">
        <aside className="admin-nav">
          <NavLink to="/admin" end>Dashboard</NavLink>
          <NavLink to="/admin/orders">Orders</NavLink>
          <NavLink to="/admin/products">Products</NavLink>
          <NavLink to="/admin/categories">Categories</NavLink>
          <NavLink to="/admin/inventory">Inventory</NavLink>
          <NavLink to="/admin/purchase-orders">Purchase orders</NavLink>
          <NavLink to="/admin/suppliers">Suppliers</NavLink>
          <NavLink to="/admin/coupons">Coupons</NavLink>
          <NavLink to="/admin/account">My account &amp; password</NavLink>
        </aside>
        <section className="admin-main">
          <Outlet />
        </section>
      </div>
    </div>
  );
}
