import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import ProductCard from '../components/ProductCard';
import { toPaise, toRupees } from '../format';

const WATCH_TYPES = [['smart', 'Smart'], ['digital', 'Digital'], ['analog', 'Analog'], ['hybrid', 'Hybrid']];
const GENDERS = [['men', 'Men'], ['women', 'Women'], ['unisex', 'Unisex']];
const SORTS = [
  ['relevance', 'Relevance'], ['newest', 'Newest'], ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'], ['discount', 'Discount'], ['rating', 'Rating'], ['bestsellers', 'Bestsellers'],
];
const LIMIT = 12;

export default function Products() {
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [data, setData] = useState({ products: [], total: 0, page: 1, limit: LIMIT });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const page = Number(params.get('page') || 1);
  const sort = params.get('sort') || 'relevance';
  const inStock = params.get('inStock') === 'true';

  useEffect(() => {
    api('GET', '/categories').then((r) => setCategories(r.categories || [])).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const query = {
      q: params.get('q') || undefined,
      category: params.get('category') || undefined,
      watchType: params.get('watchType') || undefined,
      gender: params.get('gender') || undefined,
      brand: params.get('brand') || undefined,
      minPrice: params.get('minPrice') || undefined,
      maxPrice: params.get('maxPrice') || undefined,
      minRating: params.get('minRating') || undefined,
      inStock: inStock ? 'true' : undefined,
      sort,
      page,
      limit: LIMIT,
    };
    api('GET', '/products', { query })
      .then((r) => { if (alive) setData(r); })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [params, page, sort, inStock]);

  const update = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') next.delete(k); else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const totalPages = Math.max(1, Math.ceil((data.total || 0) / (data.limit || LIMIT)));

  return (
    <div className="page">
      <h1>All watches</h1>
      <p className="muted">{data.total} product(s){params.get('q') ? ` for “${params.get('q')}”` : ''}</p>

      <div className="sidebar-filters">
        <aside className="panel">
          <h3>Filters</h3>

          <label>
            <span>Category</span>
            <select value={params.get('category') || ''} onChange={(e) => update({ category: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c._id} value={c.slug}>{c.name}</option>)}
            </select>
          </label>

          <label>
            <span>Type</span>
            <select value={params.get('watchType') || ''} onChange={(e) => update({ watchType: e.target.value })}>
              <option value="">Any type</option>
              {WATCH_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label>
            <span>Gender</span>
            <select value={params.get('gender') || ''} onChange={(e) => update({ gender: e.target.value })}>
              <option value="">Any</option>
              {GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label>
            <span>Brand</span>
            <input
              defaultValue={params.get('brand') || ''}
              onBlur={(e) => update({ brand: e.target.value.trim() })}
              placeholder="e.g. Titan"
            />
          </label>

          <div className="row">
            <label style={{ flex: 1 }}>
              <span>Min ₹</span>
              <input
                type="number" min="0"
                defaultValue={params.get('minPrice') ? toRupees(Number(params.get('minPrice'))) : ''}
                onBlur={(e) => update({ minPrice: e.target.value ? toPaise(e.target.value) : '' })}
              />
            </label>
            <label style={{ flex: 1 }}>
              <span>Max ₹</span>
              <input
                type="number" min="0"
                defaultValue={params.get('maxPrice') ? toRupees(Number(params.get('maxPrice'))) : ''}
                onBlur={(e) => update({ maxPrice: e.target.value ? toPaise(e.target.value) : '' })}
              />
            </label>
          </div>

          <label>
            <span>Minimum rating</span>
            <select value={params.get('minRating') || ''} onChange={(e) => update({ minRating: e.target.value })}>
              <option value="">Any rating</option>
              {[4, 3, 2, 1].map((r) => <option key={r} value={r}>{r}★ & above</option>)}
            </select>
          </label>

          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={inStock} onChange={(e) => update({ inStock: e.target.checked ? 'true' : '' })} />
            <span>In stock only</span>
          </label>

          <button type="button" className="btn secondary small" onClick={() => setParams(new URLSearchParams())}>
            Clear filters
          </button>
        </aside>

        <section>
          <div className="row between mb">
            <span className="muted small">Page {data.page} of {totalPages}</span>
            <label className="row" style={{ gap: 8, marginBottom: 0 }}>
              <span className="small">Sort</span>
              <select value={sort} onChange={(e) => update({ sort: e.target.value })} style={{ width: 'auto' }}>
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          {error && <div className="alert error">{error}</div>}

          {loading ? (
            <p className="muted">Loading…</p>
          ) : data.products.length === 0 ? (
            <p className="muted">No products match these filters.</p>
          ) : (
            <div className="product-grid">
              {data.products.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          )}

          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn secondary small" disabled={page <= 1} onClick={() => update({ page: page - 1 })}>
                Previous
              </button>
              <span className="small">Page {page} / {totalPages}</span>
              <button className="btn secondary small" disabled={page >= totalPages} onClick={() => update({ page: page + 1 })}>
                Next
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
