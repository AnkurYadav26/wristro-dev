import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { inr, toPaise, toRupees } from '../../format';

const BLANK = {
  name: '', sku: '', brand: '', categoryId: '', watchType: 'analog', gender: 'unisex',
  variantGroup: '', colour: '', description: '',
  imagesText: '', featuresText: '', specsText: '',
  supplierId: '', purchaseCostRupees: '', mrpRupees: '',
  mrpSourceName: '', mrpSourceUrl: '', mrpSourceNote: '',
  discountPercent: '40', gstPercent: '18', minMarginPercent: '10', allowBelowCostCoupon: false,
  lowStockThreshold: '5', weightGrams: '', dimLength: '', dimWidth: '', dimHeight: '',
  warrantyMonths: '0', warrantyNote: '', returnEligible: true, returnWindowDays: '7', isActive: true,
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== '' ? n : undefined;
};

/** Longest side an uploaded image is downscaled to, and the JPEG quality used when re-encoding. */
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;
/** Raw file must be under this before we even try; the resized result is far smaller. */
const MAX_RAW_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Read a file as a base64 data URL with no processing (used as a fallback). */
const readRawDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });

const loadImageElement = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });

/**
 * Read a picked file as a base64 data URL for upload, automatically resizing it first.
 * Phone photos are often several MB; downscaling to MAX_IMAGE_DIMENSION and re-encoding as
 * JPEG keeps uploads fast and reliable and gives every product card an evenly sized image.
 * Animated GIFs and images the browser cannot decode are passed through untouched.
 */
const fileToDataUrl = async (file) => {
  if (file.type === 'image/gif' || !file.type.startsWith('image/')) return readRawDataUrl(file);
  try {
    const img = await loadImageElement(file);
    const longest = Math.max(img.width, img.height);
    const scale = longest > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / longest : 1;
    // Already small and in a web-friendly format? Send it as-is.
    if (scale === 1 && file.type !== 'image/png' && file.size <= 1024 * 1024) return readRawDataUrl(file);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // flatten transparency so PNGs don't turn black in JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch {
    return readRawDataUrl(file);
  }
};

/** The image URLs currently on the form, in display order. */
const imageUrlsOf = (imagesText) => imagesText.split('\n').map((s) => s.trim()).filter(Boolean);

/** Convert the form into the exact body the API accepts (strict schemas reject unknown keys). */
function buildPayload(form) {
  const p = {};
  if (form.name.trim()) p.name = form.name.trim();
  if (form.sku.trim()) p.sku = form.sku.trim();
  if (form.brand.trim()) p.brand = form.brand.trim();
  if (form.categoryId) p.categoryId = form.categoryId;
  if (form.watchType) p.watchType = form.watchType;
  if (form.gender) p.gender = form.gender;
  if (form.variantGroup.trim()) p.variantGroup = form.variantGroup.trim();
  if (form.colour.trim()) p.colour = form.colour.trim();
  p.description = form.description || '';

  const images = imageUrlsOf(form.imagesText).map((url) => ({ url }));
  if (images.length) p.images = images;

  const features = form.featuresText.split('\n').map((s) => s.trim()).filter(Boolean);
  if (features.length) p.features = features;

  const specifications = form.specsText
    .split('\n')
    .map((line) => {
      const i = line.indexOf(':');
      if (i < 0) return null;
      const key = line.slice(0, i).trim();
      const value = line.slice(i + 1).trim();
      return key && value ? { key, value } : null;
    })
    .filter(Boolean);
  if (specifications.length) p.specifications = specifications;

  if (form.supplierId) p.supplierId = form.supplierId;

  const cost = num(form.purchaseCostRupees);
  if (cost !== undefined) p.purchaseCostPaise = toPaise(cost);

  const mrp = num(form.mrpRupees);
  if (mrp !== undefined) p.mrpPaise = toPaise(mrp);

  if (form.mrpSourceName.trim()) {
    p.mrpSource = { name: form.mrpSourceName.trim() };
    if (form.mrpSourceUrl.trim()) p.mrpSource.url = form.mrpSourceUrl.trim();
    if (form.mrpSourceNote.trim()) p.mrpSource.note = form.mrpSourceNote.trim();
  }

  const discount = num(form.discountPercent);
  if (discount !== undefined) p.discountPercent = discount;
  const gst = num(form.gstPercent);
  if (gst !== undefined) p.gstPercent = gst;
  const margin = num(form.minMarginPercent);
  if (margin !== undefined) p.minMarginPercent = margin;
  p.allowBelowCostCoupon = !!form.allowBelowCostCoupon;

  const low = num(form.lowStockThreshold);
  if (low !== undefined) p.lowStockThreshold = low;

  const weight = num(form.weightGrams);
  if (weight !== undefined) p.weightGrams = weight;

  const l = num(form.dimLength);
  const w = num(form.dimWidth);
  const h = num(form.dimHeight);
  if (l !== undefined && w !== undefined && h !== undefined) p.dimensionsMm = { length: l, width: w, height: h };

  const warranty = num(form.warrantyMonths);
  if (warranty !== undefined) p.warrantyMonths = warranty;
  if (form.warrantyNote.trim()) p.warrantyNote = form.warrantyNote.trim();
  p.returnEligible = !!form.returnEligible;
  const rw = num(form.returnWindowDays);
  if (rw !== undefined) p.returnWindowDays = rw;
  p.isActive = !!form.isActive;

  return p;
}

