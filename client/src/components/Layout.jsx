import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';

// TODO: swap in the real support address when you have it — everything below reads from here.
const CONTACT_EMAIL = 'abc@gmail.com';

export default function Layout() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const onSearch = (e) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/products?q=${encodeURIComponent(term)}` : '/products');
  };

  const onLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <>
      <header className="site-header">
        <div className="container header-row">
          <Link to="/" className="brand">WRISTORA</Link>

          <form className="search" onSubmit={onSearch}>
            <input
              type="search"
              placeholder="Search watches, brands…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search products"
            />
            <button type="submit">Search</button>
          </form>

          <nav className="main-nav">
            <NavLink to="/products">Shop</NavLink>
            <NavLink to="/cart">Cart{count > 0 ? ` (${count})` : ''}</NavLink>
            {user ? (
              <>
                <NavLink to="/orders">My Orders</NavLink>
                <NavLink to="/account">{user.name?.split(' ')[0] || 'Account'}</NavLink>
                <button type="button" className="link-btn" onClick={onLogout}>Logout</button>
              </>
            ) : (
              <NavLink to="/login">Login</NavLink>
            )}
          </nav>
        </div>
      </header>

      <main className="container">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="container footer-grid">
          <div className="footer-col">
            <Link to="/" className="footer-brand">WRISTORA</Link>
            <p className="muted small">
              Curated authentic watches, delivered across India. Every piece is quality-checked
              before it ships and backed by our warranty and returns promise.
            </p>
          </div>

          <nav className="footer-col">
            <h4>Shop</h4>
            <Link to="/products">All watches</Link>
            <Link to="/cart">Your cart</Link>
            <Link to="/orders">My orders</Link>
            <Link to="/account">My account</Link>
          </nav>

          <nav className="footer-col">
            <h4>Support</h4>
            <a href={`mailto:${CONTACT_EMAIL}`}>Contact us</a>
            <Link to="/login">Sign in</Link>
            <Link to="/register">Create account</Link>
          </nav>

          <div className="footer-col">
            <h4>Contact</h4>
            <p className="small">
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
            <p className="muted small">Mon–Sat, 10:00–18:00 IST</p>
          </div>
        </div>

        <div className="container footer-bottom">
          <span>© {new Date().getFullYear()} WRISTORA — watches delivered across India.</span>
          <span>Prices in ₹, inclusive of GST.</span>
        </div>
      </footer>
    </>
  );
}
