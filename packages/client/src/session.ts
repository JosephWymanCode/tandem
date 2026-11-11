import { create } from 'zustand';
import { api, type User } from './api';

interface SessionStore {
  /** False until the first "who am I" request has finished. */
  ready: boolean;
  user: User | null;
  load: () => Promise<void>;
  /** Where the start page should send someone who has just signed in (their new board). */
  landing: string | null;
  setUser: (user: User | null, landing?: string | null) => void;
  logout: () => Promise<void>;
}

export const useSession = create<SessionStore>((set) => ({
  ready: false,
  user: null,
  load: async () => {
    try {
      const { user } = await api.me();
      set({ user, ready: true });
    } catch {
      set({ user: null, ready: true });
    }
  },
  landing: null,
  setUser: (user, landing = null) => set({ user, ready: true, landing }),
  logout: async () => {
    await api.logout().catch(() => undefined);
    set({ user: null, landing: null });
  },
}));
