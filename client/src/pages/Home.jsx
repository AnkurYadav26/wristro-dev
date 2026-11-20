import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import ProductCard from '../components/ProductCard';

export default function Home() {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cats, prods] = await Promise.all([
          api('GET', '/categories'),
          api('GET', '/products', { query: { sort: 'newest', limit: 8 } }),
        ]);
        if (!alive) return;
        setCategories(cats.categories || []);
        setProducts(prods.products || []);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-text">
          <span className="hero-eyebrow">New season · 2026</span>
          <h1>Watches for every wrist</h1>
          <p className="hero-sub">
            Curated smart, analog and luxury watches. Free shipping above ₹999 and easy 7-day returns.
          </p>
          <div className="row wrap">
            <Link to="/products" className="btn hero-cta">Shop all watches</Link>
            <Link to="/products?sort=discount" className="btn secondary hero-cta-ghost">Today's deals</Link>
          </div>
        </div>
        <div className="hero-badge">
          <span className="hero-badge-off">60%</span>
          <span className="hero-badge-text">off MRP with code WATCH60</span>
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}

      {categories.length > 0 && (
        <section className="mb">
          <h2>Shop by category</h2>
          <div className="row wrap">
            {categories.map((c) => (
              <Link key={c._id} to={`/products?category=${encodeURIComponent(c.slug)}`} className="chip">
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="row between">
          <h2>New arrivals</h2>
          <Link to="/products">View all</Link>
        </div>

        {loading ? (
          <p className="muted">Loading products…</p>
        ) : products.length === 0 ? (
          <p className="muted">No products yet. Add some from the admin panel.</p>
        ) : (
          <div className="product-grid">
            {products.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </section>
    </div>
  );
}
