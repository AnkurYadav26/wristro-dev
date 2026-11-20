import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { inr } from '../../format';

const LIMIT = 25;

export default function AdminProducts() {
  const [data, setData] = useState({ products: [], total: 0, page: 1 });
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api('GET', '/admin/products', {
        query: { q: term || undefined, archived: archived ? 'true' : 'false', page, limit: LIMIT },
      });
      setData(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [term, archived, page]);

  const search = (e) => { e.preventDefault(); setPage(1); setTerm(q.trim()); };

  const remove = async (p) => {
    setError('');
    setNotice('');
    try {
      const r = await api('DELETE', `/admin/products/${p._id}`);
      setNotice(r.archived ? r.message : 'Product deleted.');
      await load();
    } catch (err) { setError(err.message); }
  };

  const totalPages = Math.max(1, Math.ceil((data.total || 0) / LIMIT));

  return (
    <div>
      <div className="row between mb">
        <h2>Products</h2>
        <Link to="/admin/products/new" className="btn small">New product</Link>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      <div className="row wrap mb">
        <form className="row" onSubmit={search}>
          <input placeholder="Search name, SKU, brand" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn secondary small" type="submit">Search</button>
        </form>
        <label className="row" style={{ gap: 8, marginBottom: 0 }}>
          <input type="checkbox" checked={archived} onChange={(e) => { setPage(1); setArchived(e.target.checked); }} />
          <span>Show archived</span>
        </label>
      </div>

      {loading ? <p className="muted">Loading…</p> : data.products.length === 0 ? (
        <p className="muted">No products found.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Product</th><th>SKU</th><th>Price</th><th>On hand</th><th>Available</th><th>Active</th><th />
            </tr>
          </thead>
          <tbody>
            {data.products.map((p) => (
              <tr key={p._id}>
                <td>
                  {p.name}
                  <div className="muted small">{p.brand}</div>
                </td>
                <td className="small">{p.sku}</td>
                <td>
                  {inr(p.sellingPricePaise)}
                  <div className="muted small">MRP {inr(p.mrpPaise)}</div>
                </td>
                <td>{p.stockOnHand}</td>
                <td>{p.stockAvailable}</td>
                <td>{p.isArchived ? 'Archived' : p.isActive ? 'Yes' : 'No'}</td>
                <td>
                  <div className="row">
                    <Link className="btn secondary small" to={`/admin/products/${p._id}`}>Edit</Link>
                    <button className="btn danger small" onClick={() => remove(p)}>
                      {p.isArchived ? 'Delete' : 'Archive'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn secondary small" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</button>
          <span className="small">Page {page} / {totalPages}</span>
          <button className="btn secondary small" disabled={page >= totalPages} onClick={() => setPage((n) => n + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
