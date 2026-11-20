import { useEffect, useState } from 'react';
import { api } from '../../api';
import TrackingTimeline from '../../components/TrackingTimeline';
import { STAGE_STEPS } from '../../orderStages';
import { inr, formatDay } from '../../format';

const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'placed', label: 'Placed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'delivered', label: 'Delivered' },
];

function OrderCard({ order, open, onToggle, busyItem, onSetStatus }) {
  return (
    <article className={open ? 'order-card order-card-admin is-open' : 'order-card order-card-admin'}>
      <button type="button" className="order-head" onClick={onToggle} aria-expanded={open}>
        <span className="order-head-main">
          <span className="order-num">{order.orderNumber}</span>
          <span className="muted small">
            {order.customer?.name} · {formatDay(order.placedAt)}
          </span>
        </span>
        <span className={`status-pill stage-${order.status}`}>{order.statusLabel}</span>
        <span className="order-total">{inr(order.totals?.payablePaise)}</span>
        <span className="order-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      <div className="order-contact">
        <span><strong>Phone:</strong> {order.customer?.mobile || '—'}</span>
        <span><strong>Email:</strong> {order.customer?.email || '—'}</span>
      </div>

      <div className="order-items">
        {order.items.map((item) => (
          <div className="order-item" key={item.id}>
            <div className="order-thumb">
              {item.image
                ? <img src={item.image} alt={item.name} loading="lazy" />
                : <span className="thumb-placeholder">No image</span>}
            </div>

            <div className="order-item-info">
              {item.brand ? <span className="muted small">{item.brand}</span> : null}
              <strong className="order-item-name">{item.name}</strong>
              <span className="muted small">
                {item.sku ? `SKU ${item.sku} · ` : ''}Qty {item.quantity} · {inr(item.unitPaise)} each
              </span>
              <span className={`status-pill small stage-${item.status}`}>{item.statusLabel}</span>
            </div>

            <div className="order-item-side">
              <span className="order-line-total">{inr(item.totalPaise)}</span>
              <span className={item.deliveredAt ? 'delivery-note done' : 'delivery-note'}>
                {item.deliveredAt
                  ? `Delivered on ${formatDay(item.deliveredAt)}`
                  : `Expected Delivery: ${formatDay(item.expectedDeliveryAt)}`}
              </span>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div className="order-tracking">
          <h3>Update delivery status</h3>
          {order.items.map((item) => (
            <div className="tracking-block" key={item.id}>
              <div className="tracking-block-head">
                <strong>{item.name}</strong>
                <span className={`status-pill small stage-${item.status}`}>{item.statusLabel}</span>
              </div>

              <div className="row wrap status-actions">
                {STAGE_STEPS.map((step) => (
                  <button
                    key={step.status}
                    type="button"
                    className={item.status === step.status ? 'btn small' : 'btn secondary small'}
                    disabled={busyItem === `${order.id}:${item.id}` || item.status === step.status}
                    onClick={() => onSetStatus(order.id, item.id, step.status)}
                  >
                    {busyItem === `${order.id}:${item.id}` && item.status !== step.status ? '…' : step.label}
                  </button>
                ))}
              </div>

              <TrackingTimeline steps={item.timeline} />
            </div>
          ))}

          {order.address && (
            <div className="order-address">
              <h3>Delivery address</h3>
              <p className="small muted">
                <strong>{order.address.fullName}</strong> · {order.address.mobile}<br />
                {[order.address.houseNo, order.address.buildingName, order.address.street, order.address.landmark]
                  .filter(Boolean).join(', ')}<br />
                {order.address.city}, {order.address.district}, {order.address.state} — {order.address.pincode}
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function AdminOrders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(null);
  const [busyItem, setBusyItem] = useState('');

  const load = async () => {
    setError('');
    try {
      const r = await api('GET', '/admin/orders', { query: { q: q.trim(), status, limit: 100 } });
      setOrders(r.orders || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [q, status]);

  const setItemStatus = async (orderId, itemId, next) => {
    setBusyItem(`${orderId}:${itemId}`);
    setError('');
    setNotice('');
    try {
      const r = await api('PATCH', `/admin/orders/${orderId}/items/${itemId}/status`, { body: { status: next } });
      setOrders((list) => list.map((o) => (o.id === orderId ? r.order : o)));
      setNotice('Delivery status updated — the customer sees it now.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyItem('');
    }
  };

  return (
    <div>
      <div className="row between wrap mb">
        <h2>Orders</h2>
        <div className="row wrap">
          <input
            type="search"
            placeholder="Order no, name, email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search orders"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="muted">No orders match this filter.</p>
      ) : (
        <div className="order-list">
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              open={openId === o.id}
              busyItem={busyItem}
              onToggle={() => setOpenId(openId === o.id ? null : o.id)}
              onSetStatus={setItemStatus}
            />
          ))}
        </div>
      )}
    </div>
  );
}
