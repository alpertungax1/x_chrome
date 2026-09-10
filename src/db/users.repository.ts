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
          numericId: user.numericId || existing.numericId,
          isFollowing: Boolean(existing.isFollowing || user.isFollowing),
          isFollower: Boolean(existing.isFollower || user.isFollower),
          scanOrder: typeof user.scanOrder === 'number' ? user.scanOrder : existing.scanOrder,
          followedAt: user.followedAt ?? existing.followedAt,
          followerSince: user.followerSince ?? existing.followerSince,
          lastSeenAt: Date.now(),
        } as XUser);
      } else {
        tx.store.put({
          ...user,
          id,
          numericId: user.numericId,
          username: user.username || id,
          displayName: user.displayName || user.username || id,
          isFollowing: Boolean(user.isFollowing),
          isFollower: Boolean(user.isFollower),
          firstSeenAt: user.firstSeenAt ?? Date.now(),
          lastSeenAt: Date.now(),
          scanOrder: user.scanOrder,
          followedAt: user.followedAt,
          followerSince: user.followerSince,
        } as XUser);
      }
    }

    await tx.done;
  },

  /**
   * Listeyi tamamen siler ve verilen kullanıcılarla yeniden oluşturur.
   * Manuel temizlik / nadir senaryolar için; tarama bunu kullanmaz.
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

  /**
   * Tarama sonucunu mevcut DB ile birleştir.
   * - Eski kayıtları silmez
   * - Yeni kullanıcı ekler
   * - Güncellenebilir alanları (isim, sayılar, bayraklar) yazar
   * - followingComplete: following listesinde görünmeyenlerin isFollowing=false
   * - followersComplete: followers listesinde görünmeyenlerin isFollower=false
   */
  async mergeScan(
    followingUsers: Partial<XUser>[],
    followersUsers: Partial<XUser>[] = [],
    opts: { followingComplete?: boolean; followersComplete?: boolean } = {}
  ): Promise<{ total: number; added: number; updated: number }> {
    const followingComplete = Boolean(opts.followingComplete);
    const followersComplete = Boolean(opts.followersComplete);

    const scanned = mergeScanUsers(followingUsers, followersUsers);
    const followingIds = new Set(
      followingUsers
        .map((u) => normalizeId((u.id || u.username || '') as string))
        .filter(Boolean)
    );
    const followerIds = new Set(
      followersUsers
        .map((u) => normalizeId((u.id || u.username || '') as string))
        .filter(Boolean)
    );

    const db = await getDB();
    const tx = db.transaction('users', 'readwrite');
    const now = Date.now();
    let added = 0;
    let updated = 0;
    const touched = new Set<string>();

    for (const user of scanned) {
      if (!user.id && !user.username) continue;
      const id = normalizeId((user.id || user.username)!);
      touched.add(id);
      const existing = await tx.store.get(id);

      let isFollowing: boolean;
      let isFollower: boolean;
      if (followingComplete) {
        isFollowing = followingIds.has(id) || Boolean(user.isFollowing);
      } else {
        isFollowing = Boolean(existing?.isFollowing || user.isFollowing);
      }
      if (followersComplete) {
        isFollower = followerIds.has(id) || Boolean(user.isFollower);
      } else {
        isFollower = Boolean(existing?.isFollower || user.isFollower);
      }

      if (existing) {
        const next: XUser = {
          ...existing,
          username: user.username || existing.username,
          displayName: user.displayName || existing.displayName,
          avatarUrl: user.avatarUrl || existing.avatarUrl,
          bio: user.bio ?? existing.bio,
          numericId: user.numericId || existing.numericId,
          isFollowing,
          isFollower,
          firstSeenAt: existing.firstSeenAt || user.firstSeenAt || now,
          lastSeenAt: now,
          scanOrder: typeof user.scanOrder === 'number' ? user.scanOrder : existing.scanOrder,
          followedAt: user.followedAt ?? existing.followedAt,
          followerSince: user.followerSince ?? existing.followerSince,
          followersCount:
            typeof user.followersCount === 'number'
              ? user.followersCount
              : existing.followersCount,
          followingCount:
            typeof user.followingCount === 'number'
              ? user.followingCount
              : existing.followingCount,
        };
        if (existing.isFollowing && !isFollowing) {
          next.unfollowedAt = now;
        }
        if (!existing.isFollower && isFollower) {
          next.followerSince = now;
        }
        await tx.store.put(next);
        updated++;
      } else {
        await tx.store.put({
          id,
          numericId: user.numericId,
          username: user.username || id,
          displayName: user.displayName || user.username || id,
          avatarUrl: user.avatarUrl,
          bio: user.bio,
          isFollowing,
          isFollower,
          firstSeenAt: user.firstSeenAt ?? now,
          lastSeenAt: now,
          scanOrder: user.scanOrder,
          followedAt: user.followedAt,
          followerSince: user.followerSince ?? (isFollower ? now : undefined),
          followersCount: user.followersCount,
          followingCount: user.followingCount,
        } as XUser);
        added++;
      }
    }

    // Tam taranan listelerde artık görünmeyenlerin bayraklarını düşür (kayıt silinmez)
    if (followingComplete || followersComplete) {
      let cursor = await tx.store.openCursor();
      while (cursor) {
        const existing = cursor.value as XUser;
        if (!touched.has(existing.id)) {
          let isFollowing = existing.isFollowing;
          let isFollower = existing.isFollower;
          if (followingComplete) isFollowing = false;
          if (followersComplete) isFollower = false;

          if (
            isFollowing !== existing.isFollowing ||
            isFollower !== existing.isFollower
          ) {
            const next: XUser = {
              ...existing,
              isFollowing,
              isFollower,
              lastSeenAt: now,
            };
            if (existing.isFollowing && !isFollowing) {
              next.unfollowedAt = now;
            }
            await cursor.update(next);
            updated++;
          }
        }
        cursor = await cursor.continue();
      }
    }

    await tx.done;
    const all = await this.getAll();
    return { total: all.length, added, updated };
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
      numericId: user.numericId || prev?.numericId,
      username: user.username || prev?.username || id,
      displayName: user.displayName || prev?.displayName || user.username || id,
      isFollowing: Boolean(prev?.isFollowing || user.isFollowing || defaults.isFollowing),
      isFollower: Boolean(prev?.isFollower || user.isFollower || defaults.isFollower),
      scanOrder: typeof user.scanOrder === 'number' ? user.scanOrder : prev?.scanOrder,
      followedAt: user.followedAt ?? prev?.followedAt,
      followerSince: user.followerSince ?? prev?.followerSince,
      firstSeenAt: user.firstSeenAt ?? prev?.firstSeenAt,
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
