import { getDB } from './database';
import { RelationshipSnapshot, RelationshipChange } from '../types/user';

export const snapshotRepository = {
  async add(snapshot: RelationshipSnapshot): Promise<void> {
    const db = await getDB();
    await db.put('snapshots', snapshot);
  },
  
  async getLatestByUserId(userId: string): Promise<RelationshipSnapshot | undefined> {
    const db = await getDB();
    // This is a simple implementation. In a real app we might want to use a cursor sorted by timestamp.
    // For simplicity, we fetch all by index and sort in memory.
    const snapshots = await db.getAllFromIndex('snapshots', 'by-userId', userId);
    return snapshots.sort((a, b) => b.timestamp - a.timestamp)[0];
  }
};

export const changeRepository = {
  async add(change: RelationshipChange): Promise<void> {
    const db = await getDB();
    await db.put('changes', change);
  },

  async getAll(): Promise<RelationshipChange[]> {
    const db = await getDB();
    return db.getAll('changes');
  }
};
