import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { inr } from '../format';

export default function Cart() {
  const { user } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const [coupon, setCoupon] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!user) {
    return (
      <div className="page">
        <h1>Your cart</h1>
        <p className="muted">Please <Link to="/login" state={{ from: '/cart' }}>log in</Link> to see your cart.</p>
      </div>
    );
  }

  const run = async (fn) => {
    setError('');
    setBusy(true);
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const applyCoupon = (e) => {
    e.preventDefault();
    run(() => cart.reload(coupon.trim() || undefined));
  };

  const items = cart.items || [];
  const totals = cart.totals;
  const pricing = cart.pricing;

  return (
    <div className="page">
      <h1>Your cart</h1>
      {error && <div className="alert error">{error}</div>}

      {items.length === 0 ? (
        <p className="muted">Your cart is empty. <Link to="/products">Start shopping</Link>.</p>
      ) : (
        <div className="split">
          <section>
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Qty</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const p = it.product;
                  const id = it.productId;
                  return (
                    <tr key={id}>
                      <td>
                        <div className="row">
                          {p?.image && <img src={p.image} alt={p.name} width="48" height="48" style={{ objectFit: 'cover', borderRadius: 4 }} />}
                          <div>
                            <Link to={`/product/${p?.slug}`} className="product-name">{p?.name || 'Unavailable item'}</Link>
                            <div className="muted small">{p?.brand}</div>
                            {it.issue && <div className="alert warn small" style={{ marginTop: 6, marginBottom: 0 }}>{it.issue.message}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        {inr(p?.sellingPricePaise)}
                        {p?.mrpPaise > p?.sellingPricePaise && <div className="mrp">{inr(p.mrpPaise)}</div>}
                      </td>
                      <td>
                        <div className="qty">
                          <button className="btn secondary small" disabled={busy || it.quantity <= 1} onClick={() => run(() => cart.setQty(id, it.quantity - 1))}>−</button>
                          <input
                            type="number" min="1"
                            value={it.quantity}
                            disabled={busy}
                            onChange={(e) => run(() => cart.setQty(id, Math.max(1, Number(e.target.value) || 1)))}
                          />
                          <button className="btn secondary small" disabled={busy} onClick={() => run(() => cart.setQty(id, it.quantity + 1))}>+</button>
                        </div>
                      </td>
                      <td>{inr(it.line?.finalTotalPaise ?? (p?.sellingPricePaise || 0) * it.quantity)}</td>
                      <td>
                        <button className="btn danger small" disabled={busy} onClick={() => run(() => cart.remove(id))}>Remove</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="row mt">
              <button className="btn secondary small" disabled={busy} onClick={() => run(() => cart.clear())}>Clear cart</button>
              <Link to="/products" className="btn secondary small">Continue shopping</Link>
            </div>
          </section>

          <aside className="panel">
            <h3>Order summary</h3>

            <form className="row" onSubmit={applyCoupon}>
              <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
              <button className="btn secondary small" type="submit" disabled={busy}>Apply</button>
            </form>

            {pricing?.coupon && (
              <p className={pricing.coupon.applied ? 'small promo' : 'small muted'}>
                {pricing.coupon.applied
                  ? `${pricing.coupon.code} applied${pricing.coupon.capped ? ' (capped)' : ''}.`
                  : `${pricing.coupon.code}: ${pricing.coupon.message}`}
              </p>
            )}

            {pricing && (
              <div className="mt">
                <div className="summary-line"><span>MRP total</span><span>{inr(pricing.mrpTotalPaise)}</span></div>
                {pricing.standardDiscountPaise > 0 && (
                  <div className="summary-line"><span>Discount</span><span>− {inr(pricing.standardDiscountPaise)}</span></div>
                )}
                {pricing.couponDiscountPaise > 0 && (
                  <div className="summary-line"><span>Coupon</span><span>− {inr(pricing.couponDiscountPaise)}</span></div>
                )}
                <div className="summary-line"><span>Goods</span><span>{inr(pricing.totalPaise)}</span></div>
              </div>
            )}

            {totals && (
              <div className="mt">
                <div className="summary-line"><span>Shipping</span><span>{totals.shippingPaise === 0 ? 'FREE' : inr(totals.shippingPaise)}</span></div>
                <div className="summary-line total"><span>Payable</span><span>{inr(totals.payablePaise)}</span></div>
                <p className="muted small">Includes {inr(totals.gstIncludedPaise)} GST.</p>
              </div>
            )}

            <button
              className="btn mt"
              disabled={busy || !pricing?.purchasable || items.length === 0}
              onClick={() => navigate(`/checkout?source=cart${coupon.trim() ? `&coupon=${encodeURIComponent(coupon.trim())}` : ''}`)}
            >
              Proceed to checkout
            </button>

            {pricing && !pricing.purchasable && (
              <p className="small muted">Fix the stock issues above before checking out.</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
