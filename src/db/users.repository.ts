import { getDB } from './database';
import { XUser } from '../types/user';

export const userRepository = {
  async getAll(): Promise<XUser[]> {
    const db = await getDB();
    return db.getAll('users');
  },

  async getById(id: string): Promise<XUser | undefined> {
    const db = await getDB();
    return db.get('users', id);
  },

  async saveBatch(users: Partial<XUser>[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('users', 'readwrite');
    
    for (const user of users) {
      if (user.id) {
        const existing = await tx.store.get(user.id);
        if (existing) {
          // Merge
          tx.store.put({
            ...existing,
            ...user,
            lastSeenAt: Date.now()
          } as XUser);
        } else {
          tx.store.put({
            ...user,
            firstSeenAt: Date.now(),
            lastSeenAt: Date.now()
          } as XUser);
        }
      }
    }
    
    await tx.done;
  },

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('users', id);
  },

  async clear(): Promise<void> {
    const db = await getDB();
    await db.clear('users');
  }
};
