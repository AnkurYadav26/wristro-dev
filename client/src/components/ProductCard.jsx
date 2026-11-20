import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { inr, discountPct } from '../format';

const STOCK_LABEL = {
  in_stock: 'In stock',
  low_stock: 'Only a few left',
  out_of_stock: 'Out of stock',
};

/** Auto-rotating photo gallery for a product card (multiple photos of the same watch). */
function ProductMedia({ product, off }) {
  const images = product.images?.length ? product.images : [];
  const [active, setActive] = useState(0);
  const count = images.length;

  // Reset when the card is reused for a different product (e.g. after pagination).
  useEffect(() => { setActive(0); }, [product.id]);

  useEffect(() => {
    if (count <= 1) return undefined;
    const timer = setInterval(() => setActive((i) => (i + 1) % count), 3200);
    return () => clearInterval(timer);
  }, [count, product.id]);

  if (count === 0) {
    return (
      <div className="product-thumb">
        <span className="thumb-placeholder">No image</span>
        {off > 0 && <span className="badge-off">{off}% off</span>}
      </div>
    );
  }

  const step = (delta) => setActive((i) => (i + delta + count) % count);

  return (
    <div className="product-thumb">
      <Link to={`/product/${product.slug}`} className="thumb-link" aria-label={product.name}>
        {images.map((img, i) => (
          <img
            key={`${img.url}-${i}`}
            src={img.url}
            alt={img.alt || product.name}
            loading={i === 0 ? 'eager' : 'lazy'}
            className={i === active ? 'slide is-active' : 'slide'}
          />
        ))}
      </Link>

      {off > 0 && <span className="badge-off">{off}% off</span>}

      {count > 1 && (
        <>
          <button
            type="button"
            className="slide-nav prev"
            aria-label="Previous photo"
            onClick={() => step(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="slide-nav next"
            aria-label="Next photo"
            onClick={() => step(1)}
          >
            ›
          </button>
          <div className="slide-dots">
            {images.map((img, i) => (
              <button
                key={`dot-${i}`}
                type="button"
                className={i === active ? 'dot is-active' : 'dot'}
                aria-label={`Photo ${i + 1} of ${count}`}
                onClick={() => setActive(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function ProductCard({ product }) {
  const cart = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const off = discountPct(product.mrpPaise, product.sellingPricePaise);
  const inCart = Boolean(cart?.items?.some((i) => String(i.productId) === String(product.id)));
  const outOfStock = product.stockStatus === 'out_of_stock';

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const onAdd = async () => {
    if (!user) {
      navigate('/login', { state: { from: `/product/${product.slug}` } });
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      await cart.add(product.id, 1);
      setMsg('Added to cart');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card product-card">
      <ProductMedia product={product} off={off} />

      <div className="product-body">
        <span className="muted small">{product.brand}</span>
        <Link to={`/product/${product.slug}`} className="product-name">{product.name}</Link>

        <div className="price-row">
          <span className="price">{inr(product.sellingPricePaise)}</span>
          {product.mrpPaise > product.sellingPricePaise && (
            <span className="mrp">{inr(product.mrpPaise)}</span>
          )}
        </div>

        {product.promoPricePaise != null && (
          <p className="promo small">
            {inr(product.promoPricePaise)} with {product.promoCode}
          </p>
        )}

        <p className={`small stock-${product.stockStatus}`}>
          {STOCK_LABEL[product.stockStatus] || product.stockStatus}
        </p>

        <div className="card-actions">
          <button
            type="button"
            className="btn small"
            onClick={onAdd}
            disabled={busy || outOfStock}
          >
            {outOfStock ? 'Out of stock' : busy ? 'Adding…' : inCart ? 'Add more' : 'Add to cart'}
          </button>
          <Link to={`/product/${product.slug}`} className="btn secondary small">View</Link>
        </div>

        {msg && <p className={`small card-msg ${msg === 'Added to cart' ? 'ok' : 'err'}`}>{msg}</p>}
      </div>
    </div>
  );
}
