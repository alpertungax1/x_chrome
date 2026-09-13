import { UnfollowerUser } from '../types/unfollowers';

const FALLBACK_BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const FALLBACK_FEATURES = JSON.stringify({
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
});

const FALLBACK_QUERY_IDS = [
  'zx6e-TLzRkeDO_a7p4b3JQ',
  'g5P4cbXR4ta4oCeE7y2vLQ',
  't-BPmIS0UWDrFdYrOxEOdQ',
  '4vh57z89_R779N4-8k-b4g',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  if (!m) return null;
  return decodeURIComponent(m[1]).replace(/^"+|"+$/g, '').trim();
}

function selfUserId(): string | null {
  const twid = getCookie('twid') || '';
  const m = twid.match(/(\d{5,})/);
  return m ? m[1] : null;
}

function siteOrigin(): string {
  return location.origin || (location.hostname.includes('twitter.com') ? 'https://twitter.com' : 'https://x.com');
}

export class XUnfollowersDirectScraper {
  private stopFlag = false;

  public stop() {
    this.stopFlag = true;
  }

  private async xRequest(path: string, options: { method?: string; body?: any; headers?: Record<string, string>; _retry?: number } = {}): Promise<any> {
    const csrf = getCookie('ct0');
    if (!csrf) {
      throw new Error('X oturumu bulunamadı. Lütfen açık olan x.com sekmesinde hesabınıza giriş yapın.');
    }
    const retry = options._retry || 0;

    const headers: Record<string, string> = {
      authorization: FALLBACK_BEARER,
      'x-csrf-token': csrf,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': (navigator.language || 'tr').slice(0, 2),
      accept: '*/*',
      ...(options.headers || {}),
    };

    if (options.body && !headers['content-type']) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }

    const res = await fetch(siteOrigin() + path, {
      method: options.method || 'GET',
      headers,
      body: options.body || undefined,
      credentials: 'include',
    });

