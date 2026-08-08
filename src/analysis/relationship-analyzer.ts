import { XUser } from '../types/user';

export const relationshipAnalyzer = {
  findNotFollowingMe(users: XUser[]): XUser[] {
    return users.filter(user => user.isFollowing && !user.isFollower);
  },

  findMutuals(users: XUser[]): XUser[] {
    return users.filter(user => user.isFollowing && user.isFollower);
  },

  findUnfollowingMe(users: XUser[]): XUser[] {
    // This requires historic data, but currently we can check if they don't follow but we do
    // A true unfollow detection requires snapshot comparison
    return users.filter(user => user.isFollowing && !user.isFollower);
  },

  findNewFollowers(users: XUser[], since: number): XUser[] {
    return users.filter(user => user.isFollower && user.firstSeenAt >= since);
  }
};