export default function AdminProductForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);

  const [form, setForm] = useState(BLANK);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cloudinaryReady, setCloudinaryReady] = useState(null); // null = unknown, until /status answers

  useEffect(() => {
    (async () => {
      try {
        const [c, s, up] = await Promise.all([
          api('GET', '/admin/categories'),
          api('GET', '/admin/suppliers'),
          api('GET', '/admin/uploads/status'),
        ]);
        setCategories(c.categories || []);
        setSuppliers(s.suppliers || []);
        setCloudinaryReady(Boolean(up.configured));
      } catch (err) { setError(err.message); }
    })();
  }, []);

  useEffect(() => {
    if (!editing) { setForm(BLANK); return; }
    (async () => {
      try {
        const { product: p } = await api('GET', `/admin/products/${id}`);
        setSlug(p.slug || '');
        setForm({
          ...BLANK,
          name: p.name || '', sku: p.sku || '', brand: p.brand || '',
          categoryId: String(p.categoryId || ''), watchType: p.watchType || 'analog', gender: p.gender || 'unisex',
          variantGroup: p.variantGroup || '', colour: p.colour || '', description: p.description || '',
          imagesText: (p.images || []).map((i) => i.url).join('\n'),
          featuresText: (p.features || []).join('\n'),
          specsText: (p.specifications || []).map((s) => `${s.key}: ${s.value}`).join('\n'),
          supplierId: p.supplierId ? String(p.supplierId) : '',
          purchaseCostRupees: p.purchaseCostPaise ? String(toRupees(p.purchaseCostPaise)) : '',
          mrpRupees: p.mrpPaise ? String(toRupees(p.mrpPaise)) : '',
          mrpSourceName: p.mrpSource?.name || '', mrpSourceUrl: p.mrpSource?.url || '', mrpSourceNote: p.mrpSource?.note || '',
          discountPercent: p.discountPercent != null ? String(p.discountPercent) : '40',
          gstPercent: p.gstPercent != null ? String(p.gstPercent) : '18',
          minMarginPercent: p.minMarginPercent != null ? String(p.minMarginPercent) : '10',
          allowBelowCostCoupon: !!p.allowBelowCostCoupon,
          lowStockThreshold: p.lowStockThreshold != null ? String(p.lowStockThreshold) : '5',
          weightGrams: p.weightGrams != null ? String(p.weightGrams) : '',
          dimLength: p.dimensionsMm?.length != null ? String(p.dimensionsMm.length) : '',
          dimWidth: p.dimensionsMm?.width != null ? String(p.dimensionsMm.width) : '',
          dimHeight: p.dimensionsMm?.height != null ? String(p.dimensionsMm.height) : '',
          warrantyMonths: p.warrantyMonths != null ? String(p.warrantyMonths) : '0',
          warrantyNote: p.warrantyNote || '',
          returnEligible: p.returnEligible !== false,
          returnWindowDays: p.returnWindowDays != null ? String(p.returnWindowDays) : '7',
          isActive: p.isActive !== false,
        });
      } catch (err) { setError(err.message); }
    })();
  }, [editing, id]);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  // Upload each picked file to Cloudinary (via the server) and append its URL to the list.
  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow picking the same file again
    if (!files.length) return;
    const notImage = files.find((f) => !f.type.startsWith('image/'));
    if (notImage) { setError(`${notImage.name} is not an image.`); return; }
    const tooBig = files.find((f) => f.size > MAX_RAW_UPLOAD_BYTES);
    if (tooBig) { setError(`${tooBig.name} is larger than 25 MB. Please use a smaller image.`); return; }

    setUploading(true);
    setError('');
    setNotice('');
    try {
      const urls = [];
      for (const file of files) {
        const dataUrl = await fileToDataUrl(file); // auto-resized before sending
        const r = await api('POST', '/admin/uploads', { body: { dataUrl } });
        urls.push(r.image.url);
      }
      setForm((f) => ({ ...f, imagesText: [...imageUrlsOf(f.imagesText), ...urls].join('\n') }));
      setNotice(`${urls.length} image${urls.length > 1 ? 's' : ''} uploaded to Cloudinary (auto-resized). Click “Save” to apply.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (url) =>
    setForm((f) => ({ ...f, imagesText: imageUrlsOf(f.imagesText).filter((u) => u !== url).join('\n') }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = buildPayload(form);
      if (editing) {
        await api('PATCH', `/admin/products/${id}`, { body: payload });
        setNotice('Product saved.');
      } else {
        const r = await api('POST', '/admin/products', { body: payload });
        navigate(`/admin/products/${r.product._id}`);
        return;
      }
    } catch (err) {
      setError(
        Array.isArray(err.details)
          ? err.details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message)).join(' · ')
          : err.message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="row between mb">
        <h2>{editing ? 'Edit product' : 'New product'}</h2>
        <Link to="/admin/products" className="btn secondary small">Back to products</Link>
      </div>

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}

      {editing && (
        <p className="muted small">
          Attached inventory: {form.mrpRupees ? `MRP ₹${form.mrpRupees}` : ''} · stock is changed from the Inventory page.
          {slug && <> · <a href={`/product/${slug}`} target="_blank" rel="noreferrer">View on storefront ↗</a></>}
        </p>
      )}

      <form className="panel" onSubmit={submit}>
        <h3>Basics</h3>
        <div className="row wrap">
          <label style={{ flex: 2 }}>
            <span>Name *</span>
            <input value={form.name} onChange={set('name')} required maxLength={200} />
          </label>
          <label style={{ flex: 1 }}>
            <span>SKU *</span>
            <input value={form.sku} onChange={set('sku')} required maxLength={40} />
          </label>
        </div>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>Brand *</span>
            <input value={form.brand} onChange={set('brand')} required maxLength={60} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Category *</span>
            <select value={form.categoryId} onChange={set('categoryId')} required>
              <option value="">Select category</option>
              {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>Type *</span>
            <select value={form.watchType} onChange={set('watchType')}>
              {['analog', 'digital', 'smart', 'hybrid'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={{ flex: 1 }}>
            <span>Gender</span>
            <select value={form.gender} onChange={set('gender')}>
              {['unisex', 'men', 'women'].map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label style={{ flex: 1 }}>
            <span>Colour</span>
            <input value={form.colour} onChange={set('colour')} maxLength={40} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Variant group</span>
            <input value={form.variantGroup} onChange={set('variantGroup')} maxLength={60} />
          </label>
        </div>
        <label>
          <span>Description</span>
          <textarea value={form.description} onChange={set('description')} maxLength={5000} />
        </label>

        <div className="mt">
          <span>Images</span>
          <p className="muted small">A product can have several images — the first one is the thumbnail, the rest show in the gallery on the product page.</p>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={onPickFiles}
            disabled={uploading}
          />
          {uploading && <p className="muted small">Uploading…</p>}
          {cloudinaryReady === false && (
            <p className="muted small">
              Cloudinary isn’t configured — uploads are stored on this server for now. Add CLOUDINARY_CLOUD_NAME,
              CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to the server .env to send them to Cloudinary instead.
            </p>
          )}

          {imageUrlsOf(form.imagesText).length > 0 && (
            <div className="row wrap mt" style={{ gap: 10 }}>
              {imageUrlsOf(form.imagesText).map((url, i) => (
                <div key={`${url}-${i}`} style={{ position: 'relative' }}>
                  <img
                    src={url}
                    alt={`Watch image ${i + 1}`}
                    width="88"
                    height="88"
                    style={{ objectFit: 'cover', borderRadius: 6, border: i === 0 ? '2px solid #0b5fff' : '1px solid #ddd', display: 'block' }}
                  />
                  {i === 0 && <span className="muted small">Cover</span>}
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => removeImage(url)}
                    title="Remove image"
                    style={{ position: 'absolute', top: -8, right: -8, padding: '0 6px', lineHeight: '18px' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <label>
          <span>Image URLs (one per line)</span>
          <textarea value={form.imagesText} onChange={set('imagesText')} placeholder="https://…" />
        </label>
        <label>
          <span>Features (one per line)</span>
          <textarea value={form.featuresText} onChange={set('featuresText')} />
        </label>
        <label>
          <span>Specifications (one per line, "Key: Value")</span>
          <textarea value={form.specsText} onChange={set('specsText')} placeholder="Movement: Quartz" />
        </label>

        <h3 className="mt">Pricing</h3>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>MRP ₹ *</span>
            <input type="number" min="0" step="0.01" value={form.mrpRupees} onChange={set('mrpRupees')} required />
          </label>
          <label style={{ flex: 1 }}>
            <span>Purchase cost ₹</span>
            <input type="number" min="0" step="0.01" value={form.purchaseCostRupees} onChange={set('purchaseCostRupees')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Discount %</span>
            <input type="number" min="0" max="90" value={form.discountPercent} onChange={set('discountPercent')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>GST %</span>
            <input type="number" min="0" max="40" value={form.gstPercent} onChange={set('gstPercent')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Min margin %</span>
            <input type="number" min="0" max="500" value={form.minMarginPercent} onChange={set('minMarginPercent')} />
          </label>
        </div>
        <div className="row wrap">
          <label style={{ flex: 2 }}>
            <span>MRP source name</span>
            <input value={form.mrpSourceName} onChange={set('mrpSourceName')} maxLength={80} />
          </label>
          <label style={{ flex: 2 }}>
            <span>MRP source URL</span>
            <input value={form.mrpSourceUrl} onChange={set('mrpSourceUrl')} placeholder="https://…" />
          </label>
          <label style={{ flex: 2 }}>
            <span>MRP source note</span>
            <input value={form.mrpSourceNote} onChange={set('mrpSourceNote')} maxLength={300} />
          </label>
        </div>
        {form.mrpRupees && form.discountPercent !== '' && (
          <p className="muted small">
            Selling price will be ≈ {inr(toPaise(Number(form.mrpRupees)) * (100 - Number(form.discountPercent)) / 100)}
          </p>
        )}
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={form.allowBelowCostCoupon} onChange={set('allowBelowCostCoupon')} />
          <span>Allow coupons to go below cost</span>
        </label>

        <h3 className="mt">Logistics</h3>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>Supplier</span>
            <select value={form.supplierId} onChange={set('supplierId')}>
              <option value="">None</option>
              {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </label>
          <label style={{ flex: 1 }}>
            <span>Low stock threshold</span>
            <input type="number" min="0" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Weight (g)</span>
            <input type="number" min="0" max="5000" value={form.weightGrams} onChange={set('weightGrams')} />
          </label>
        </div>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>Length (mm)</span>
            <input type="number" min="0" value={form.dimLength} onChange={set('dimLength')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Width (mm)</span>
            <input type="number" min="0" value={form.dimWidth} onChange={set('dimWidth')} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Height (mm)</span>
            <input type="number" min="0" value={form.dimHeight} onChange={set('dimHeight')} />
          </label>
        </div>

        <h3 className="mt">Warranty &amp; returns</h3>
        <div className="row wrap">
          <label style={{ flex: 1 }}>
            <span>Warranty (months)</span>
            <input type="number" min="0" max="120" value={form.warrantyMonths} onChange={set('warrantyMonths')} />
          </label>
          <label style={{ flex: 2 }}>
            <span>Warranty note</span>
            <input value={form.warrantyNote} onChange={set('warrantyNote')} maxLength={300} />
          </label>
          <label style={{ flex: 1 }}>
            <span>Return window (days)</span>
            <input type="number" min="0" max="60" value={form.returnWindowDays} onChange={set('returnWindowDays')} />
          </label>
        </div>
        <div className="row wrap">
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={form.returnEligible} onChange={set('returnEligible')} />
            <span>Return eligible</span>
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={form.isActive} onChange={set('isActive')} />
            <span>Active (visible on storefront)</span>
          </label>
        </div>

        <div className="row mt">
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create product'}</button>
        </div>
      </form>
    </div>
  );
}
