import { getDB } from './database';
import { XUser } from '../types/user';

function normalizeId(idOrUsername: string): string {
  return idOrUsername.trim().replace(/^@/, '').toLowerCase();
}

export const userRepository = {
  async getAll(): Promise<XUser[]> {
    const db = await getDB();
    return db.getAll('users');
  },

  async getById(id: string): Promise<XUser | undefined> {
    const db = await getDB();
    return db.get('users', normalizeId(id));
  },

  /** Mevcut kayıtlarla birleştirerek yazar (eski davranış). */
  async saveBatch(users: Partial<XUser>[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('users', 'readwrite');

    for (const user of users) {
      if (!user.id && !user.username) continue;
      const id = normalizeId((user.id || user.username)!);
      const existing = await tx.store.get(id);
      if (existing) {
        tx.store.put({
          ...existing,
          ...user,
          id,
          isFollowing: Boolean(existing.isFollowing || user.isFollowing),
          isFollower: Boolean(existing.isFollower || user.isFollower),
          lastSeenAt: Date.now(),
        } as XUser);
      } else {
        tx.store.put({
          ...user,
          id,
          username: user.username || id,
          displayName: user.displayName || user.username || id,
          isFollowing: Boolean(user.isFollowing),
          isFollower: Boolean(user.isFollower),
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
        } as XUser);
      }
    }

    await tx.done;
  },

  /**
   * Listeyi tamamen siler ve verilen kullanıcılarla yeniden oluşturur.
   * Her tam tarama sonunda kullanılmalı.
   */
  async replaceAll(users: Partial<XUser>[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('users', 'readwrite');
    await tx.store.clear();

    const now = Date.now();
    for (const user of users) {
      if (!user.id && !user.username) continue;
      const id = normalizeId((user.id || user.username)!);
      await tx.store.put({
        ...user,
        id,
        username: user.username || id,
        displayName: user.displayName || user.username || id,
        isFollowing: Boolean(user.isFollowing),
        isFollower: Boolean(user.isFollower),
        firstSeenAt: user.firstSeenAt ?? now,
        lastSeenAt: now,
      } as XUser);
    }

    await tx.done;
  },

  async clear(): Promise<void> {
    const db = await getDB();
    await db.clear('users');
  },

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('users', normalizeId(id));
  },

  /**
   * Takipten çıkarılan kullanıcıyı listeden düşür.
   * Hâlâ takipçiyse sadece isFollowing=false; değilse kaydı sil.
   */
  async applyUnfollow(username: string): Promise<void> {
    const id = normalizeId(username);
    const db = await getDB();
    const existing = await db.get('users', id);
    if (!existing) return;

    if (existing.isFollower) {
      await db.put('users', {
        ...existing,
        isFollowing: false,
        unfollowedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
    } else {
      await db.delete('users', id);
    }
  },
};

/** Following + Followers tarama sonuçlarını birleştir (OR bayrakları). */
export function mergeScanUsers(
  followingUsers: Partial<XUser>[],
  followersUsers: Partial<XUser>[] = []
): Partial<XUser>[] {
  const map = new Map<string, Partial<XUser>>();

  const upsert = (user: Partial<XUser>, defaults: { isFollowing?: boolean; isFollower?: boolean }) => {
    if (!user.id && !user.username) return;
    const id = normalizeId((user.id || user.username)!);
    const prev = map.get(id);
    map.set(id, {
      ...prev,
      ...user,
      id,
      username: user.username || prev?.username || id,
      displayName: user.displayName || prev?.displayName || user.username || id,
      isFollowing: Boolean(prev?.isFollowing || user.isFollowing || defaults.isFollowing),
      isFollower: Boolean(prev?.isFollower || user.isFollower || defaults.isFollower),
      followersCount:
        typeof user.followersCount === 'number'
          ? user.followersCount
          : prev?.followersCount,
      followingCount:
        typeof user.followingCount === 'number'
          ? user.followingCount
          : prev?.followingCount,
    });
  };

  for (const u of followingUsers) {
    // following sayfasından gelenler en azından isFollowing
    upsert(u, { isFollowing: true });
  }
  for (const u of followersUsers) {
    upsert(u, { isFollower: true });
  }

  return Array.from(map.values());
}
