import { XUser } from '../types/user';

export interface SorsaFetchResult {
  success: boolean;
  updates: Partial<XUser>[];
  error?: string;
}

export async function fetchFollowerCounts(
  usernames: string[],
  apiKey: string,
  onProgress?: (fetched: number, total: number) => void
): Promise<SorsaFetchResult> {
  const chunkSize = 100;
  const updates: Partial<XUser>[] = [];
  const total = usernames.length;
  let fetched = 0;

  for (let i = 0; i < total; i += chunkSize) {
    const chunk = usernames.slice(i, i + chunkSize);
    const params = new URLSearchParams();
    chunk.forEach((username) => params.append('usernames', username));

    try {
      const response = await fetch(`https://api.sorsa.io/v3/info-batch?${params.toString()}`, {
        method: 'GET',
        headers: {
          'ApiKey': apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        let errorMsg = `HTTP Error ${response.status}`;
        try {
          const errData = await response.json();
          if (errData.message) errorMsg = errData.message;
        } catch {
          // ignore parsing error
        }
        return { success: false, updates, error: errorMsg };
      }

      const data = await response.json();
      const users = data.users || [];

      for (const u of users) {
        if (!u.username) continue;
        updates.push({
          id: u.username.toLowerCase(),
          username: u.username,
          followersCount: u.followers_count,
          followingCount: u.followings_count,
          displayName: u.display_name,
        });
      }

      fetched += chunk.length;
      if (onProgress) {
        onProgress(Math.min(fetched, total), total);
      }

      // Kısa bir bekleme (hız sınırlarını aşmamak için)
      if (i + chunkSize < total) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (err: any) {
      return { success: false, updates, error: err.message || 'Network error' };
    }
  }

  return { success: true, updates };
}

export interface SorsaFullScanResult {
  success: boolean;
  followingUsers: Partial<XUser>[];
  followersUsers: Partial<XUser>[];
  error?: string;
}

async function fetchPaginated(
  endpoint: 'followers' | 'follows',
  username: string,
  apiKey: string,
  flagField: 'isFollower' | 'isFollowing',
  onProgress: (fetched: number) => void,
  shouldAbort?: () => boolean
): Promise<{ users: Partial<XUser>[]; error?: string }> {
  let cursor: string | null = null;
  const allUsers: Partial<XUser>[] = [];

  while (true) {
    if (shouldAbort && shouldAbort()) {
      break;
    }
    
    let url = `https://api.sorsa.io/v3/${endpoint}?username=${encodeURIComponent(username)}`;
    if (cursor) {
      url += `&next_cursor=${encodeURIComponent(cursor)}`;
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'ApiKey': apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        let errorMsg = `HTTP Error ${response.status}`;
        try {
          const errData = await response.json();
          if (errData.message) errorMsg = errData.message;
        } catch {}
        return { users: allUsers, error: errorMsg };
      }

      const data = await response.json();
      const users = data.users || [];
      
      for (const u of users) {
        if (!u.username) continue;
        allUsers.push({
          id: u.username.toLowerCase(),
          username: u.username,
          followersCount: u.followers_count,
          followingCount: u.followings_count,
          displayName: u.display_name,
          [flagField]: true,
        });
      }

      onProgress(allUsers.length);
      const nextCursor = data.next_cursor;
      
      if (!nextCursor || nextCursor === '0' || nextCursor === 0 || nextCursor === '-1' || nextCursor === cursor || users.length === 0) {
        break; // Bitti veya sonsuz döngü engellendi
      }
      
      cursor = nextCursor;
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (err: any) {
      return { users: allUsers, error: err.message || 'Network error' };
    }
  }

  return { users: allUsers };
}

export async function fullScanWithSorsa(
  username: string,
  apiKey: string,
  onStatusUpdate: (status: string) => void,
  shouldAbort?: () => boolean
): Promise<SorsaFullScanResult> {
  const cleanUsername = username.replace(/^@/, '');
  
  onStatusUpdate(`Sorsa'dan Takip Edilenler çekiliyor...`);
  const followingResult = await fetchPaginated('follows', cleanUsername, apiKey, 'isFollowing', (count) => {
    onStatusUpdate(`Sorsa'dan Takip Edilenler çekiliyor... (${count})`);
  }, shouldAbort);
  
  if (shouldAbort && shouldAbort()) {
    return {
      success: true,
      followingUsers: followingResult.users,
      followersUsers: []
    };
  }
  
  if (followingResult.error) {
    return { success: false, followingUsers: [], followersUsers: [], error: `Takip edilenler hatası: ${followingResult.error}` };
  }

  onStatusUpdate(`Sorsa'dan Takipçiler çekiliyor...`);
  const followersResult = await fetchPaginated('followers', cleanUsername, apiKey, 'isFollower', (count) => {
    onStatusUpdate(`Sorsa'dan Takipçiler çekiliyor... (${count})`);
  }, shouldAbort);
  
  if (followersResult.error) {
    return { success: false, followingUsers: followingResult.users, followersUsers: [], error: `Takipçiler hatası: ${followersResult.error}` };
  }

  return {
    success: true,
    followingUsers: followingResult.users,
    followersUsers: followersResult.users,
  };
}
