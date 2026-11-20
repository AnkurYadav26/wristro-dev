import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from './AuthContext';

const CartContext = createContext(null);

const EMPTY = { items: [], itemCount: 0, pricing: null, totals: null };

export function CartProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [cart, setCart] = useState(EMPTY);

  /** Fetch the server-priced cart. `coupon` is optional (shows the coupon preview). */
  const reload = useCallback(async (coupon) => {
    if (!user) { setCart(EMPTY); return EMPTY; }
    const data = await api('GET', '/cart', { query: { coupon } });
    setCart(data);
    return data;
  }, [user]);

  // The cart lives server-side per user: reload on login, clear on logout.
  useEffect(() => {
    if (authLoading) return;
    let alive = true;
    reload().catch(() => { if (alive) setCart(EMPTY); });
    return () => { alive = false; };
  }, [authLoading, reload]);

  const add = useCallback(async (productId, quantity = 1) => {
    const data = await api('POST', '/cart/items', { body: { productId, quantity } });
    setCart(data);
    return data;
  }, []);

  const setQty = useCallback(async (productId, quantity) => {
    const data = await api('PUT', `/cart/items/${productId}`, { body: { quantity } });
    setCart(data);
    return data;
  }, []);

  const remove = useCallback(async (productId) => {
    const data = await api('DELETE', `/cart/items/${productId}`);
    setCart(data);
    return data;
  }, []);

  const clear = useCallback(async () => {
    const data = await api('DELETE', '/cart');
    setCart(data);
    return data;
  }, []);

  const value = {
    ...cart,
    count: cart.itemCount || 0,
    add, setQty, remove, clear, reload,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
