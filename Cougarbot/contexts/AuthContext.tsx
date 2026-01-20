import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiService } from '@/services/api';
import { decodeJWT } from '@/utils/jwt';

interface User {
  user_id: string;
  org_id: string;
  role: 'admin' | 'student';
  email: string;
  name: string;
  profile_pic?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (orgId: string, email: string, password: string) => Promise<void>;
  register: (orgId: string, name: string, email: string, password: string) => Promise<void>;
  authenticateWithTokens: (tokens: { access_token: string; refresh_token: string }, fallback?: { email?: string; name?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = await apiService.getToken();
      if (!token) {
        setHasToken(false);
        setUser(null);
        setLoading(false);
        return;
      }

      // Decode token to get user info and check expiration
      const payload = decodeJWT(token);
      if (!payload) {
        // Invalid token format
        await apiService.logout();
        setHasToken(false);
        setUser(null);
        setLoading(false);
        return;
      }

      // Check if token is expired
      if (payload.exp) {
        const currentTime = Math.floor(Date.now() / 1000);
        if (payload.exp < currentTime) {
          // Token expired, clear it
          await apiService.logout();
          setHasToken(false);
          setUser(null);
          setLoading(false);
          return;
        }
      }

      // Token is valid, fetch user profile to get name and email
      if (payload.sub && payload.org_id && payload.role) {
        setHasToken(true);
        
        // Fetch user profile
        try {
          const profile = await apiService.getMyProfile();
          setUser({
            user_id: profile.id,
            org_id: payload.org_id,
            role: profile.role,
            email: profile.email,
            name: profile.name,
            profile_pic: profile.profile_pic,
          });
        } catch (profileError) {
          // Fallback if profile fetch fails
          setUser({
            user_id: payload.sub,
            org_id: payload.org_id,
            role: payload.role,
            email: '',
            name: '',
          });
        }
      } else {
        // Token missing required fields
        await apiService.logout();
        setHasToken(false);
        setUser(null);
      }
      setLoading(false);
    } catch (error) {
      await apiService.logout();
      setHasToken(false);
      setUser(null);
      setLoading(false);
    }
  };

  const authenticateWithTokens = async (
    tokens: { access_token: string; refresh_token: string },
    fallback?: { email?: string; name?: string }
  ) => {
    await apiService.setToken(tokens.access_token);
    setHasToken(true);
    try {
      const profile = await apiService.getMyProfile();
      setUser({
        user_id: profile.id,
        org_id: decodeJWT(tokens.access_token)?.org_id || '',
        role: profile.role,
        email: profile.email || fallback?.email || '',
        name: profile.name || fallback?.name || '',
        profile_pic: profile.profile_pic,
      });
    } catch (profileError) {
      const payload = decodeJWT(tokens.access_token);
      if (payload && payload.sub && payload.org_id && payload.role) {
        setUser({
          user_id: payload.sub,
          org_id: payload.org_id,
          role: payload.role,
          email: fallback?.email || '',
          name: fallback?.name || '',
        });
      }
    }
  };

  const login = async (orgId: string, email: string, password: string) => {
    try {
      const response = await apiService.login(orgId, email, password);
      await authenticateWithTokens(response.tokens, { email });
    } catch (error: any) {
      setHasToken(false);
      setUser(null);
      throw new Error(error.response?.data?.detail || 'Login failed');
    }
  };

  const register = async (orgId: string, name: string, email: string, password: string) => {
    try {
      const response = await apiService.register(orgId, name, email, password);
      await authenticateWithTokens(response.tokens, { email, name });
    } catch (error: any) {
      setHasToken(false);
      setUser(null);
      throw new Error(error.response?.data?.detail || 'Registration failed');
    }
  };

  const logout = async () => {
    await apiService.logout();
    setUser(null);
    setHasToken(false);
  };

  const refreshUser = async () => {
    try {
      const profile = await apiService.getMyProfile();
      setUser({
        user_id: profile.id,
        org_id: user?.org_id || '',
        role: profile.role,
        email: profile.email,
        name: profile.name,
        profile_pic: profile.profile_pic,
      });
    } catch (error) {}
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: hasToken,
        login,
        register,
        authenticateWithTokens,
        logout,
        refreshUser,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
