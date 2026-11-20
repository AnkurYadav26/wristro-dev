import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import TrackingTimeline from '../components/TrackingTimeline';
import { inr, formatDay } from '../format';

/** "Delivered 18 November 2026" once it has arrived, otherwise the estimate. */
function deliveryNote(item) {
  return item.deliveredAt
    ? { text: `Delivered on ${formatDay(item.deliveredAt)}`, done: true }
    : { text: `Expected Delivery: ${formatDay(item.expectedDeliveryAt)}`, done: false };
}

function OrderCard({ order, open, onToggle }) {
  return (
    <article className={open ? 'order-card is-open' : 'order-card'}>
      <button type="button" className="order-head" onClick={onToggle} aria-expanded={open}>
        <span className="order-head-main">
          <span className="order-num">{order.orderNumber}</span>
          <span className="muted small">
            Placed {formatDay(order.placedAt)} · {order.itemCount} item{order.itemCount === 1 ? '' : 's'}
          </span>
        </span>
        <span className={`status-pill stage-${order.status}`}>{order.statusLabel}</span>
        <span className="order-total">{inr(order.totals?.payablePaise)}</span>
        <span className="order-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      <div className="order-items">
        {order.items.map((item) => {
          const note = deliveryNote(item);
          return (
            <div className="order-item" key={item.id}>
              <div className="order-thumb">
                {item.image
                  ? <img src={item.image} alt={item.name} loading="lazy" />
                  : <span className="thumb-placeholder">No image</span>}
              </div>

              <div className="order-item-info">
                {item.brand ? <span className="muted small">{item.brand}</span> : null}
                <strong className="order-item-name">{item.name}</strong>
                <span className="muted small">Qty {item.quantity} · {inr(item.unitPaise)} each</span>
                <span className={`status-pill small stage-${item.status}`}>{item.statusLabel}</span>
              </div>

              <div className="order-item-side">
                <span className="order-line-total">{inr(item.totalPaise)}</span>
                <span className={note.done ? 'delivery-note done' : 'delivery-note'}>{note.text}</span>
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <div className="order-tracking">
          <h3>Order tracking</h3>
          {order.items.map((item) => (
            <div className="tracking-block" key={item.id}>
              <div className="tracking-block-head">
                <strong>{item.name}</strong>
                <span className={deliveryNote(item).done ? 'delivery-note done' : 'delivery-note'}>
                  {deliveryNote(item).text}
                </span>
              </div>
              <TrackingTimeline steps={item.timeline} />
            </div>
          ))}

          {order.address && (
            <div className="order-address">
              <h3>Delivery address</h3>
              <p className="small muted">
                <strong>{order.address.fullName}</strong><br />
                {[order.address.houseNo, order.address.buildingName, order.address.street, order.address.landmark]
                  .filter(Boolean).join(', ')}<br />
                {order.address.city}, {order.address.district}, {order.address.state} — {order.address.pincode}<br />
                Mobile: {order.address.mobile}
              </p>
            </div>
          )}

          <div className="order-totals">
            <div className="summary-line"><span>Goods</span><span>{inr(order.totals?.goodsPaise)}</span></div>
            <div className="summary-line">
              <span>Shipping</span>
              <span>{order.totals?.shippingPaise === 0 ? 'FREE' : inr(order.totals?.shippingPaise)}</span>
            </div>
            {order.coupon && (
              <div className="summary-line"><span>Coupon {order.coupon.code}</span><span>− {inr(order.coupon.savingPaise)}</span></div>
            )}
            <div className="summary-line total"><span>Paid</span><span>{inr(order.totals?.payablePaise)}</span></div>
          </div>
        </div>
      )}
    </article>
  );
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = async () => {
    setError('');
    try {
      const r = await api('GET', '/orders');
      setOrders(r.orders || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="page">
      <div className="row between wrap mb">
        <h1>My orders</h1>
        <button type="button" className="btn secondary small" onClick={load}>Refresh</button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="panel center">
          <p className="muted">You have not placed any orders yet.</p>
          <Link to="/products" className="btn">Browse watches</Link>
        </div>
      ) : (
        <div className="order-list">
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              open={openId === o.id}
              onToggle={() => setOpenId(openId === o.id ? null : o.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
