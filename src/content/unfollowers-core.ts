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
    const node = raw.result && raw.result.legacy ? raw.result : raw;
    if (!node || node.__typename === 'UserUnavailable') return null;
    const legacy = node.legacy || {};
    const core = node.core || {};
    const rel = node.relationship_perspectives || {};
    const id = String(node.rest_id || node.id_str || legacy.id_str || '');
    const username = core.screen_name || legacy.screen_name || '';
    if (!id || !username) return null;
    const followedBy = rel.followed_by ?? legacy.followed_by ?? null;
    return {
      id,
      username,
      name: core.name || legacy.name || username,
      avatar: node.avatar?.image_url || legacy.profile_image_url_https || '',
      followers: legacy.followers_count || 0,
      followingCount: legacy.friends_count || 0,
      followedBy: typeof followedBy === 'boolean' ? followedBy : null,
      verified: !!(node.is_blue_verified || legacy.verified),
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
        `/i/api/1.1/friends/list.json?count=200&cursor=${encodeURIComponent(cursor)}&skip_status=true&include_user_entities=false`
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
          followedBy: typeof raw.followed_by === 'boolean' ? raw.followed_by : null,
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
      throw new Error(
        'Takip listeniz okunamadı: ' + (lastErr?.message || 'Lütfen açık olan x.com sekmesini yenileyip tekrar deneyin.')
      );
    }

    if (this.stopFlag) return [];

    onStatus?.(`Geri takip durumu kontrol ediliyor... (${following.length} hesap)`);
    await this.lookupFollowedBy(following, (done, total) => {
      onStatus?.(`Geri takip kontrol ediliyor: ${done} / ${total}`);
    });

    if (this.stopFlag) return [];

    const nonFollowers = following.filter((u) => u.followedBy === false);
    return nonFollowers;
  }

  public async lookupUsers(
    usersOrScreenNames: string[]
  ): Promise<{ username: string; followersCount: number; id?: string; avatar?: string; displayName?: string }[]> {
    const results: { username: string; followersCount: number; id?: string; avatar?: string; displayName?: string }[] = [];

    // 100'erli paketler halinde çağır
    for (let i = 0; i < usersOrScreenNames.length; i += 100) {
      if (this.stopFlag) break;
      const batch = usersOrScreenNames.slice(i, i + 100);
      const isNumeric = batch.every((s) => /^\d+$/.test(s));
      const paramName = isNumeric ? 'user_id' : 'screen_name';
      const paramVal = batch.join(',');

      try {
        const json = await this.xRequest(
          `/i/api/1.1/users/lookup.json?${paramName}=${encodeURIComponent(paramVal)}&include_entities=false`
        );
        if (Array.isArray(json)) {
          for (const u of json) {
            results.push({
              id: String(u.id_str || u.id),
              username: u.screen_name,
              displayName: u.name || u.screen_name,
              followersCount: u.followers_count || 0,
              avatar: u.profile_image_url_https || '',
            });
          }
        }
      } catch (err) {
        console.warn('users/lookup.json batch error:', err);
      }

      if (i + 100 < usersOrScreenNames.length) {
        await sleep(350);
      }
    }

    return results;
  }

  public async unfollowUser(userId: string): Promise<boolean> {
    await this.xRequest('/i/api/1.1/friendships/destroy.json', {
      method: 'POST',
      body: new URLSearchParams({ user_id: userId }).toString(),
    });
    return true;
  }
}

export const xUnfollowersDirectScraper = new XUnfollowersDirectScraper();
