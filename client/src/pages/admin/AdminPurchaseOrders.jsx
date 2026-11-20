import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { inr, toPaise } from '../../format';

const emptyItem = { productId: '', quantity: '1', unitCostRupees: '' };

export default function AdminPurchaseOrders() {
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [receipts, setReceipts] = useState({});
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [items, setItems] = useState([{ ...emptyItem }]);
  const [taxesRupees, setTaxesRupees] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api('GET', '/admin/purchase-orders', { query: { limit: 50 } });
      setOrders(d.purchaseOrders);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    api('GET', '/admin/suppliers').then((d) => setSuppliers(d.suppliers)).catch(() => {});
    api('GET', '/admin/products', { query: { limit: 100 } }).then((d) => setProducts(d.products)).catch(() => {});
  }, [load]);

  const openDetail = async (id) => {
    setError('');
    setMsg('');
    try {
      const d = await api('GET', `/admin/purchase-orders/${id}`);
      setSelected(d.purchaseOrder);
      setReceipts({});
    } catch (e) {
      setError(e.message);
    }
  };

  const setItem = (i, k, v) => {
    const next = items.slice();
    next[i] = { ...next[i], [k]: v };
    setItems(next);
  };

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    const parsed = items
      .map((it) => ({
        productId: it.productId,
        quantity: Number(it.quantity),
        unitCostPaise: toPaise(it.unitCostRupees),
      }))
      .filter((it) => it.productId && it.quantity > 0);
    if (!supplierId || parsed.length === 0) {
      setError('Pick a supplier and at least one product line.');
      return;
    }
    setBusy(true);
    const body = { supplierId, items: parsed };
    if (taxesRupees !== '') body.taxesPaise = toPaise(taxesRupees);
    if (purchaseDate) body.purchaseDate = new Date(purchaseDate).toISOString();
    if (notes) body.notes = notes;
    try {
      await api('POST', '/admin/purchase-orders', { body });
      setMsg('Purchase order created.');
      setItems([{ ...emptyItem }]);
      setSupplierId('');
      setTaxesRupees('');
      setNotes('');
      setShowCreate(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const receive = async () => {
    if (!selected) return;
    const list = Object.entries(receipts)
      .map(([productId, q]) => ({ productId, quantity: Number(q) }))
      .filter((r) => r.quantity > 0);
    if (!list.length) {
      setError('Enter a quantity to receive.');
      return;
    }
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const d = await api('POST', `/admin/purchase-orders/${selected._id}/receive`, { body: { items: list } });
      setSelected(d.purchaseOrder);
      setReceipts({});
      setMsg('Goods received.');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelPo = async () => {
    if (!selected || !confirm('Cancel this purchase order?')) return;
    setBusy(true);
    setError('');
    try {
      const d = await api('PATCH', `/admin/purchase-orders/${selected._id}`, { body: { status: 'cancelled' } });
      setSelected(d.purchaseOrder);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="row between mb">
        <h2>Purchase orders</h2>
        <button className="btn small" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Close' : 'New purchase order'}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {msg && <div className="alert ok">{msg}</div>}

      {showCreate && (
        <form className="panel mb" onSubmit={create}>
          <h3>New purchase order</h3>
          <label>
            <span>Supplier *</span>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">Select…</option>
              {suppliers.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <h4>Items</h4>
          {items.map((it, i) => (
            <div className="row" key={i}>
              <select className="grow" value={it.productId} onChange={(e) => setItem(i, 'productId', e.target.value)}>
                <option value="">Select product…</option>
                {products.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                style={{ width: 90 }}
                value={it.quantity}
                onChange={(e) => setItem(i, 'quantity', e.target.value)}
                placeholder="Qty"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                style={{ width: 120 }}
                value={it.unitCostRupees}
                onChange={(e) => setItem(i, 'unitCostRupees', e.target.value)}
                placeholder="Unit cost ₹"
              />
              <button
                type="button"
                className="link-btn"
                onClick={() => setItems(items.filter((_, j) => j !== i))}
                disabled={items.length === 1}
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="btn secondary small mt" onClick={() => setItems([...items, { ...emptyItem }])}>
            Add line
          </button>

          <div className="row mt">
            <label className="grow">
              <span>Taxes (₹)</span>
              <input type="number" min="0" value={taxesRupees} onChange={(e) => setTaxesRupees(e.target.value)} />
            </label>
            <label className="grow">
              <span>Purchase date</span>
              <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </label>
          </div>
          <label>
            <span>Notes</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            Create
          </button>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>PO number</th>
            <th>Supplier</th>
            <th>Status</th>
            <th>Payment</th>
            <th>Total</th>
            <th>Date</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((po) => (
            <tr key={po._id}>
              <td>{po.poNumber}</td>
              <td>{po.supplierId?.name || '—'}</td>
              <td>{po.status}</td>
              <td>{po.paymentStatus}</td>
              <td>{inr(po.totalPaise)}</td>
              <td>{po.purchaseDate ? new Date(po.purchaseDate).toLocaleDateString('en-IN') : '—'}</td>
              <td>
                <button className="link-btn small" onClick={() => openDetail(po._id)}>
                  View / receive
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && (
        <div className="panel mt">
          <div className="row between">
            <h3>{selected.poNumber}</h3>
            <button className="link-btn small" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p className="muted small">
            Status: {selected.status} · Payment: {selected.paymentStatus} · Supplier: {selected.supplierId?.name || '—'}
          </p>

          <table className="mb">
            <thead>
              <tr>
                <th>Product</th>
                <th>Ordered</th>
                <th>Received</th>
                <th>Unit cost</th>
                <th>Receive now</th>
              </tr>
            </thead>
            <tbody>
              {selected.items.map((line, i) => {
                const pid = line.productId?._id || line.productId;
                const remaining = line.quantity - (line.receivedQuantity || 0);
                return (
                  <tr key={i}>
                    <td>{line.productId?.name || pid}</td>
                    <td>{line.quantity}</td>
                    <td>{line.receivedQuantity || 0}</td>
                    <td>{inr(line.unitCostPaise)}</td>
                    <td>
                      {remaining > 0 && selected.status !== 'cancelled' ? (
                        <input
                          type="number"
                          min="0"
                          max={remaining}
                          style={{ width: 80 }}
                          value={receipts[pid] ?? ''}
                          onChange={(e) => setReceipts({ ...receipts, [pid]: e.target.value })}
                          placeholder="0"
                        />
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="row">
            <button className="btn" onClick={receive} disabled={busy || selected.status === 'cancelled'}>
              Receive goods
            </button>
            {selected.status !== 'cancelled' && selected.status !== 'received' && (
              <button className="btn danger" onClick={cancelPo} disabled={busy}>
                Cancel PO
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
