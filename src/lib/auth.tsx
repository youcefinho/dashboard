// ── Auth Context — Gestion de l'authentification ────────────

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { login as apiLogin, logout as apiLogout, getStoredUser, isAuthenticated, type LoginResponse } from './api';

interface AuthState {
  isLoggedIn: boolean;
  user: LoginResponse['user'] | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isLoggedIn: isAuthenticated(),
    user: getStoredUser(),
    isLoading: false,
  });

  // Vérifier l'auth au montage
  useEffect(() => {
    if (isAuthenticated() && !state.user) {
      setState(prev => ({ ...prev, isLoggedIn: false, user: null }));
    }
  }, [state.user]);

  const login = useCallback(async (email: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const result = await apiLogin(email, password);

      if (result.error) {
        setState(prev => ({ ...prev, isLoading: false }));
        return { success: false, error: result.error };
      }

      // Extraire les données de login
      const loginData = (result.data || result) as unknown as LoginResponse;
      if (loginData.token && loginData.user) {
        setState({
          isLoggedIn: true,
          user: loginData.user,
          isLoading: false,
        });
        return { success: true };
      }

      setState(prev => ({ ...prev, isLoading: false }));
      return { success: false, error: 'Réponse inattendue du serveur' };
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
      return { success: false, error: 'Erreur de connexion au serveur' };
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setState({ isLoggedIn: false, user: null, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth doit être utilisé dans un AuthProvider');
  }
  return context;
}
