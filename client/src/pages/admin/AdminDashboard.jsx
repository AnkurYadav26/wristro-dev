import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { inr } from '../../format';

export default function AdminDashboard() {
  const [summary, setSummary] = useState(null);
  const [low, setLow] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [s, l] = await Promise.all([
          api('GET', '/admin/inventory/summary'),
          api('GET', '/admin/inventory/low-stock'),
        ]);
        setSummary(s.summary);
        setLow(l.products || []);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  return (
    <div>
      <h2>Dashboard</h2>
      {error && <div className="alert error">{error}</div>}

      {summary && (
        <div className="stat-grid">
          <Stat k="Products" v={summary.totalProducts} />
          <Stat k="Units on hand" v={summary.totalUnits} />
          <Stat k="Reserved" v={summary.reservedUnits} />
          <Stat k="Available" v={summary.availableUnits} />
          <Stat k="Low stock" v={summary.lowStockProducts} />
          <Stat k="Out of stock" v={summary.outOfStockProducts} />
          <Stat k="Stock value (cost)" v={inr(summary.purchaseValuePaise)} />
          <Stat k="Stock value (selling)" v={inr(summary.sellingValuePaise)} />
        </div>
      )}

      <h3 className="mt">Low stock</h3>
      {low.length === 0 ? (
        <p className="muted">Nothing is low on stock.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Product</th><th>SKU</th><th>On hand</th><th>Reserved</th><th>Threshold</th><th /></tr>
          </thead>
          <tbody>
            {low.map((p) => (
              <tr key={p._id}>
                <td>{p.name}<div className="muted small">{p.brand}</div></td>
                <td>{p.sku}</td>
                <td>{p.stockOnHand}</td>
                <td>{p.stockReserved}</td>
                <td>{p.lowStockThreshold}</td>
                <td><Link to="/admin/inventory">Restock</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ k, v }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}
