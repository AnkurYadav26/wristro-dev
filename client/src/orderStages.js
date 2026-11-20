/**
 * The delivery checkpoints the admin can move a product to, in order.
 * Mirrors the server list (server/src/models/Order.js) — the customer timeline itself is
 * rendered from the API's `timeline` array, so both sides can never drift apart.
 */
export const STAGE_STEPS = [
  { status: 'confirmed', label: 'Order Confirmed' },
  { status: 'shipped', label: 'Shipped' },
  { status: 'out_for_delivery', label: 'Out for Delivery' },
  { status: 'delivered', label: 'Delivered Successfully' },
];
