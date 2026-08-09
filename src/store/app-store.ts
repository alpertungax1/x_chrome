import { create } from 'zustand';
import { XUser, ScanSession } from '../types/user';
import { userRepository } from '../db/users.repository';
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
  /**
   * Tarama sonucunu mevcut DB ile birleştirir (silmez).
   * Yeni ekler, güncellemeleri yazar; tam taranan listelerde kaybolan bayrakları düşürür.
   */
  mergeWithScan: (
    followingUsers: Partial<XUser>[],
    followersUsers?: Partial<XUser>[],
    opts?: { followingComplete?: boolean; followersComplete?: boolean }
  ) => Promise<{ total: number; added: number; updated: number }>;
  /** @deprecated Tarama artık silmez; manuel temizlik için tutulur. */
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

  mergeWithScan: async (
    followingUsers,
    followersUsers = [],
    opts = {}
  ) => {
    const result = await userRepository.mergeScan(
      followingUsers,
      followersUsers,
      opts
    );
    const users = await userRepository.getAll();
    set({
      users,
      stats: computeStats(users),
      isLoading: false,
    });
    console.log(
      `Merged scan: +${result.added} new, ~${result.updated} updated, total ${result.total}`
    );
    return result;
  },

  replaceWithScan: async (followingUsers, followersUsers = []) => {
    // Geriye uyumluluk: artık replace değil merge (tam liste varsayımı)
    const result = await get().mergeWithScan(followingUsers, followersUsers, {
      followingComplete: true,
      followersComplete: followersUsers.length > 0,
    });
    return result.total;
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
