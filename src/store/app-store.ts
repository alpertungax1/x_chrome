import { create } from 'zustand';
import { XUser, ScanSession } from '../types/user';
import { userRepository, mergeScanUsers } from '../db/users.repository';
import { relationshipAnalyzer } from '../analysis/relationship-analyzer';

function computeStats(users: XUser[]) {
  return {
    followers: users.filter((u) => u.isFollower).length,
    following: users.filter((u) => u.isFollowing).length,
    notFollowing: relationshipAnalyzer.findNotFollowingMe(users).length,
    mutuals: relationshipAnalyzer.findMutuals(users).length,
  };
}

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
  /** Eski listeyi siler, following+followers birleşimini yazar. */
  replaceWithScan: (
    followingUsers: Partial<XUser>[],
    followersUsers?: Partial<XUser>[]
  ) => Promise<number>;
  clearUsers: () => Promise<void>;
  /** Takipten çıkınca listeden düş (takipçi değilse sil). */
  applyUnfollow: (username: string) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setCurrentSession: (session: ScanSession | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
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
      set({
        users,
        stats: computeStats(users),
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to load users:', error);
      set({ isLoading: false });
    }
  },

  clearUsers: async () => {
    await userRepository.clear();
    set({
      users: [],
      stats: { followers: 0, following: 0, notFollowing: 0, mutuals: 0 },
    });
  },

  replaceWithScan: async (followingUsers, followersUsers = []) => {
    const merged = mergeScanUsers(followingUsers, followersUsers);
    await userRepository.replaceAll(merged);
    const users = await userRepository.getAll();
    set({
      users,
      stats: computeStats(users),
      isLoading: false,
    });
    console.log(`Replaced user list with ${users.length} users from scan`);
    return users.length;
  },

  applyUnfollow: async (username: string) => {
    await userRepository.applyUnfollow(username);
    // UI'yi anında güncelle
    const id = username.trim().replace(/^@/, '').toLowerCase();
    const prev = get().users;
    const next = prev
      .map((u) =>
        u.id === id || u.username.toLowerCase() === id
          ? { ...u, isFollowing: false, unfollowedAt: Date.now() }
          : u
      )
      .filter((u) => u.isFollowing || u.isFollower);

    set({
      users: next,
      stats: computeStats(next),
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setCurrentSession: (session) => set({ currentSession: session }),
}));
