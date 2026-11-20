import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api('GET', '/auth/me');
      setUser(data.user);
      return data.user;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await refresh();
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const data = await api('POST', '/auth/login', { body: { email, password } });
    if (data.user) setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try { await api('POST', '/auth/logout'); } catch { /* already logged out */ }
    setUser(null);
  }, []);

  const value = { user, loading, refresh, login, logout, setUser };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
