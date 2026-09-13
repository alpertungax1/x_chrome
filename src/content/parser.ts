import { XUser } from '../types/user';
import { logger } from '../utils/logger';

/**
 * X.com UserCell DOM yapısından kullanıcı bilgilerini çıkarır.
 * 
 * Kritik: X'te @username her zaman bir <a href="/username"> linkleri içinde yer alır.
 * textContent kullanmak tehlikelidir çünkü iç içe span'lar birleştirilir ve 
 * "Takip" gibi buton metinleri username'e yapışır.
 */
export const parseUserFromElement = (element: HTMLElement): Partial<XUser> | null => {
  try {
    let username = '';
    let displayName = '';

    // ═══════════════════════════════════════════════════════════
    // 1. USERNAME: Sadece <a> linklerinin href'inden çek (EN GÜVENİLİR)
    // ═══════════════════════════════════════════════════════════
    const profileLinks = element.querySelectorAll('a[href]');
    const skipPaths = new Set(['followers', 'following', 'header_photo', 'photo', 'likes', 'lists', 'i', 'home', 'search', 'explore', 'notifications', 'messages', 'settings']);
    
    for (const link of Array.from(profileLinks)) {
      const href = (link as HTMLAnchorElement).getAttribute('href') || '';
      // X profil linkleri her zaman "/username" formatında (tek segment, / ile başlayan)
      const match = href.match(/^\/([a-zA-Z0-9_]{1,15})$/);
      if (match && !skipPaths.has(match[1].toLowerCase())) {
        username = match[1];
        break;
      }
    }

    if (!username) {
      return null;
    }

    // ═══════════════════════════════════════════════════════════
    // 2. DISPLAY NAME: İlk a[role="link"] içindeki dir="auto" div'den
    // ═══════════════════════════════════════════════════════════
    // Profil linkinin içindeki ilk dir="auto" span genelde display name'dir
    const firstProfileLink = element.querySelector(`a[href="/${username}"]`);
    if (firstProfileLink) {
      const nameSpan = firstProfileLink.querySelector('div[dir="auto"] span');
      if (nameSpan && nameSpan.textContent) {
        displayName = nameSpan.textContent.trim();
      }
    }

    // Fallback: innerText satırlarından ilk boş olmayan, @ ile başlamayan satır
    if (!displayName) {
      const lines = (element.innerText || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
      for (const line of lines) {
        if (!line.startsWith('@') && line !== 'Takip' && line !== 'Takip Ediyorsun' && line !== 'Follow' && line !== 'Following') {
          displayName = line;
          break;
        }
      }
    }

    if (!displayName) {
      displayName = username;
    }

    // ═══════════════════════════════════════════════════════════
    // 3. AVATAR
    // ═══════════════════════════════════════════════════════════
    const avatarImg = element.querySelector('img[src*="profile_images"]') as HTMLImageElement;
    const avatarUrl = avatarImg ? avatarImg.src : '';

    // ═══════════════════════════════════════════════════════════
    // 4. RELATIONSHIP (Takip durumu)
    // ═══════════════════════════════════════════════════════════
    // innerText kullan (satır satır ayırır, textContent gibi birleştirmez)
    const innerText = element.innerText || '';
    const isFollower = innerText.includes('Follows you') || innerText.includes('Seni takip ediyor');

    // data-testid ile buton kontrolü
    const unfollowBtn = element.querySelector('[data-testid$="-unfollow"]');
    const followBtn = element.querySelector('[data-testid$="-follow"]');
    
    let isFollowing = false;
    if (unfollowBtn) {
      isFollowing = true;
    } else if (followBtn) {
      isFollowing = false;
    } else {
      // Fallback: innerText satırlarından kontrol
      const textLines = innerText.toLowerCase().split('\n');
      isFollowing = textLines.some(l => l.trim() === 'following' || l.trim() === 'takip ediyorsun');
    }

    // ═══════════════════════════════════════════════════════════
    // 5. METADATA (network-hook'tan yakalanan takipçi sayıları)
    // ═══════════════════════════════════════════════════════════
    const meta = (window as any).__XRM_META__?.[username.toLowerCase()];
    const followersCount = typeof meta?.followersCount === 'number' ? meta.followersCount : undefined;
    const followingCount = typeof meta?.followingCount === 'number' ? meta.followingCount : undefined;

    return {
      id: username.toLowerCase(),
      numericId: meta?.numericId,
      username,
      displayName: meta?.displayName || displayName,
      avatarUrl,
      followersCount,
      followingCount,
      isFollower,
      isFollowing,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now()
    };
  } catch (err) {
    logger.warn('Parser', 'Failed to parse user from element', err);
    return null;
  }
};
