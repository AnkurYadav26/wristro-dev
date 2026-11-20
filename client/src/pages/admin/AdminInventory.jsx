import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { inr, formatDate } from '../../format';

const TYPES = [
  ['opening_stock', 'Opening stock (+)'],
  ['return_in', 'Returned goods (+)'],
  ['adjustment_in', 'Adjustment in (+)'],
  ['damage_out', 'Damage out (−)'],
  ['adjustment_out', 'Adjustment out (−)'],
];

export default function AdminInventory() {
  const [summary, setSummary] = useState(null);
  const [low, setLow] = useState([]);
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [productId, setProductId] = useState('');
  const [type, setType] = useState('opening_stock');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, l, m] = await Promise.all([
        api('GET', '/admin/inventory/summary'),
        api('GET', '/admin/inventory/low-stock'),
        api('GET', '/admin/inventory/movements', { query: { limit: 50 } }),
      ]);
      setSummary(s.summary);
      setLow(l.products);
      setMovements(m.movements);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    api('GET', '/admin/products', { query: { limit: 100 } }).then((d) => setProducts(d.products)).catch(() => {});
  }, [load]);

  const adjust = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (!productId) {
      setError('Pick a product.');
      return;
    }
    setBusy(true);
    const body = { productId, type, quantity: Number(quantity) };
    if (note.trim()) body.note = note.trim();
    try {
      const d = await api('POST', '/admin/inventory/adjust', { body });
      setMsg(`Stock updated. On hand: ${d.stockOnHand}, reserved: ${d.stockReserved}.`);
      setQuantity('1');
      setNote('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async () => {
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const d = await api('POST', '/admin/inventory/reconcile');
      setMsg(`Reconcile done: checked ${d.checked}, fixed ${d.fixed}.`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const needsNote = type !== 'opening_stock';

  return (
    <div>
      <h2>Inventory</h2>
      {error && <div className="alert error">{error}</div>}
      {msg && <div className="alert ok">{msg}</div>}

      {summary && (
        <div className="stat-grid mb">
          <div className="stat">
            <div className="k">Products</div>
            <div className="v">{summary.totalProducts}</div>
          </div>
          <div className="stat">
            <div className="k">On hand</div>
            <div className="v">{summary.totalUnits}</div>
          </div>
          <div className="stat">
            <div className="k">Available</div>
            <div className="v">{summary.availableUnits}</div>
          </div>
          <div className="stat">
            <div className="k">Low stock</div>
            <div className="v">{summary.lowStockProducts}</div>
          </div>
        </div>
      )}

      <form className="panel mb" onSubmit={adjust}>
        <h3>Adjust stock</h3>
        <label>
          <span>Product *</span>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="">Select…</option>
            {products.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} ({p.sku}) — on hand {p.stockOnHand}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label className="grow">
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            <span>Quantity</span>
            <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
        </div>
        <label>
          <span>Note {needsNote ? '*' : '(optional)'}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} required={needsNote} />
        </label>
        <div className="row">
          <button className="btn" type="submit" disabled={busy}>
            Apply
          </button>
          <button className="btn secondary" type="button" onClick={reconcile} disabled={busy}>
            Reconcile reserved
          </button>
        </div>
      </form>

      <h3>Low stock</h3>
      {low.length === 0 ? (
        <p className="muted">Nothing is low on stock.</p>
      ) : (
        <table className="mb">
          <thead>
            <tr>
              <th>Name</th>
              <th>SKU</th>
              <th>On hand</th>
              <th>Reserved</th>
              <th>Threshold</th>
            </tr>
          </thead>
          <tbody>
            {low.map((p) => (
              <tr key={p._id}>
                <td>{p.name}</td>
                <td>{p.sku}</td>
                <td>{p.stockOnHand}</td>
                <td>{p.stockReserved}</td>
                <td>{p.lowStockThreshold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Recent movements</h3>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Product</th>
            <th>Type</th>
            <th>Qty</th>
            <th>On hand after</th>
            <th>Note</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m._id}>
              <td>{formatDate(m.createdAt)}</td>
              <td>{m.productId?.name || '—'}</td>
              <td>{m.type}</td>
              <td>{m.quantity}</td>
              <td>{m.onHandAfter}</td>
              <td>{m.note || '—'}</td>
              <td>{m.actorId?.name || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
