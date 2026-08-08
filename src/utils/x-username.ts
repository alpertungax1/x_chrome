/**
 * X.com reserved path segmentleri — bunlar asla kullanıcı adı değildir.
 */
export const X_RESERVED_PATHS = new Set([
  'home',
  'explore',
  'search',
  'notifications',
  'messages',
  'settings',
  'i',
  'compose',
  'login',
  'logout',
  'signup',
  'tos',
  'privacy',
  'following',
  'followers',
  'verified_followers',
  'likes',
  'lists',
  'communities',
  'premium',
  'jobs',
  'connect',
  'intent',
  'share',
  'hashtag',
  'account',
  'about',
  'download',
  'help',
  'display',
  'twitter',
  'x',
  'status',
  'statuses',
  'oauth',
  'flow',
  'logout',
  'embed',
  'privacy',
  'rules',
  'safety',
  'who_to_follow',
  'bookmarks',
  'grok',
  'more',
  'topics',
  'analytics',
  'founder',
]);

/** Geçerli X kullanıcı adı mı? (reserved path değil) */
export function isValidXUsername(value: string | null | undefined): value is string {
  if (!value) return false;
  const u = value.trim().replace(/^@/, '');
  if (u.length < 1 || u.length > 15) return false;
  if (!/^[A-Za-z0-9_]+$/.test(u)) return false;
  if (X_RESERVED_PATHS.has(u.toLowerCase())) return false;
  return true;
}

export function normalizeXUsername(value: string): string {
  return value.trim().replace(/^@/, '');
}

/** URL path'ten kullanıcı adı çek (following/followers sayfaları). */
export function usernameFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const path = new URL(url).pathname;
    const m = path.match(
      /^\/([A-Za-z0-9_]{1,15})\/(following|followers|verified_followers)\/?$/i
    );
    if (m && isValidXUsername(m[1])) return m[1];
  } catch {
    // ignore
  }
  return null;
}
