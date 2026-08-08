import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { XUser, RelationshipSnapshot, RelationshipChange, ScanSession } from '../types/user';

interface XRMDatabase extends DBSchema {
  users: {
    key: string;
    value: XUser;
    indexes: {
      'by-username': string;
      'by-isFollower': number; // booleans as 0 or 1 for indexing
      'by-isFollowing': number;
    };
  };
  snapshots: {
    key: string;
    value: RelationshipSnapshot;
    indexes: {
      'by-userId': string;
      'by-timestamp': number;
    };
  };
  changes: {
    key: string;
    value: RelationshipChange;
    indexes: {
      'by-userId': string;
      'by-timestamp': number;
      'by-type': string;
    };
  };
  scanSessions: {
    key: string;
    value: ScanSession;
    indexes: {
      'by-startedAt': number;
    };
  };
  settings: {
    key: string;
    value: any;
  };
}

let dbPromise: Promise<IDBPDatabase<XRMDatabase>> | null = null;

export const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<XRMDatabase>('x-relationship-manager', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('users')) {
          const userStore = db.createObjectStore('users', { keyPath: 'id' });
          userStore.createIndex('by-username', 'username');
          userStore.createIndex('by-isFollower', 'isFollower');
          userStore.createIndex('by-isFollowing', 'isFollowing');
        }
        
        if (!db.objectStoreNames.contains('snapshots')) {
          const snapshotStore = db.createObjectStore('snapshots', { keyPath: 'id' });
          snapshotStore.createIndex('by-userId', 'userId');
          snapshotStore.createIndex('by-timestamp', 'timestamp');
        }

        if (!db.objectStoreNames.contains('changes')) {
          const changeStore = db.createObjectStore('changes', { keyPath: 'id' });
          changeStore.createIndex('by-userId', 'userId');
          changeStore.createIndex('by-timestamp', 'timestamp');
          changeStore.createIndex('by-type', 'type');
        }

        if (!db.objectStoreNames.contains('scanSessions')) {
          const sessionStore = db.createObjectStore('scanSessions', { keyPath: 'id' });
          sessionStore.createIndex('by-startedAt', 'startedAt');
        }

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      },
    });
  }
  return dbPromise;
};
