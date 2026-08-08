import { create } from 'zustand';
import { XUser, ScanSession } from '../types/user';
import { userRepository } from '../db/users.repository';
import { relationshipAnalyzer } from '../analysis/relationship-analyzer';

interface AppState {
  users: XUser[];
  stats: {
    followers: number;
    following: number;
    notFollowing: number;
    mutuals: number;
  };
  isLoading: boolean;
  currentSession: ScanSession | null;
  loadUsers: () => Promise<void>;
  saveScannedUsers: (users: XUser[]) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setCurrentSession: (session: ScanSession | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  users: [],
  stats: {
    followers: 0,
    following: 0,
    notFollowing: 0,
    mutuals: 0,
  },
  isLoading: false,
  currentSession: null,
  
  loadUsers: async () => {
    set({ isLoading: true });
    try {
      const users = await userRepository.getAll();
      const notFollowing = relationshipAnalyzer.findNotFollowingMe(users).length;
      const mutuals = relationshipAnalyzer.findMutuals(users).length;
      const followers = users.filter(u => u.isFollower).length;
      const following = users.filter(u => u.isFollowing).length;

      set({
        users,
        stats: { followers, following, notFollowing, mutuals },
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to load users:', error);
      set({ isLoading: false });
    }
  },

  saveScannedUsers: async (scannedUsers: XUser[]) => {
    try {
      if (scannedUsers && scannedUsers.length > 0) {
        await userRepository.saveBatch(scannedUsers);
        console.log(`Saved ${scannedUsers.length} users to IndexedDB`);
      }
    } catch (error) {
      console.error('Failed to save scanned users:', error);
    }
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setCurrentSession: (session) => set({ currentSession: session }),
}));
