import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import ProductCard from '../components/ProductCard';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { inr, discountPct } from '../format';

const STOCK_LABEL = { in_stock: 'In stock', low_stock: 'Only a few left', out_of_stock: 'Out of stock' };
const RELATED_LIMIT = 4;

/** Same-category watches first; top up with randomly picked watches when that category is thin. */
async function fetchRelated(product) {
  const picked = [];
  const seen = new Set([String(product.id)]);

  if (product.categorySlug) {
    const r = await api('GET', '/products', { query: { category: product.categorySlug, limit: 12 } });
    for (const p of r.products || []) {
      if (seen.has(String(p.id))) continue;
      seen.add(String(p.id));
      picked.push(p);
      if (picked.length >= RELATED_LIMIT) break;
    }
  }

  if (picked.length < RELATED_LIMIT) {
    const r = await api('GET', '/products', { query: { limit: 60 } });
    const pool = (r.products || []).filter((p) => !seen.has(String(p.id)));
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    picked.push(...pool.slice(0, RELATED_LIMIT - picked.length));
  }

  return picked;
}

export default function ProductDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const cart = useCart();

  const [product, setProduct] = useState(null);
  const [variants, setVariants] = useState([]);
  const [related, setRelated] = useState([]);
  const [active, setActive] = useState(0);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setNotice('');
    setQty(1);
    setActive(0);
    setRelated([]);
    api('GET', `/products/${slug}`)
      .then((r) => {
        if (!alive) return;
        setProduct(r.product);
        setVariants(r.variants || []);
        fetchRelated(r.product)
          .then((items) => { if (alive) setRelated(items); })
          .catch(() => { /* suggestions are best-effort */ });
      })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  if (loading) return <div className="page muted">Loading…</div>;
  if (error) return <div className="page"><div className="alert error">{error}</div></div>;
  if (!product) return null;

  const images = product.images?.length ? product.images : [];
  const off = discountPct(product.mrpPaise, product.sellingPricePaise);
  const maxQty = Math.max(1, Math.min(product.maxPurchasable || 1, 10));
  const inCart = Boolean(cart.items?.some((i) => String(i.productId) === String(product.id)));

  const requireLogin = () => {
    navigate('/login', { state: { from: `/product/${slug}` } });
  };

  const onAdd = async () => {
    setNotice('');
    if (!user) return requireLogin();
    try {
      await cart.add(product.id, qty);
      setNotice('Added to cart.');
    } catch (err) {
      setNotice(err.message);
    }
  };

  const onBuyNow = () => {
    if (!user) return requireLogin();
    navigate(`/checkout?source=buy_now&productId=${product.id}&quantity=${qty}`);
  };

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">Home</Link> / <Link to="/products">Watches</Link> / {product.name}
      </div>

      {notice && <div className="alert info">{notice}</div>}

      <div className="split">
        <div className="gallery">
          <div className="gallery-main">
            {images[active] ? (
              <img src={images[active].url} alt={images[active].alt || product.name} />
            ) : (
              <span className="thumb-placeholder">No image</span>
            )}
            {images.length > 1 && (
              <div className="gallery-thumbs">
                {images.map((img, i) => (
                  <img
                    key={i}
                    src={img.url}
                    alt={img.alt || `${product.name} ${i + 1}`}
                    onClick={() => setActive(i)}
                    style={{ outline: i === active ? '2px solid var(--accent)' : 'none' }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="panel">
          <span className="muted small">{product.brand}</span>
          <h1>{product.name}</h1>
          <p className="muted small">SKU: {product.sku} · {product.watchType}{product.colour ? ` · ${product.colour}` : ''}</p>

          <div className="price-row">
            <span className="price" style={{ fontSize: 24 }}>{inr(product.sellingPricePaise)}</span>
            {product.mrpPaise > product.sellingPricePaise && <span className="mrp">{inr(product.mrpPaise)}</span>}
            {off > 0 && <span className="badge-off" style={{ position: 'static' }}>{off}% off</span>}
          </div>

          {product.promoPricePaise != null && (
            <p className="promo">Use code <strong>{product.promoCode}</strong> → {inr(product.promoPricePaise)}</p>
          )}

          <p className={`small stock-${product.stockStatus}`}>{STOCK_LABEL[product.stockStatus]}</p>

          <div className="qty mt">
            <label style={{ marginBottom: 0 }}>
              <span>Qty</span>
              <input
                type="number"
                min="1"
                max={maxQty}
                value={qty}
                disabled={product.stockStatus === 'out_of_stock'}
                onChange={(e) => setQty(Math.max(1, Math.min(maxQty, Number(e.target.value) || 1)))}
              />
            </label>
          </div>

          {inCart && (
            <div className="alert ok mt">
              Already added to cart. <Link to="/cart">Go to cart</Link>
            </div>
          )}

          <div className="row mt">
            <button className="btn" onClick={onAdd} disabled={product.stockStatus === 'out_of_stock'}>
              {inCart ? 'Add more' : 'Add to cart'}
            </button>
            <button className="btn secondary" onClick={onBuyNow} disabled={product.stockStatus === 'out_of_stock'}>Buy now</button>
          </div>

          {variants.length > 0 && (
            <div className="mt">
              <h3>Other colours</h3>
              <div className="row wrap">
                {variants.map((v) => (
                  <Link key={v.slug} to={`/product/${v.slug}`} className="btn secondary small">
                    {v.colour || 'Variant'}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <ul className="small muted mt">
            {product.warrantyMonths > 0 && <li>{product.warrantyMonths}-month warranty{product.warrantyNote ? ` (${product.warrantyNote})` : ''}</li>}
            {product.returnEligible && <li>{product.returnWindowDays}-day returns</li>}
          </ul>
        </aside>
      </div>

      {product.description && (
        <section className="panel mt">
          <h2>Description</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{product.description}</p>
        </section>
      )}

      {product.features?.length > 0 && (
        <section className="panel mt">
          <h2>Features</h2>
          <ul>{product.features.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </section>
      )}

      {product.specifications?.length > 0 && (
        <section className="panel mt">
          <h2>Specifications</h2>
          <table className="spec-table">
            <tbody>
              {product.specifications.map((s, i) => (
                <tr key={i}><td>{s.key}</td><td>{s.value}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt">
          <h2>{product.categoryName ? `More in ${product.categoryName}` : 'You may also like'}</h2>
          <div className="product-grid">
            {related.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}
