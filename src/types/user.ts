export interface XUser {
  id: string; // The primary key (either numeric ID if we can extract, or normalized username)
  username: string; // @username
  displayName: string;
  avatarUrl?: string;
  bio?: string;

  followersCount?: number;
  followingCount?: number;

  isFollowing: boolean; // Does the user (me) follow this account?
  isFollower: boolean;  // Does this account follow the user (me)?

  firstSeenAt: number; // Timestamp when first detected
  lastSeenAt: number;  // Timestamp when last scanned

  followedAt?: number;
  unfollowedAt?: number;

  followerSince?: number;

  mutualCount?: number;
  scanOrder?: number; // Takip/tarama sırası: 0 = En yeni, 1, 2, ... N = En eski
  numericId?: string; // X REST ID / Snowflake ID
  lastTweetAt?: number; // Son gönderi / tweet tarihi (Epoch ms)
  lastTweetText?: string; // Son gönderi metin özeti
}

export interface RelationshipSnapshot {
  id: string;
  userId: string;
  timestamp: number;
  isFollowing: boolean;
  isFollower: boolean;
}

export interface RelationshipChange {
  id: string;
  userId: string;
  type: "FOLLOWED_ME" | "UNFOLLOWED_ME" | "I_FOLLOWED" | "I_UNFOLLOWED";
  timestamp: number;
}

export interface ScanSession {
  id: string;
  startedAt: number;
  finishedAt?: number;
  followersScanned: number;
  followingScanned: number;
  status: "pending" | "running" | "completed" | "failed";
}

export interface ConnectionStats {
  userId: string;
  mutualFollowingCount: number;
  mutualFollowerCount: number;
}