    if (res.status === 429 && retry < 4) {
      const waitTime = Math.max(Number(res.headers.get('retry-after') || 45) * 1000, 30000);
      await sleep(waitTime);
      return this.xRequest(path, { ...options, _retry: retry + 1 });
    }

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }

    if (!res.ok) {
      // CSRF uyuşmazlığı varsa kullanıcıya Following sayfasını açması tavsiye edilir
      const msg = json?.errors?.[0]?.message || json?.error || `X API Hatası (${res.status})`;
      if (res.status === 403 && msg.includes('csrf')) {
        throw new Error('X CSRF Güvenlik Hatası: Lütfen açık olan x.com sekmesinde F5 ile sayfayı yenileyip taramayı tekrar başlatın.');
      }
      const err: any = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }

    return json;
  }

  private extractUser(raw: any): UnfollowerUser | null {
    if (!raw || typeof raw !== 'object') return null;
    const node = raw.result && raw.result.legacy ? raw.result : (raw.result || raw);
    if (!node || node.__typename === 'UserUnavailable') return null;
    const legacy = node.legacy || node.core?.user_results?.result?.legacy || raw.legacy || {};
    const core = node.core || raw.core || {};
    const rel = node.relationship_perspectives || raw.relationship_perspectives || {};
    const id = String(node.rest_id || node.id_str || legacy.id_str || raw.rest_id || '');
    const username = core.screen_name || legacy.screen_name || node.screen_name || '';
    if (!id || !username) return null;
    const followedBy = rel.followed_by ?? legacy.followed_by ?? null;
    
    // X GraphQL ve REST takipçi sayısı türevleri
    const rawFollowers =
      legacy.followers_count ??
      legacy.normal_followers_count ??
      node.followers_count ??
      node.normal_followers_count ??
      raw.followers_count ??
      raw.followersCount;
    const followers = typeof rawFollowers === 'number' ? rawFollowers : 0;

    const rawFriends =
      legacy.friends_count ??
      node.friends_count ??
      raw.friends_count ??
      raw.followingCount;
    const followingCount = typeof rawFriends === 'number' ? rawFriends : 0;

    const bio = String(
      legacy.description ||
      core.description ||
      node.description ||
      raw.description ||
      raw.bio ||
      ''
    ).trim();

    const rawStatus = raw.status || node.status || legacy.status;
    let lastTweetAt: number | undefined;
    let lastTweetText: string | undefined;
    if (rawStatus) {
      if (rawStatus.created_at) {
        const parsed = Date.parse(rawStatus.created_at);
        if (!isNaN(parsed) && parsed > 0) lastTweetAt = parsed;
      }
      if (typeof rawStatus.text === 'string' || typeof rawStatus.full_text === 'string') {
        lastTweetText = rawStatus.full_text || rawStatus.text;
      }
    }

    return {
      id,
      username,
      name: core.name || legacy.name || username,
      avatar: node.avatar?.image_url || legacy.profile_image_url_https || '',
      bio,
      followers,
      followingCount,
      followedBy: typeof followedBy === 'boolean' ? followedBy : null,
      verified: !!(node.is_blue_verified || legacy.verified),
      lastTweetAt,
      lastTweetText,
    };
  }

  private walkGraphQL(json: any): { users: UnfollowerUser[]; cursor: string | null } {
    const users: UnfollowerUser[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;

    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node.cursorType && /bottom/i.test(String(node.cursorType)) && typeof node.value === 'string') {
        cursor = node.value;
      }
      const ur = node.user_results?.result || node.userResults?.result;
      if (ur) {
        const u = this.extractUser(ur);
        if (u && !seen.has(u.id)) {
          seen.add(u.id);
          users.push(u);
        }
      }
      for (const k of Object.keys(node)) visit(node[k]);
    };

    visit(json);
    if (cursor === '0') cursor = null;
    return { users, cursor };
  }

  public async fetchFollowingGraphQL(queryId: string, features: string, onProgress?: (count: number) => void): Promise<UnfollowerUser[]> {
    const uid = selfUserId();
    if (!uid) throw new Error('Kullanıcı kimliği (twid) okunamadı. Lütfen x.com’a giriş yapın.');

    const all: UnfollowerUser[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;

    while (!this.stopFlag) {
      pages += 1;
      const variables: any = {
        userId: uid,
        count: 100,
        includePromotedContent: false,
      };
      if (cursor) variables.cursor = cursor;

      const path = `/i/api/graphql/${queryId}/Following?variables=${encodeURIComponent(
        JSON.stringify(variables)
      )}&features=${encodeURIComponent(features || FALLBACK_FEATURES)}`;

      const json = await this.xRequest(path);
      const parsed = this.walkGraphQL(json);

      for (const u of parsed.users) {
        if (!seen.has(u.id)) {
          seen.add(u.id);
          all.push(u);
        }
      }

      onProgress?.(all.length);
      if (!parsed.cursor || parsed.users.length === 0) break;
      cursor = parsed.cursor;
      await sleep(700 + Math.floor(Math.random() * 500));
      if (pages > 250) break;
    }

    return all;
  }

  public async fetchFollowingRest(onProgress?: (count: number) => void): Promise<UnfollowerUser[]> {
    const all: UnfollowerUser[] = [];
    const seen = new Set<string>();
    let cursor = '-1';
    let pages = 0;

    while (!this.stopFlag && cursor && cursor !== '0') {
      pages += 1;
      const json = await this.xRequest(
        `/i/api/1.1/friends/list.json?count=200&cursor=${encodeURIComponent(cursor)}&skip_status=false&include_user_entities=false`
      );
      const users = Array.isArray(json?.users) ? json.users : [];
      for (const raw of users) {
        let lastTweetAt: number | undefined;
        let lastTweetText: string | undefined;
        if (raw.status) {
          if (raw.status.created_at) {
            const parsed = Date.parse(raw.status.created_at);
            if (!isNaN(parsed) && parsed > 0) lastTweetAt = parsed;
          }
          if (raw.status.text || raw.status.full_text) {
            lastTweetText = raw.status.full_text || raw.status.text;
          }
        }

        const u: UnfollowerUser = {
          id: String(raw.id_str || raw.id),
          username: raw.screen_name,
          name: raw.name || raw.screen_name,
          avatar: raw.profile_image_url_https || '',
          bio: raw.description || '',
          followers: raw.followers_count || 0,
          followingCount: raw.friends_count || 0,
          followedBy: typeof raw.followed_by === 'boolean' ? raw.followed_by : null,
          verified: !!raw.verified,
          lastTweetAt,
          lastTweetText,
        };
        if (u.id && u.username && !seen.has(u.id)) {
          seen.add(u.id);
          all.push(u);
        }
      }
      onProgress?.(all.length);
      cursor = json?.next_cursor_str || '0';
      if (!users.length) break;
      await sleep(700 + Math.floor(Math.random() * 500));
      if (pages > 250) break;
    }

    return all;
  }

  public async fetchFollowersGraphQL(queryId: string, features: string, onProgress?: (count: number) => void): Promise<UnfollowerUser[]> {
    const uid = selfUserId();
    if (!uid) throw new Error('Kullanıcı kimliği (twid) okunamadı. Lütfen x.com’a giriş yapın.');

    const all: UnfollowerUser[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;

    while (!this.stopFlag) {
      pages += 1;
      const variables: any = {
        userId: uid,
        count: 100,
        includePromotedContent: false,
      };
      if (cursor) variables.cursor = cursor;

      const path = `/i/api/graphql/${queryId}/Followers?variables=${encodeURIComponent(
        JSON.stringify(variables)
      )}&features=${encodeURIComponent(features || FALLBACK_FEATURES)}`;

      const json = await this.xRequest(path);
      const parsed = this.walkGraphQL(json);

      for (const u of parsed.users) {
        if (!seen.has(u.id)) {
          seen.add(u.id);
          all.push({ ...u, followedBy: true });
        }
      }

      onProgress?.(all.length);
      if (!parsed.cursor || parsed.users.length === 0) break;
      cursor = parsed.cursor;
      await sleep(700 + Math.floor(Math.random() * 500));
      if (pages > 250) break;
    }

    return all;
  }

  public async fetchFollowersRest(onProgress?: (count: number) => void): Promise<UnfollowerUser[]> {
    const all: UnfollowerUser[] = [];
    const seen = new Set<string>();
    let cursor = '-1';
    let pages = 0;

    while (!this.stopFlag && cursor && cursor !== '0') {
      pages += 1;
      const json = await this.xRequest(
        `/i/api/1.1/followers/list.json?count=200&cursor=${encodeURIComponent(cursor)}&skip_status=true&include_user_entities=false`
      );
      const users = Array.isArray(json?.users) ? json.users : [];
      for (const raw of users) {
        const u: UnfollowerUser = {
          id: String(raw.id_str || raw.id),
          username: raw.screen_name,
          name: raw.name || raw.screen_name,
          avatar: raw.profile_image_url_https || '',
          followers: raw.followers_count || 0,
          followingCount: raw.friends_count || 0,
          followedBy: true,
          verified: !!raw.verified,
        };
        if (u.id && u.username && !seen.has(u.id)) {
          seen.add(u.id);
          all.push(u);
        }
      }
      onProgress?.(all.length);
      cursor = json?.next_cursor_str || '0';
      if (!users.length) break;
      await sleep(700 + Math.floor(Math.random() * 500));
      if (pages > 250) break;
    }

    return all;
  }

  public async lookupFollowedBy(accounts: UnfollowerUser[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const unknown = accounts.filter((u) => u.followedBy == null);
    for (let i = 0; i < unknown.length; i += 100) {
      if (this.stopFlag) break;
      const batch = unknown.slice(i, i + 100);
      const ids = batch.map((u) => u.id).join(',');
      try {
        const json = await this.xRequest(`/i/api/1.1/friendships/lookup.json?user_id=${ids}`);
        const rows = Array.isArray(json) ? json : [];
        const map = new Map<string, boolean>();
        for (const row of rows) {
          const id = String(row.id_str || row.id);
          const connections: string[] = row.connections || [];
          map.set(id, connections.includes('followed_by'));
        }
        for (const u of batch) {
          if (map.has(u.id)) {
            u.followedBy = map.get(u.id)!;
          }
        }
      } catch (e) {
        console.warn('friendships lookup batch failed:', e);
      }
      onProgress?.(Math.min(i + 100, unknown.length), unknown.length);
      if (i + 100 < unknown.length) await sleep(500);
    }
  }

  public async scan(onStatus?: (text: string) => void): Promise<UnfollowerUser[]> {
    this.stopFlag = false;
    onStatus?.('Takip listeniz taranıyor...');

    let following: UnfollowerUser[] = [];
    let lastErr: any = null;

    for (const qid of FALLBACK_QUERY_IDS) {
      try {
        following = await this.fetchFollowingGraphQL(qid, FALLBACK_FEATURES, (count) => {
          onStatus?.(`Takip listeniz taranıyor... ${count} hesap`);
        });
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err;
        if (err.status && err.status !== 404 && err.status !== 400) throw err;
      }
    }

    if (!following.length && !this.stopFlag) {
      try {
        onStatus?.('REST API ile taranıyor...');
        following = await this.fetchFollowingRest((count) => {
          onStatus?.(`Takip listeniz taranıyor (REST)... ${count} hesap`);
        });
      } catch (err: any) {
        lastErr = err;
      }
    }

    if (!following.length) {
      if (this.stopFlag) return [];
      throw new Error(
        'Takip listeniz okunamadı: ' + (lastErr?.message || 'Lütfen açık olan x.com sekmesini yenileyip tekrar deneyin.')
      );
    }

    if (this.stopFlag) {
      return following.filter((u) => u.followedBy === false || u.followedBy == null);
    }

    onStatus?.(`Geri takip durumu kontrol ediliyor... (${following.length} hesap)`);
    await this.lookupFollowedBy(following, (done, total) => {
      onStatus?.(`Geri takip kontrol ediliyor: ${done} / ${total}`);
    });

    const nonFollowers = following.filter((u) => u.followedBy === false || (this.stopFlag && u.followedBy == null));

    // Non-followers için eksik takipçi sayılarını ve son tweet tarihlerini doğrudan tamamla
    if (nonFollowers.length > 0 && !this.stopFlag) {
      onStatus?.(`Hesap bilgileri ve son tweetler çekiliyor... (${nonFollowers.length} hesap)`);
      try {
        const toLookup = nonFollowers.map((u) => u.username);
        const lookupRes = await this.lookupUsers(toLookup);
        if (lookupRes && lookupRes.length > 0) {
          const map = new Map(lookupRes.map((r) => [r.username.toLowerCase(), r]));
          for (const u of nonFollowers) {
            const res = map.get(u.username.toLowerCase());
            if (res) {
              if (typeof res.followersCount === 'number' && res.followersCount > 0) {
                u.followers = res.followersCount;
              }
              if (typeof res.lastTweetAt === 'number') {
                u.lastTweetAt = res.lastTweetAt;
              }
              if (res.lastTweetText) {
                u.lastTweetText = res.lastTweetText;
              }
              if (res.bio && !u.bio) {
                u.bio = res.bio;
              }
            }
          }
        }
      } catch (e) {
        console.warn('Auto lookup for nonFollowers failed:', e);
      }
    }

    return nonFollowers;
  }

  /**
   * Tüm Takip Edilenler ve Takipçileri Gerçek Takipçi Sayılarıyla Çeker (Pencere açmaz, %100 Arka Planda)
   */
  public async scanFull(onStatus?: (text: string) => void): Promise<{
    following: any[];
    followers: any[];
  }> {
    this.stopFlag = false;
    onStatus?.('Takip edilenler taranıyor (API)...');

    let followingRaw: UnfollowerUser[] = [];
    for (const qid of FALLBACK_QUERY_IDS) {
      try {
        followingRaw = await this.fetchFollowingGraphQL(qid, FALLBACK_FEATURES, (count) => {
          onStatus?.(`Takip edilenler taranıyor: ${count} hesap`);
        });
        break;
      } catch (_) {}
    }

    if (!followingRaw.length && !this.stopFlag) {
      try {
        followingRaw = await this.fetchFollowingRest((count) => {
          onStatus?.(`Takip edilenler taranıyor (REST): ${count} hesap`);
        });
      } catch (_) {}
    }

    const now = Date.now();
    const mapToUser = (u: UnfollowerUser, isFollowing: boolean, isFollower: boolean | null, orderIndex: number = 0) => ({
      id: u.username.toLowerCase(),
      numericId: /^\d+$/.test(u.id) ? u.id : undefined,
      username: u.username,
      displayName: u.name,
      avatarUrl: u.avatar,
      bio: u.bio,
      lastTweetAt: u.lastTweetAt,
      lastTweetText: u.lastTweetText,
      followersCount: typeof u.followers === 'number' ? u.followers : 0,
      followingCount: typeof u.followingCount === 'number' ? u.followingCount : 0,
      isFollowing,
      isFollower: isFollower ?? false,
      firstSeenAt: now,  // mergeScan'da existing.firstSeenAt korunur, bu yeni kayıtlar içindir
      lastSeenAt: now,
      scanOrder: orderIndex,
      // followedAt ve followerSince kasıtlı bırakıldı — DB'de önceki değer korunur (mergeScan logic),
      // yeni kayıtlar için repository now atar.
    });

    // Eğer durdurulduysa veya takip edilen bulunamadıysa olanı dön
    if (this.stopFlag || followingRaw.length === 0) {
      return {
        following: followingRaw.map((u, idx) => mapToUser(u, true, u.followedBy, idx)),
        followers: followingRaw.filter((u) => u.followedBy === true).map((u, idx) => mapToUser(u, true, true, idx)),
      };
    }

    onStatus?.(`Geri takip durumları kontrol ediliyor... (${followingRaw.length} hesap)`);
    await this.lookupFollowedBy(followingRaw, (done, total) => {
      onStatus?.(`Geri takip kontrolü: ${done} / ${total}`);
    });

    if (this.stopFlag) {
      return {
        following: followingRaw.map((u, idx) => mapToUser(u, true, u.followedBy, idx)),
        followers: followingRaw.filter((u) => u.followedBy === true).map((u, idx) => mapToUser(u, true, true, idx)),
      };
    }

    // Takipçileri de çek (sadece takip eden ama geri takip edilmeyenleri tamamlamak için)
    onStatus?.('Takipçiler taranıyor (API)...');
    let followersRaw: UnfollowerUser[] = [];
    for (const qid of FALLBACK_QUERY_IDS) {
      try {
        followersRaw = await this.fetchFollowersGraphQL(qid, FALLBACK_FEATURES, (count) => {
          onStatus?.(`Takipçiler taranıyor: ${count} hesap`);
        });
        break;
      } catch (_) {}
    }

    if (!followersRaw.length && !this.stopFlag) {
      try {
        followersRaw = await this.fetchFollowersRest((count) => {
          onStatus?.(`Takipçiler taranıyor (REST): ${count} hesap`);
        });
      } catch (_) {}
    }

    // Takipçi sayıları eksik veya 0 olan kullanıcıların gerçek sayılarını doğrudan X API'sinden tamamla
    const needFollowerCounts = followingRaw.filter((u) => typeof u.followers !== 'number' || u.followers <= 0);
    if (needFollowerCounts.length > 0 && !this.stopFlag) {
      onStatus?.(`Takipçi sayıları tamamlanıyor... (${needFollowerCounts.length} hesap)`);
      try {
        const toLookup = needFollowerCounts.map((u) => u.username);
        const lookupRes = await this.lookupUsers(toLookup);
        if (lookupRes && lookupRes.length > 0) {
          const map = new Map(lookupRes.map((r) => [r.username.toLowerCase(), r]));
          for (const u of followingRaw) {
            const res = map.get(u.username.toLowerCase());
            if (res) {
              if (typeof res.followersCount === 'number' && res.followersCount > 0) {
                u.followers = res.followersCount;
              }
              if (typeof res.lastTweetAt === 'number') {
                u.lastTweetAt = res.lastTweetAt;
              }
              if (res.lastTweetText) {
                u.lastTweetText = res.lastTweetText;
              }
              if (res.bio && !u.bio) {
                u.bio = res.bio;
              }
            }
          }
        }
      } catch (e) {
        console.warn('Auto lookup followers for followingRaw failed:', e);
      }
    }

    const followersNeedCounts = followersRaw.filter((u) => typeof u.followers !== 'number' || u.followers <= 0);
    if (followersNeedCounts.length > 0 && !this.stopFlag) {
      try {
        const toLookup = followersNeedCounts.map((u) => u.username);
        const lookupRes = await this.lookupUsers(toLookup);
        if (lookupRes && lookupRes.length > 0) {
          const map = new Map(lookupRes.map((r) => [r.username.toLowerCase(), r]));
          for (const u of followersRaw) {
            const res = map.get(u.username.toLowerCase());
            if (res) {
              if (typeof res.followersCount === 'number' && res.followersCount > 0) {
                u.followers = res.followersCount;
              }
              if (typeof res.lastTweetAt === 'number') {
                u.lastTweetAt = res.lastTweetAt;
              }
              if (res.lastTweetText) {
                u.lastTweetText = res.lastTweetText;
              }
              if (res.bio && !u.bio) {
                u.bio = res.bio;
              }
            }
          }
        }
      } catch (e) {
        console.warn('Auto lookup followers for followersRaw failed:', e);
      }
    }

    const followingMap = new Map<string, UnfollowerUser>();
    for (const u of followingRaw) {
      followingMap.set(u.username.toLowerCase(), u);
    }

    const finalFollowing = followingRaw.map((u, idx) => mapToUser(u, true, u.followedBy, idx));
    
    // Followers: hem following içinde followedBy=true olanlar hem de followersRaw'dan gelenler
    const followersMap = new Map<string, any>();
    followingRaw.forEach((u, idx) => {
      if (u.followedBy === true) {
        followersMap.set(u.username.toLowerCase(), mapToUser(u, true, true, idx));
      }
    });
    followersRaw.forEach((u, idx) => {
      const uname = u.username.toLowerCase();
      if (!followersMap.has(uname)) {
        const isAlsoFollowing = followingMap.has(uname);
        followersMap.set(uname, mapToUser(u, isAlsoFollowing, true, idx));
      }
    });

    return { following: finalFollowing, followers: Array.from(followersMap.values()) };
  }

  public async lookupUsers(
    usersOrScreenNames: string[]
  ): Promise<{
    username: string;
    followersCount: number;
    id?: string;
    avatar?: string;
    displayName?: string;
    bio?: string;
    lastTweetAt?: number;
    lastTweetText?: string;
  }[]> {
    const results: {
      username: string;
      followersCount: number;
      id?: string;
      avatar?: string;
      displayName?: string;
      bio?: string;
      lastTweetAt?: number;
      lastTweetText?: string;
    }[] = [];
    const cleaned = usersOrScreenNames
      .map((s) => String(s || '').trim().replace(/^@/, ''))
      .filter(Boolean);

    // 100'erli paketler halinde çağır
    for (let i = 0; i < cleaned.length; i += 100) {
      if (this.stopFlag) break;
      const batch = cleaned.slice(i, i + 100);
      const isNumeric = batch.every((s) => /^\d+$/.test(s));
      const paramName = isNumeric ? 'user_id' : 'screen_name';
      const paramVal = batch.join(',');

      try {
        const postBody = new URLSearchParams({
          [paramName]: paramVal,
          include_entities: '1',
          skip_status: '0',
          tweet_mode: 'extended',
        }).toString();

        let json = await this.xRequest('/i/api/1.1/users/lookup.json', {
          method: 'POST',
          body: postBody,
        });
        if (!Array.isArray(json)) {
          // Fallback GET
          json = await this.xRequest(
            `/i/api/1.1/users/lookup.json?${paramName}=${encodeURIComponent(paramVal)}&include_entities=1&skip_status=0&tweet_mode=extended`
          );
        }
        if (Array.isArray(json)) {
          for (const u of json) {
            let lastTweetAt: number | undefined;
            let lastTweetText: string | undefined;
            if (u.status) {
              if (u.status.created_at) {
                const parsed = Date.parse(u.status.created_at);
                if (!isNaN(parsed) && parsed > 0) lastTweetAt = parsed;
              }
              if (u.status.full_text || u.status.text) {
                lastTweetText = u.status.full_text || u.status.text;
              }
            } else if (typeof u.statuses_count === 'number' && u.statuses_count === 0) {
              lastTweetAt = 0;
            }

            results.push({
              id: String(u.id_str || u.id),
              username: u.screen_name,
              displayName: u.name || u.screen_name,
              followersCount: typeof u.followers_count === 'number' ? u.followers_count : 0,
              avatar: u.profile_image_url_https || '',
              bio: u.description || '',
              lastTweetAt,
              lastTweetText,
            });
          }
        }
      } catch (err) {
        console.warn('users/lookup.json batch error:', err);
      }

      if (i + 100 < cleaned.length) {
        await sleep(350);
      }
    }

    return results;
  }

  public async resolveUserNumericId(username: string): Promise<string | null> {
    const clean = username.trim().replace(/^@/, '');
    if (!clean) return null;

    // 1. users/show.json ile sorgula (hızlı ve tekil)
    try {
      const userRes = await this.xRequest(`/i/api/1.1/users/show.json?screen_name=${encodeURIComponent(clean)}`);
      const id = String(userRes?.id_str || userRes?.id || '');
      if (/^\d+$/.test(id)) return id;
    } catch (_) {}

    // 2. lookupUsers ile sorgula
    try {
      const lookup = await this.lookupUsers([clean]);
      if (lookup.length > 0 && lookup[0].id && /^\d+$/.test(lookup[0].id)) {
        return lookup[0].id;
      }
    } catch (_) {}

    return null;
  }

  public async unfollowUser(
    target: { userId?: string; username?: string; numericId?: string } | string
  ): Promise<boolean> {
    let rawUserId = typeof target === 'string' ? target : (target.numericId || target.userId);
    let rawUsername = typeof target === 'string' ? undefined : target.username;

    let isNumericId = typeof rawUserId === 'string' && /^\d+$/.test(rawUserId.trim());
    let numericId = isNumericId ? rawUserId!.trim() : undefined;

    let username = rawUsername?.trim().replace(/^@/, '');
    if (!username && !isNumericId && rawUserId) {
      username = rawUserId.trim().replace(/^@/, '');
    }

    // Eğer numerik ID henüz elimizde yoksa, username üzerinden X API'sinden numerik ID'yi çöz
    if (!numericId && username) {
      const resolved = await this.resolveUserNumericId(username);
      if (resolved) {
        numericId = resolved;
        isNumericId = true;
      }
    }

    const bodyParams = new URLSearchParams();
    if (numericId) {
      // X Web API takipten çıkarken SADECE user_id gönderir; screen_name eklenmez
      bodyParams.set('user_id', numericId);
    } else if (username) {
      bodyParams.set('screen_name', username);
    } else {
      throw new Error('Kullanıcı kimliği veya kullanıcı adı bulunamadı.');
    }

    try {
      await this.xRequest('/i/api/1.1/friendships/destroy.json', {
        method: 'POST',
        body: bodyParams.toString(),
      });
      return true;
    } catch (err: any) {
      const msg = String(err?.message || '');

      // Zaten takip edilmiyorsa amaca ulaşıldı, başarılı say
      if (
        msg.includes('You are not following') ||
        msg.includes('already not following')
      ) {
        return true;
      }

      // Eğer numerik ID olmadan screen_name ile çağrıldıysa ve hata alındıysa, numerik ID çözüp tekrar dene
      if (!numericId && username) {
        try {
          const resolved = await this.resolveUserNumericId(username);
          if (resolved) {
            await this.xRequest('/i/api/1.1/friendships/destroy.json', {
              method: 'POST',
              body: new URLSearchParams({ user_id: resolved }).toString(),
            });
            return true;
          }
        } catch (retryErr: any) {
          const rMsg = String(retryErr?.message || '');
          if (rMsg.includes('You are not following') || rMsg.includes('already not following')) {
            return true;
          }
          throw retryErr;
        }
      }

      throw err;
    }
  }
}

export const xUnfollowersDirectScraper = new XUnfollowersDirectScraper();
