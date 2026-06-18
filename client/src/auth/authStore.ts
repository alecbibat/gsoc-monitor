import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  setUser: (u: AuthUser | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  setUser: (user) => set({ user, loading: false }),
}));
