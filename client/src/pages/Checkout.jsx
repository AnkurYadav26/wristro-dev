import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, newIdempotencyKey } from '../api';
import AddressForm from '../components/AddressForm';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { inr } from '../format';

/** Loads Razorpay's checkout.js once and resolves when window.Razorpay is ready. */
let razorpayPromise = null;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (!razorpayPromise) {
    razorpayPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => resolve();
      s.onerror = () => { razorpayPromise = null; reject(new Error('Could not load the payment window.')); };
      document.body.appendChild(s);
    });
  }
  return razorpayPromise;
}

export default function Checkout() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const cart = useCart();

  const source = params.get('source') === 'buy_now' ? 'buy_now' : 'cart';
  const productId = params.get('productId') || undefined;
  const quantity = params.get('quantity') ? Number(params.get('quantity')) : undefined;

  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [coupon, setCoupon] = useState(params.get('coupon') || '');
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [preview, setPreview] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // One key per checkout attempt: retries and double-clicks reuse it, so stock is held once.
  const keyRef = useRef(newIdempotencyKey());

  const loadAddresses = async () => {
    const r = await api('GET', '/addresses');
    setAddresses(r.addresses || []);
    const def = (r.addresses || []).find((a) => a.isDefault);
    setAddressId((cur) => cur || def?._id || '');
  };

  useEffect(() => {
    loadAddresses().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const body = { source };
    if (source === 'buy_now') { body.productId = productId; body.quantity = quantity; }
    if (coupon.trim()) body.couponCode = coupon.trim();
    if (addressId) body.addressId = addressId;

    api('POST', '/checkout/preview', { body })
      .then((r) => { if (alive) setPreview(r); })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [source, productId, quantity, coupon, addressId]);

  const placeOrder = async () => {
    setPlacing(true);
    setError('');
    setNotice('');
    const body = { source, addressId };
    if (source === 'buy_now') { body.productId = productId; body.quantity = quantity; }
    if (coupon.trim()) body.couponCode = coupon.trim();
    try {
      const r = await api('POST', '/checkout/sessions', {
        body,
        headers: { 'Idempotency-Key': keyRef.current },
      });
      setSession(r.session);
      await cart.reload().catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setPlacing(false);
    }
  };

  const cancelSession = async () => {
    setError('');
    try {
      await api('POST', `/checkout/sessions/${session.id}/cancel`);
      setSession(null);
      keyRef.current = newIdempotencyKey(); // a fresh attempt needs a fresh key
      setNotice('Checkout cancelled and stock released.');
    } catch (err) {
      setError(err.message);
    }
  };

  // Send the gateway callback to the server, which verifies the signature before confirming the sale.
  const verifyPayment = async (body) => {
    const v = await api('POST', `/checkout/sessions/${session.id}/verify`, { body });
    setSession(v.session);
    await cart.reload().catch(() => {});
  };

  // Open the Razorpay popup for the order the server just created.
  const openRazorpay = async (g) => {
    await loadRazorpay();
    await new Promise((resolve) => {
      const rzp = new window.Razorpay({
        key: g.keyId,
        amount: g.amountPaise,
        currency: g.currency,
        name: 'WRISTORA',
        description: `Order ${session.id}`,
        order_id: g.orderId,
        prefill: { name: session.address?.fullName || '', email: user?.email || '', contact: session.address?.mobile || '' },
        theme: { color: '#111111' },
        handler: async (resp) => {
          try {
            await verifyPayment({
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
          } catch (err) { setError(err.message); }
          resolve();
        },
        modal: { ondismiss: () => { setNotice('Payment window closed — nothing was charged.'); resolve(); } },
      });
      rzp.on('payment.failed', () => { setError('Payment failed. You can try again.'); resolve(); });
      rzp.open();
    });
  };

  const startPayment = async () => {
    setPaying(true);
    setError('');
    setNotice('');
    try {
      const g = await api('POST', `/checkout/sessions/${session.id}/pay`);
      if (g.simulated) {
        // No Razorpay keys configured (development): the server simulates a successful payment.
        await verifyPayment({ simulated: true });
      } else {
        await openRazorpay(g);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPaying(false);
    }
  };

  if (!user) return null;

  if (session) {
    const paid = session.status === 'paid';
    return (
      <div className="page">
        <h1>{paid ? 'Payment successful' : 'Complete payment'}</h1>
        {notice && <div className="alert ok">{notice}</div>}
        {error && <div className="alert error">{error}</div>}
        <div className="panel">
          {paid ? (
            <p className="alert ok">
              Thank you! Your payment was received and your order is confirmed.
              {session.payment?.simulated ? ' (Simulated test payment — no money was charged.)' : ''}
            </p>
          ) : (
            <p className="alert info">
              Stock is held for you until <strong>{new Date(session.expiresAt).toLocaleString('en-IN')}</strong>.
              Complete the payment to confirm your order.
            </p>
          )}
          <p className="muted small">
            Checkout reference: {session.id} · status: {session.status}
            {session.payment?.paymentId ? ` · payment: ${session.payment.paymentId}` : ''}
          </p>

          <table className="mt">
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Total</th></tr>
            </thead>
            <tbody>
              {session.items.map((l) => (
                <tr key={l.productId}>
                  <td>{l.name}</td>
                  <td>{l.quantity}</td>
                  <td>{inr(l.finalTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt">
            <div className="summary-line"><span>Goods</span><span>{inr(session.totals.goodsPaise)}</span></div>
            <div className="summary-line"><span>Shipping</span><span>{session.totals.shippingPaise === 0 ? 'FREE' : inr(session.totals.shippingPaise)}</span></div>
            <div className="summary-line total"><span>Payable</span><span>{inr(session.totals.payablePaise)}</span></div>
          </div>

          <div className="row mt">
            {paid ? (
              <Link to="/products" className="btn">Continue shopping</Link>
            ) : (
              <>
                <button className="btn" disabled={paying} onClick={startPayment}>
                  {paying ? 'Opening payment…' : `Pay ${inr(session.totals.payablePaise)}`}
                </button>
                <button className="btn secondary" disabled={paying} onClick={cancelSession}>Cancel checkout</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Checkout</h1>
      {error && <div className="alert error">{error}</div>}

      <div className="split">
        <section>
          <div className="panel mb">
            <div className="row between">
              <h3>Delivery address</h3>
              {!showAddressForm && (
                <button className="btn secondary small" onClick={() => setShowAddressForm(true)}>Add new</button>
              )}
            </div>

            {showAddressForm && (
              <AddressForm
                onCancel={() => setShowAddressForm(false)}
                onSaved={async (addr, warnings) => {
                  setShowAddressForm(false);
                  await loadAddresses();
                  setAddressId(addr._id);
                  if (warnings?.length) setNotice(warnings.join(' '));
                }}
              />
            )}

            {!showAddressForm && addresses.length === 0 && (
              <p className="muted">No saved addresses yet. Add one to continue.</p>
            )}

            {!showAddressForm && addresses.map((a) => (
              <label key={a._id} className="row" style={{ gap: 10, alignItems: 'flex-start', borderBottom: '1px solid #eee', padding: '10px 0' }}>
                <input
                  type="radio"
                  name="address"
                  checked={addressId === a._id}
                  onChange={() => setAddressId(a._id)}
                  style={{ marginTop: 4 }}
                />
                <span>
                  <strong>{a.fullName}</strong>{a.isDefault ? ' (default)' : ''}<br />
                  <span className="small muted">
                    {[a.houseNo, a.buildingName, a.street, a.landmark].filter(Boolean).join(', ')}, {a.city}, {a.district}, {a.state} — {a.pincode}<br />
                    Mobile: {a.mobile}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="panel">
            <h3>Items</h3>
            {loading && !preview ? <p className="muted">Loading…</p> : (
              <table>
                <thead>
                  <tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {(preview?.lines || []).map((l) => (
                    <tr key={l.productId}>
                      <td>{l.name}{l.brand ? <div className="muted small">{l.brand}</div> : null}</td>
                      <td>{l.quantity}</td>
                      <td>{inr(l.finalTotalPaise / l.quantity)}</td>
                      <td>{inr(l.finalTotalPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {preview?.problems?.length > 0 && (
              <div className="alert warn mt">
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {preview.problems.map((p, i) => <li key={i}>{p.message}</li>)}
                </ul>
              </div>
            )}
          </div>
        </section>

        <aside className="panel">
          <h3>Order summary</h3>

          <form className="row" onSubmit={(e) => { e.preventDefault(); }}>
            <input placeholder="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
          </form>

          {preview?.coupon && (
            <p className={preview.coupon.applied ? 'small promo' : 'small muted'}>
              {preview.coupon.applied
                ? `${preview.coupon.code} applied${preview.coupon.capped ? ' (capped)' : ''}.`
                : `${preview.coupon.code}: ${preview.coupon.message}`}
            </p>
          )}

          {preview && (
            <div className="mt">
              <div className="summary-line"><span>MRP total</span><span>{inr(preview.mrpTotalPaise)}</span></div>
              {preview.standardDiscountPaise > 0 && (
                <div className="summary-line"><span>Discount</span><span>− {inr(preview.standardDiscountPaise)}</span></div>
              )}
              {preview.couponDiscountPaise > 0 && (
                <div className="summary-line"><span>Coupon</span><span>− {inr(preview.couponDiscountPaise)}</span></div>
              )}
              <div className="summary-line"><span>Goods</span><span>{inr(preview.goodsPaise)}</span></div>
              <div className="summary-line">
                <span>Shipping</span>
                <span>{preview.shippingPaise === 0 ? 'FREE' : inr(preview.shippingPaise)}</span>
              </div>
              <div className="summary-line total"><span>Payable</span><span>{inr(preview.payablePaise)}</span></div>
              <p className="muted small">Includes {inr(preview.gstIncludedPaise)} GST.</p>
              {preview.freeShippingAbovePaise != null && preview.shippingPaise > 0 && (
                <p className="muted small">Free shipping above {inr(preview.freeShippingAbovePaise)}.</p>
              )}
            </div>
          )}

          <button className="btn mt" disabled={placing || !preview?.readyToPay} onClick={placeOrder}>
            {placing ? 'Starting…' : 'Continue to payment'}
          </button>

          {!preview?.readyToPay && preview && (
            <p className="small muted">
              {!preview.address
                ? 'Choose a delivery address to continue.'
                : !preview.purchasable
                  ? 'Some items cannot be purchased as requested.'
                  : 'Enter a valid coupon code or clear it to continue.'}
            </p>
          )}

          <button className="btn secondary small mt" type="button" onClick={() => navigate('/cart')}>Back to cart</button>
        </aside>
      </div>
    </div>
  );
}
