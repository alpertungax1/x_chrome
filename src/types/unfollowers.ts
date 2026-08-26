export interface UnfollowerUser {
  id: string;
  username: string;
  name: string;
  avatar: string;
  followers: number;
  followingCount: number;
  followedBy: boolean | null;
  verified: boolean;
  isWhitelisted?: boolean;
}

export interface UnfollowersSettings {
  delaySeconds: number;
  jitter: boolean;
  whitelist: string[]; // List of whitelisted user IDs
  dailyDate: string; // YYYY-MM-DD
  dailyCount: number;
}

export interface UnfollowersProgress {
  total: number;
  current: number;
  username?: string;
  countdownSeconds?: number;
  statusText: string;
  statusType?: 'info' | 'warn' | 'ok' | 'err';
}
